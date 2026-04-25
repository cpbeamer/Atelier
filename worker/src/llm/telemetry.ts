import type { ProviderKind } from './callLLM';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

// USD per 1,000,000 tokens [prompt, completion]. Edit when provider rates change.
// Unknown model → zeros (we still track token counts, just no dollar figure).
const RATES: Record<string, [number, number]> = {
  'minimax:MiniMax-M2.7': [0.30, 1.20],
  'minimax:MiniMax-Text-01': [0.20, 1.10],
  'anthropic:claude-opus-4-7': [15.0, 75.0],
  'anthropic:claude-sonnet-4-6': [3.0, 15.0],
  'anthropic:claude-haiku-4-5-20251001': [0.80, 4.0],
};

export function estimateCost(
  providerKind: ProviderKind,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rates = RATES[`${providerKind}:${model}`];
  if (!rates) return 0;
  const [pRate, cRate] = rates;
  return (promptTokens * pRate + completionTokens * cRate) / 1_000_000;
}

export function extractUsageFromPayload(kind: ProviderKind, payload: unknown): Usage | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, any>;

  if (kind === 'anthropic') {
    if (p.type === 'message_start' && p.message?.usage) {
      return {
        promptTokens: p.message.usage.input_tokens ?? 0,
        completionTokens: p.message.usage.output_tokens ?? 0,
      };
    }
    if (p.type === 'message_delta' && p.usage) {
      return {
        promptTokens: p.usage.input_tokens ?? 0,
        completionTokens: p.usage.output_tokens ?? 0,
      };
    }
    return null;
  }

  // MiniMax + openai-compatible both send a usage block on the final chunk.
  if (p.usage && (p.usage.total_tokens != null || p.usage.prompt_tokens != null)) {
    return {
      promptTokens: p.usage.prompt_tokens ?? 0,
      completionTokens: p.usage.completion_tokens ?? 0,
    };
  }
  return null;
}

export interface CallRecord {
  runId: string;
  agentId: string;
  providerId: string;
  model: string;
  kind?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  startedAt: number;
  completedAt: number;
  error?: string | null;
}

// Fire-and-forget POST to the backend's /api/agent/call endpoint. Failures are
// swallowed so telemetry can never break a workflow run.
export async function recordCall(backendUrl: string, row: CallRecord): Promise<void> {
  try {
    await fetch(`${backendUrl}/api/agent/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });
  } catch { /* non-fatal */ }
}
