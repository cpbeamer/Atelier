// Provider-agnostic LLM client used by all worker activities.
// The "primary" provider is resolved from the backend on each call so that
// changes in Settings take effect without restarting the worker.

import { estimateCost, extractUsageFromPayload, recordCall, type Usage } from './telemetry';

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'minimax';

export interface PrimaryProvider {
  id: string;
  name: string;
  baseUrl: string;
  kind: ProviderKind;
  selectedModel: string | null;
}

export interface CallLLMOptions {
  cwd?: string;
  agentId?: string;
  providerId?: string;
  /** Workflow run ID — lets per-call telemetry aggregate onto workflow_runs. */
  runId?: string;
  /** Sampling temperature; provider-dependent, 0..2. Defaults to provider default. */
  temperature?: number;
}

async function emitAgentEvent(id: string, event: { kind: string; [k: string]: any }): Promise<void> {
  try {
    await fetch(`${BACKEND}/api/agent/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, event }),
    });
  } catch { /* backend not reachable — non-fatal */ }
}

async function getPrimaryProvider(): Promise<PrimaryProvider> {
  // Env-var override: lets the worker run standalone without a backend.
  if (process.env.MINIMAX_API_KEY && !process.env.ATELIER_BACKEND_URL) {
    return {
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.io/v1',
      kind: 'minimax',
      selectedModel: process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
    };
  }
  const response = await fetch(`${BACKEND}/api/settings/primaryProvider`);
  if (response.status === 404) {
    throw new Error(
      'No primary model provider configured. Open Settings, add an API key for a provider, and click "Set primary".',
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to resolve primary provider: HTTP ${response.status}`);
  }
  return await response.json() as PrimaryProvider;
}

async function getApiKey(providerId: string, kind: ProviderKind): Promise<string> {
  // Per-provider env-var fallbacks make local development painless.
  const envName =
    kind === 'minimax'   ? 'MINIMAX_API_KEY' :
    kind === 'anthropic' ? 'ANTHROPIC_API_KEY' :
    `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;

  try {
    const r = await fetch(`${BACKEND}/api/settings/apiKey/${encodeURIComponent(providerId)}`);
    if (r.ok) {
      const data = await r.json() as { apiKey: string | null };
      if (data.apiKey) return data.apiKey;
    }
  } catch { /* backend unreachable */ }
  throw new Error(
    `API key for "${providerId}" is not configured. Set ${envName} or add it in Settings.`,
  );
}

// Splits an incoming token stream into 'text' and 'thinking' chunks across
// `<think>…</think>` boundaries that may land mid-token. Safe on delta streams:
// holds back up to TAG_LEN-1 bytes when a partial tag could be forming.
function createThinkStreamParser(onChunk: (kind: 'text' | 'thinking', chunk: string) => void) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let buffer = '';
  let inThink = false;
  return {
    push(delta: string) {
      buffer += delta;
      while (buffer.length > 0) {
        if (!inThink) {
          const idx = buffer.indexOf(OPEN);
          if (idx === -1) {
            const safe = Math.max(0, buffer.length - (OPEN.length - 1));
            if (safe > 0) {
              onChunk('text', buffer.slice(0, safe));
              buffer = buffer.slice(safe);
            }
            return;
          }
          if (idx > 0) onChunk('text', buffer.slice(0, idx));
          buffer = buffer.slice(idx + OPEN.length);
          inThink = true;
        } else {
          const idx = buffer.indexOf(CLOSE);
          if (idx === -1) {
            const safe = Math.max(0, buffer.length - (CLOSE.length - 1));
            if (safe > 0) {
              onChunk('thinking', buffer.slice(0, safe));
              buffer = buffer.slice(safe);
            }
            return;
          }
          if (idx > 0) onChunk('thinking', buffer.slice(0, idx));
          buffer = buffer.slice(idx + CLOSE.length);
          inThink = false;
        }
      }
    },
    flush() {
      if (buffer.length > 0) {
        onChunk(inThink ? 'thinking' : 'text', buffer);
        buffer = '';
      }
    },
  };
}

export function stripThinking(output: string): string {
  return output.replace(/<think>[\s\S]*?<\/think>/g, '');
}

// Build URL/headers/body for a chat request based on provider kind.
function buildRequest(
  provider: PrimaryProvider,
  apiKey: string,
  system: string,
  user: string,
  temperature?: number,
): { url: string; headers: Record<string, string>; body: string } {
  const model = provider.selectedModel ?? '';
  if (provider.kind === 'minimax') {
    return {
      url: `${provider.baseUrl.replace(/\/+$/, '')}/text/chatcompletion_v2`,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'MiniMax-M2.7',
        stream: true,
        ...(temperature !== undefined ? { temperature } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    };
  }
  if (provider.kind === 'anthropic') {
    return {
      url: `${provider.baseUrl.replace(/\/+$/, '')}/messages`,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 8192,
        ...(temperature !== undefined ? { temperature } : {}),
        system,
        messages: [{ role: 'user', content: user }],
      }),
    };
  }
  // openai-compatible
  return {
    url: `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      ...(temperature !== undefined ? { temperature } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  };
}

