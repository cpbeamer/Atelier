// frontend/src/components/WorkflowGraph.tsx
import { useState, useEffect, useMemo } from 'react';
import { getPipeline } from '../lib/pipelines';
import { subscribe } from '../lib/ipc';

interface WorkflowNode {
  id: string;
  name: string;
  type: 'agent' | 'milestone' | 'condition';
  status: 'pending' | 'running' | 'completed' | 'failed';
  runs: number;
}

interface Props {
  runId?: string;
  workflowType?: string;
}

export function WorkflowGraph({ runId, workflowType }: Props) {
  const template = useMemo(() => getPipeline(workflowType), [workflowType]);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);

  useEffect(() => {
    setNodes(template.map(n => ({
      id: n.agentId,
      name: n.name,
      type: n.type,
      status: 'pending',
      runs: 0,
    })));
  }, [runId, template]);

  useEffect(() => {
    if (!runId || template.length === 0) return;

    const ws = new WebSocket('ws://localhost:3000');

    ws.onmessage = (event) => {
      let msg: { type?: string; payload?: { agentId?: string; status?: string } };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const id = msg.payload?.agentId;
      if (!id) return;

      if (msg.type === 'agent:started') {
        setNodes(prev => prev.map(n =>
          n.id === id ? { ...n, status: 'running', runs: n.runs + 1 } : n
        ));
      } else if (msg.type === 'agent:completed') {
        const failed = msg.payload?.status === 'error';
        setNodes(prev => prev.map(n =>
          n.id === id ? { ...n, status: failed ? 'failed' : 'completed' } : n
        ));
      }
    };

    return () => ws.close();
  }, [runId, template]);

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 pt-5 pb-4">
        <div className="text-[11px] text-[var(--color-text-faint)] mb-1">Pipeline</div>
        <div className="text-[15px] font-medium text-[var(--color-text)]">Workflow</div>
      </div>

      {template.length === 0 ? (
        <div className="px-5 text-[12px] text-[var(--color-text-muted)]">
          No pipeline defined for this workflow.
        </div>
      ) : (
        <div className="pb-6 px-1">
          {nodes.map((node, idx) => {
            const isLast = idx === nodes.length - 1;
            const dotColor =
              node.status === 'running' ? 'var(--color-accent)'
              : node.status === 'completed' ? 'var(--color-success)'
              : node.status === 'failed' ? 'var(--color-error)'
              : 'var(--color-text-faint)';

            const lineColor =
              node.status === 'completed' ? 'var(--color-success)'
              : node.status === 'running' ? 'var(--color-accent)'
              : 'var(--color-hair)';

            return (
              <div key={node.id} className="relative px-5">
                {!isLast && (
                  <div
                    className="absolute left-[27px] top-7 bottom-[-12px] w-px"
                    style={{ background: lineColor, opacity: node.status === 'pending' ? 1 : 0.4 }}
                  />
                )}
                <div className="relative flex items-start gap-3 py-2.5">
                  <span
                    className={`relative mt-[3px] w-2 h-2 rounded-full shrink-0 ${node.status === 'running' ? 'live-dot' : ''}`}
                    style={{ background: dotColor }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--color-text)] truncate leading-tight">
                      {node.name}
                    </div>
                    <div className="text-[11px] mt-0.5 text-[var(--color-text-muted)]">
                      {labelFor(node.type, node.status, node.runs)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <RunContextPanel runId={runId} />
    </div>
  );
}

function labelFor(type: WorkflowNode['type'], status: WorkflowNode['status'], runs: number): string {
  const t = type === 'agent' ? 'Agent' : type === 'milestone' ? 'Milestone' : 'Condition';
  const s = status === 'pending' ? 'pending' : status === 'running' ? 'running' : status === 'completed' ? 'done' : 'failed';
  const suffix = runs > 1 ? ` · ×${runs}` : '';
  return `${t} · ${s}${suffix}`;
}

interface RunContext {
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

function RunContextPanel({ runId }: { runId?: string }) {
  const [context, setContext] = useState<RunContext>(EMPTY_CONTEXT);

  useEffect(() => {
    let cancelled = false;
    setContext(EMPTY_CONTEXT);
    if (!runId) return;

    const load = async () => {
      try {
        const response = await fetch(`http://localhost:3001/api/runs/${encodeURIComponent(runId)}/context`);
        if (!response.ok) return;
        const next = await response.json();
        if (!cancelled) setContext(normalizeContext(next));
      } catch {
        if (!cancelled) setContext(EMPTY_CONTEXT);
      }
    };

    void load();
    const unsub = subscribe('run:context-updated', (payload: { runId?: string; context?: unknown }) => {
      if (payload?.runId !== runId) return;
      setContext(normalizeContext(payload.context));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [runId]);

  const hasContext = context.facts.length > 0
    || context.fileFindings.length > 0
    || context.decisions.length > 0
    || context.openQuestions.length > 0
    || context.issues.length > 0
    || context.verification.length > 0
    || context.gotchas.length > 0
    || context.agentSummaries.length > 0;

  return (
    <div className="border-t border-[var(--color-hair)] px-5 py-4">
      <div className="text-[11px] text-[var(--color-text-faint)] mb-1">Shared Context</div>
      <div className="text-[15px] font-medium text-[var(--color-text)] mb-3">Run Packet</div>
      {!runId ? (
        <div className="text-[12px] text-[var(--color-text-muted)]">Context starts when a run is active.</div>
      ) : !hasContext ? (
        <div className="text-[12px] text-[var(--color-text-muted)]">No shared context recorded yet.</div>
      ) : (
        <div className="space-y-4">
          <ContextList title="Facts" items={context.facts.slice(-6)} />
          <ContextList title="Decisions" items={context.decisions.slice(-5)} />
          <ContextList title="Issues" items={[...context.issues, ...context.gotchas].slice(-6)} />
          <ContextList title="Verification" items={context.verification.slice(-5)} />
          {context.fileFindings.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">Files</div>
              <div className="space-y-2">
                {context.fileFindings.slice(-6).map((finding, idx) => (
                  <div key={`${finding.path}-${idx}`} className="text-[12px] leading-snug">
                    <div className="font-mono text-[var(--color-text-dim)] truncate">{finding.path}</div>
                    <div className="mt-0.5 text-[var(--color-text-muted)]">{finding.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {context.agentSummaries.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">Recent Agents</div>
              <div className="space-y-2">
                {context.agentSummaries.slice(-5).map((summary, idx) => (
                  <div key={`${summary.agentId}-${summary.createdAt}-${idx}`} className="text-[12px] leading-snug">
                    <div className="text-[var(--color-text-dim)] truncate">{summary.agentName}</div>
                    <div className="mt-0.5 text-[var(--color-text-muted)]">{summary.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">{title}</div>
      <ul className="space-y-1.5">
        {items.map((item, idx) => (
          <li key={`${title}-${idx}`} className="text-[12px] leading-snug text-[var(--color-text-muted)]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function normalizeContext(value: unknown): RunContext {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    facts: stringArray(input.facts),
    fileFindings: Array.isArray(input.fileFindings)
      ? input.fileFindings.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        if (typeof row.path !== 'string' || typeof row.summary !== 'string') return [];
        return [{
          path: row.path,
          summary: row.summary,
          sourceAgentId: typeof row.sourceAgentId === 'string' ? row.sourceAgentId : 'unknown',
        }];
      })
      : [],
    decisions: stringArray(input.decisions),
    openQuestions: stringArray(input.openQuestions),
    issues: stringArray(input.issues),
    verification: stringArray(input.verification),
    gotchas: stringArray(input.gotchas),
    agentSummaries: Array.isArray(input.agentSummaries)
      ? input.agentSummaries.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        if (typeof row.agentId !== 'string' || typeof row.agentName !== 'string' || typeof row.summary !== 'string') return [];
        return [{
          agentId: row.agentId,
          agentName: row.agentName,
          category: typeof row.category === 'string' ? row.category : undefined,
          summary: row.summary,
          createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
        }];
      })
      : [],
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}
