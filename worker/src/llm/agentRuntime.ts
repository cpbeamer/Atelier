export type AgentRuntimeId = 'opencode' | 'claude-code' | 'direct-llm';

export interface AgentRuntimeOption {
  id: AgentRuntimeId;
  label: string;
  description: string;
  capabilities: {
    structuredSessions: boolean;
    terminalAgent: boolean;
    editsFiles: boolean;
    tokenTelemetry: boolean;
    runService: boolean;
  };
}

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';
const VALID_RUNTIMES = new Set<AgentRuntimeId>(['opencode', 'claude-code', 'direct-llm']);

function normalizeRuntime(value: unknown): AgentRuntimeId | null {
  return typeof value === 'string' && VALID_RUNTIMES.has(value as AgentRuntimeId)
    ? value as AgentRuntimeId
    : null;
}

function runtimeFromEnv(): AgentRuntimeId {
  const explicit = normalizeRuntime(process.env.ATELIER_AGENT_RUNTIME);
  if (explicit) return explicit;
  if (process.env.ATELIER_USE_OPENCODE === '1') return 'opencode';
  return 'direct-llm';
}

export async function getAgentRuntime(): Promise<AgentRuntimeId> {
  try {
    const response = await fetch(`${BACKEND}/api/settings/agentRuntime`);
    if (response.ok) {
      const data = await response.json() as { agentRuntime?: unknown };
      const runtime = normalizeRuntime(data.agentRuntime);
      if (runtime) return runtime;
    }
  } catch {
    // Backend unreachable — fall through to developer-mode env vars.
  }
  return runtimeFromEnv();
}

export async function useStructuredAgentRuntime(): Promise<boolean> {
  return (await getAgentRuntime()) === 'opencode';
}

export async function useTerminalAgentRuntime(): Promise<boolean> {
  const runtime = await getAgentRuntime();
  return runtime === 'opencode' || runtime === 'claude-code';
}

// Compatibility for older call sites while the codebase migrates to runtime ids.
export async function useOpencode(): Promise<boolean> {
  return (await getAgentRuntime()) === 'opencode';
}
