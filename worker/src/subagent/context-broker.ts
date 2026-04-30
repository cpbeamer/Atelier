export interface RunContext {
  facts: string[];
  fileFindings: Array<{ path: string; summary: string; sourceAgentId: string }>;
  decisions: string[];
  openQuestions: string[];
  issues: string[];
  verification: string[];
  gotchas: string[];
  agentSummaries: Array<{
    agentId: string;
    agentName: string;
    category?: string;
    summary: string;
    createdAt: number;
  }>;
}

export interface ContextBrokerOptions {
  backendUrl?: string;
}

export interface AgentContextSummaryInput {
  agentId: string;
  agentName: string;
  category?: string;
  output?: string;
  error?: string;
}

const EMPTY_CONTEXT: RunContext = {
  facts: [],
  fileFindings: [],
  decisions: [],
  openQuestions: [],
  issues: [],
  verification: [],
  gotchas: [],
  agentSummaries: [],
};

export class ContextBroker {
  private backendUrl: string;

  constructor(options: ContextBrokerOptions = {}) {
    this.backendUrl = options.backendUrl ?? 'http://localhost:3001';
  }

  async get(runId?: string): Promise<RunContext> {
    if (!runId) return emptyContext();
    try {
      const response = await fetch(`${this.backendUrl}/api/runs/${encodeURIComponent(runId)}/context`);
      if (!response.ok) return emptyContext();
      return normalizeRunContext(await response.json());
    } catch {
      return emptyContext();
    }
  }

  async append(runId: string | undefined, patch: Partial<RunContext>): Promise<void> {
    if (!runId) return;
    try {
      await fetch(`${this.backendUrl}/api/runs/${encodeURIComponent(runId)}/context/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: normalizeRunContext(patch) }),
      });
    } catch {
      // Shared context improves orchestration, but agent execution should not
      // fail just because the UI/backend context channel is unavailable.
    }
  }

  async formatForPrompt(runId?: string): Promise<string> {
    const context = await this.get(runId);
    const sections: string[] = [];

    const facts = context.facts.slice(-8);
    if (facts.length > 0) sections.push(`Facts:\n${facts.map((f) => `- ${f}`).join('\n')}`);

    const decisions = context.decisions.slice(-6);
    if (decisions.length > 0) sections.push(`Decisions:\n${decisions.map((d) => `- ${d}`).join('\n')}`);

    const fileFindings = context.fileFindings.slice(-10);
    if (fileFindings.length > 0) {
      sections.push(`File findings:\n${fileFindings.map((f) => `- ${f.path}: ${f.summary}`).join('\n')}`);
    }

    const gotchas = context.gotchas.slice(-6);
    if (gotchas.length > 0) sections.push(`Gotchas:\n${gotchas.map((g) => `- ${g}`).join('\n')}`);

    const openQuestions = context.openQuestions.slice(-5);
    if (openQuestions.length > 0) sections.push(`Open questions:\n${openQuestions.map((q) => `- ${q}`).join('\n')}`);

    const recent = context.agentSummaries.slice(-5);
    if (recent.length > 0) {
      sections.push(`Recent agent summaries:\n${recent.map((s) => `- ${s.agentName}: ${s.summary}`).join('\n')}`);
    }

    return sections.length > 0 ? `\n\n## Shared Run Context\n${sections.join('\n\n')}` : '';
  }

  async recordAgentResult(runId: string | undefined, input: AgentContextSummaryInput): Promise<void> {
    if (!runId) return;
    const summary = summarizeOutput(input.output ?? input.error ?? '');
    const patch: Partial<RunContext> = {
      agentSummaries: [{
        agentId: input.agentId,
        agentName: input.agentName,
        category: input.category,
        summary,
        createdAt: Date.now(),
      }],
    };

    const parsed = tryParseJsonObject(input.output);
    if (parsed) {
      Object.assign(patch, contextPatchFromStructuredOutput(parsed, input.agentId));
    } else if (input.error) {
      patch.issues = [`${input.agentName} failed: ${summarizeOutput(input.error)}`];
    }

    await this.append(runId, patch);
  }
}

export const contextBroker = new ContextBroker();

export function normalizeRunContext(value: unknown): RunContext {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    facts: stringArray(input.facts),
    fileFindings: fileFindingArray(input.fileFindings),
    decisions: stringArray(input.decisions),
    openQuestions: stringArray(input.openQuestions),
    issues: stringArray(input.issues),
    verification: stringArray(input.verification),
    gotchas: stringArray(input.gotchas),
    agentSummaries: agentSummaryArray(input.agentSummaries),
  };
}

function emptyContext(): RunContext {
  return {
    facts: [...EMPTY_CONTEXT.facts],
    fileFindings: [...EMPTY_CONTEXT.fileFindings],
    decisions: [...EMPTY_CONTEXT.decisions],
    openQuestions: [...EMPTY_CONTEXT.openQuestions],
    issues: [...EMPTY_CONTEXT.issues],
    verification: [...EMPTY_CONTEXT.verification],
    gotchas: [...EMPTY_CONTEXT.gotchas],
    agentSummaries: [...EMPTY_CONTEXT.agentSummaries],
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function fileFindingArray(value: unknown): RunContext['fileFindings'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.path !== 'string' || typeof row.summary !== 'string') return [];
    return [{
      path: row.path,
      summary: row.summary,
      sourceAgentId: typeof row.sourceAgentId === 'string' ? row.sourceAgentId : 'unknown',
    }];
  });
}

function agentSummaryArray(value: unknown): RunContext['agentSummaries'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.agentId !== 'string' || typeof row.agentName !== 'string' || typeof row.summary !== 'string') return [];
    return [{
      agentId: row.agentId,
      agentName: row.agentName,
      category: typeof row.category === 'string' ? row.category : undefined,
      summary: row.summary,
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
    }];
  });
}

function summarizeOutput(output: string): string {
  const compact = output.replace(/\s+/g, ' ').trim();
  if (!compact) return '(no output)';
  return compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
}

function tryParseJsonObject(output: string | undefined): Record<string, unknown> | null {
  if (!output) return null;
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function contextPatchFromStructuredOutput(output: Record<string, unknown>, sourceAgentId: string): Partial<RunContext> {
  const patch: Partial<RunContext> = {};

  const recommended = stringArray(output.recommendedContextForNextAgents);
  const facts = stringArray(output.facts);
  const conventions = stringArray(output.conventions);
  if (recommended.length > 0 || facts.length > 0 || conventions.length > 0) {
    patch.facts = [...facts, ...conventions, ...recommended];
  }

  const openQuestions = stringArray(output.openQuestions);
  if (openQuestions.length > 0) patch.openQuestions = openQuestions;

  const gotchas = stringArray(output.gotchas);
  if (gotchas.length > 0) patch.gotchas = gotchas;

  const issues = stringArray(output.issues);
  const gaps = stringArray(output.gaps);
  if (issues.length > 0 || gaps.length > 0) patch.issues = [...issues, ...gaps];

  const verification = stringArray(output.verification);
  if (verification.length > 0) patch.verification = verification;

  const decisions = stringArray(output.decisions);
  if (decisions.length > 0) patch.decisions = decisions;

  const fileFindings = fileFindingArray(output.fileFindings)
    .map((finding) => ({ ...finding, sourceAgentId: finding.sourceAgentId || sourceAgentId }));
  if (fileFindings.length > 0) patch.fileFindings = fileFindings;

  return patch;
}
