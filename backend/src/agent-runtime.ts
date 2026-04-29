export type AgentRuntimeId = 'opencode' | 'claude-code' | 'direct-llm';

export interface AgentRuntimeOption {
  id: AgentRuntimeId;
  label: string;
  description: string;
  requiresBinary?: string;
  capabilities: {
    structuredSessions: boolean;
    terminalAgent: boolean;
    editsFiles: boolean;
    tokenTelemetry: boolean;
    runService: boolean;
  };
}

export const DEFAULT_AGENT_RUNTIME: AgentRuntimeId = 'opencode';

export const AGENT_RUNTIMES: AgentRuntimeOption[] = [
  {
    id: 'opencode',
    label: 'opencode',
    description: 'Structured opencode serve sessions with tool use and token telemetry.',
    requiresBinary: 'opencode',
    capabilities: {
      structuredSessions: true,
      terminalAgent: true,
      editsFiles: true,
      tokenTelemetry: true,
      runService: true,
    },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Runs Claude Code as a terminal CLI agent in the worktree.',
    requiresBinary: 'claude',
    capabilities: {
      structuredSessions: false,
      terminalAgent: true,
      editsFiles: true,
      tokenTelemetry: false,
      runService: false,
    },
  },
  {
    id: 'direct-llm',
    label: 'Direct LLM',
    description: 'Legacy one-shot model calls with parsed file edit blocks.',
    capabilities: {
      structuredSessions: false,
      terminalAgent: false,
      editsFiles: true,
      tokenTelemetry: true,
      runService: false,
    },
  },
];

export function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return typeof value === 'string' && AGENT_RUNTIMES.some((runtime) => runtime.id === value);
}

export function runtimeFromLegacyUseOpencode(value: string | null): AgentRuntimeId | null {
  if (value === 'true') return 'opencode';
  if (value === 'false') return 'direct-llm';
  return null;
}