// Extract the streamed text delta from a single SSE JSON payload.
// Returns '' for events that don't carry visible content (heartbeats, role
// announcements, anthropic content_block_start/stop, etc.).
function extractDelta(kind: ProviderKind, payload: any): string {
  if (kind === 'anthropic') {
    if (payload?.type === 'content_block_delta') {
      const d = payload?.delta;
      if (d?.type === 'text_delta' && typeof d.text === 'string') return d.text;
    }
    return '';
  }
  // openai-compatible + minimax both follow the OpenAI delta shape.
  const d = payload?.choices?.[0]?.delta?.content;
  return typeof d === 'string' ? d : '';
}

export async function callLLM(
  system: string,
  user: string,
  opts: CallLLMOptions | string = {},
): Promise<string> {
  // Back-compat: a bare string in the 3rd slot used to mean cwd.
  const { agentId, runId, temperature } = typeof opts === 'string' ? {} as CallLLMOptions : opts;

  const provider = await getPrimaryProvider();
  const apiKey = await getApiKey(provider.id, provider.kind);
  const { url, headers, body } = buildRequest(provider, apiKey, system, user, temperature);

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let full = '';
  let accumulatedUsage: Usage = { promptTokens: 0, completionTokens: 0 };
  let errorMsg: string | null = null;
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${provider.name} API error ${response.status}: ${text}`);
    }
    if (!response.body) throw new Error(`${provider.name} API returned no body`);

    // Coalesce per-token deltas into ~80ms batches. One event per token would
    // blow past the scrollback buffer (MAX_BUFFER=2000) and rerender the
    // transcript on every chunk. Flush when kind flips or the interval elapses.
    const FLUSH_MS = 80;
    let pendingKind: 'text' | 'thinking' | null = null;
    let pendingText = '';
    let lastFlush = Date.now();
    const flushPending = () => {
      if (!pendingKind || !pendingText || !agentId) {
        pendingKind = null;
        pendingText = '';
        return;
      }
      void emitAgentEvent(agentId, { kind: pendingKind, text: pendingText });
      pendingKind = null;
      pendingText = '';
      lastFlush = Date.now();
    };
    const parser = createThinkStreamParser((kind, chunk) => {
      if (!chunk) return;
      if (pendingKind && pendingKind !== kind) flushPending();
      pendingKind = kind;
      pendingText += chunk;
      if (Date.now() - lastFlush >= FLUSH_MS) flushPending();
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let sseBuf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = sseBuf.indexOf('\n')) !== -1) {
        const line = sseBuf.slice(0, nl).trimEnd();
        sseBuf = sseBuf.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const obj: any = JSON.parse(payload);
          const delta = extractDelta(provider.kind, obj);
          if (delta.length > 0) {
            full += delta;
            parser.push(delta);
          }
          const usage = extractUsageFromPayload(provider.kind, obj);
          if (usage) {
            // Anthropic reports prompt_tokens on message_start; output_tokens
            // arrive on the final message_delta. Keep the max of each field
            // so we don't clobber earlier-reported values with later zeros.
            accumulatedUsage = {
              promptTokens: Math.max(accumulatedUsage.promptTokens, usage.promptTokens),
              completionTokens: Math.max(accumulatedUsage.completionTokens, usage.completionTokens),
            };
          }
        } catch { /* heartbeat or non-JSON line */ }
      }
    }
    parser.flush();
    flushPending();

    if (full.length === 0) {
      throw new Error(`${provider.name} API returned empty stream`);
    }
    return stripThinking(full);
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    clearTimeout(timer);
    const completedAt = Date.now();
    const effectiveRunId = runId ?? process.env.ATELIER_RUN_ID;
    if (agentId && effectiveRunId) {
      const costUsd = estimateCost(
        provider.kind,
        provider.selectedModel ?? '',
        accumulatedUsage.promptTokens,
        accumulatedUsage.completionTokens,
      );
      void recordCall(BACKEND, {
        runId: effectiveRunId,
        agentId,
        providerId: provider.id,
        model: provider.selectedModel ?? '',
        kind: 'text',
        promptTokens: accumulatedUsage.promptTokens,
        completionTokens: accumulatedUsage.completionTokens,
        costUsd,
        durationMs: completedAt - startedAt,
        startedAt,
        completedAt,
        error: errorMsg,
      });
    }
  }
}

// Resolve the primary provider's model name (used by notifyAgentStart for the
// init event). Best-effort — falls back to a placeholder if unavailable.
export async function getPrimaryModelName(): Promise<string> {
  try {
    const p = await getPrimaryProvider();
    return p.selectedModel ?? p.name;
  } catch {
    return 'auto';
  }
}
