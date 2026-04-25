// Structured-output helper for LLM calls that must return parseable JSON.
// When a call returns prose or invalid JSON, re-prompts with a stricter
// reminder up to maxAttempts times before throwing. This replaces the silent
// "return default stub" fallbacks that previously hid upstream model drift.

export interface JsonRetryOptions<T> {
  maxAttempts?: number;
  /** Validate the parsed value. Returning false triggers a retry. */
  validate?: (parsed: unknown) => boolean;
  /** Initial reminder used on retry. Defaults are usually fine. */
  repromptPrefix?: string;
}

/**
 * Call the LLM up to `maxAttempts` times, extracting + validating JSON
 * each time. The caller supplies a function that takes an optional
 * reminder suffix (to append to the prompt on retries) and returns the
 * raw LLM output. This lets callers inject structure-specific guidance
 * without this helper caring about prompt shape.
 */
export async function withJsonRetry<T = unknown>(
  llm: (repromptSuffix?: string) => Promise<string>,
  opts: JsonRetryOptions<T> = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const validate = opts.validate ?? (() => true);
  let lastErr = '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = attempt === 0
      ? undefined
      : `\n\nYour previous response was rejected (${lastErr}). Return ONLY a valid JSON value — no prose, no markdown fences, no commentary before or after.`;

    const raw = await llm(suffix);
    const parsed = tryParse(raw);
    if (parsed === undefined) { lastErr = 'output was not parseable JSON'; continue; }
    if (!validate(parsed)) { lastErr = 'output failed schema validation'; continue; }
    return parsed as T;
  }

  throw new Error(`withJsonRetry: failed after ${maxAttempts} attempts — ${lastErr}`);
}

/** Attempt a direct JSON.parse, then fall back to extracting the first
 *  {...} or [...] block from prose. Returns undefined on total failure. */
function tryParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* continue */ }

  // Strip common markdown fences: ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* continue */ }
  }

  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
  }

  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* continue */ }
  }

  return undefined;
}
