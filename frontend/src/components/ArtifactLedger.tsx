// frontend/src/components/ArtifactLedger.tsx
//
// Review surface for durable run outputs. The ledger is built from the shared
// run context packet that agents append to as each stage completes.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, FileText, HelpCircle, ListChecks, MessageSquareText } from 'lucide-react';
import { subscribe } from '../lib/ipc';

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

type ArtifactKind = 'summary' | 'file' | 'decision' | 'verification' | 'issue' | 'question' | 'fact';

interface Artifact {
  id: string;
  kind: ArtifactKind;
  stage: string;
  title: string;
  body: string;
  source?: string;
  createdAt?: number;
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

export function ArtifactLedger({ runId }: { runId?: string }) {
  const [context, setContext] = useState<RunContext>(EMPTY_CONTEXT);
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [activeStage, setActiveStage] = useState<string>('All');

  useEffect(() => {
    let cancelled = false;
    setContext(EMPTY_CONTEXT);
    setReviewed(new Set());
    setActiveStage('All');
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

  const artifacts = useMemo(() => buildArtifacts(context), [context]);
  const stages = useMemo(() => ['All', ...Array.from(new Set(artifacts.map((artifact) => artifact.stage)))], [artifacts]);
  const visibleArtifacts = activeStage === 'All'
    ? artifacts
    : artifacts.filter((artifact) => artifact.stage === activeStage);

  const reviewedCount = artifacts.filter((artifact) => reviewed.has(artifact.id)).length;

  const toggleReviewed = (id: string) => {
    setReviewed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b border-[var(--color-hair)]">
        <div className="text-[11px] text-[var(--color-text-faint)] mb-1">Review</div>
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-[var(--color-text-muted)]" />
          <div className="text-[15px] font-medium text-[var(--color-text)]">Artifact Ledger</div>
          <div className="ml-auto text-[11px] font-mono text-[var(--color-text-faint)]">
            {reviewedCount}/{artifacts.length}
          </div>
        </div>
      </div>

      {stages.length > 1 && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--color-hair)] overflow-x-auto">
          <div className="flex gap-1">
            {stages.map((stage) => (
              <button
                key={stage}
                onClick={() => setActiveStage(stage)}
                className={`h-7 px-2.5 rounded-md text-[11px] whitespace-nowrap transition-colors ${
                  activeStage === stage
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                }`}
              >
                {stage}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {!runId ? (
          <EmptyLedger message="Artifacts appear when a run is active." />
        ) : artifacts.length === 0 ? (
          <EmptyLedger message="No artifacts recorded yet." />
        ) : visibleArtifacts.length === 0 ? (
          <EmptyLedger message="No artifacts in this stage." />
        ) : (
          <div className="space-y-2">
            {visibleArtifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                reviewed={reviewed.has(artifact.id)}
                onToggleReviewed={() => toggleReviewed(artifact.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactCard({
  artifact,
  reviewed,
  onToggleReviewed,
}: {
  artifact: Artifact;
  reviewed: boolean;
  onToggleReviewed: () => void;
}) {
  const meta = kindMeta(artifact.kind);
  return (
    <article className="rounded-md border border-[var(--color-hair)] bg-[var(--color-surface)] overflow-hidden">
      <div className="px-3 py-2.5 flex items-start gap-2.5">
        <span className="mt-[2px] text-[var(--color-text-muted)]">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-mono text-[var(--color-text-faint)] shrink-0">{artifact.stage}</span>
            <span className="text-[11px] text-[var(--color-text-faint)] shrink-0">/</span>
            <span className="text-[11px] text-[var(--color-text-muted)] truncate">{meta.label}</span>
          </div>
          <div className="mt-1 text-[13px] leading-snug text-[var(--color-text)] break-words">
            {artifact.title}
          </div>
          {artifact.body && artifact.body !== artifact.title && (
            <div className="mt-1.5 text-[12px] leading-snug text-[var(--color-text-muted)] break-words">
              {artifact.body}
            </div>
          )}
          {artifact.source && (
            <div className="mt-2 text-[10.5px] text-[var(--color-text-faint)] truncate">
              Source: {artifact.source}
            </div>
          )}
        </div>
        <button
          onClick={onToggleReviewed}
          className={`shrink-0 mt-0.5 p-1 rounded transition-colors ${
            reviewed
              ? 'text-[var(--color-success)] hover:bg-[var(--color-success)]/10'
              : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
          }`}
          title={reviewed ? 'Mark unreviewed' : 'Mark reviewed'}
        >
          {reviewed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
        </button>
      </div>
    </article>
  );
}

function EmptyLedger({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-center text-[12px] text-[var(--color-text-faint)]">
      {message}
    </div>
  );
}

function buildArtifacts(context: RunContext): Artifact[] {
  const artifacts: Artifact[] = [];

  context.agentSummaries.forEach((summary, index) => {
    artifacts.push({
      id: `summary-${summary.agentId}-${summary.createdAt}-${index}`,
      kind: 'summary',
      stage: stageFor(summary.category || summary.agentName || summary.agentId),
      title: summary.agentName,
      body: summary.summary,
      source: summary.agentId,
      createdAt: summary.createdAt,
    });
  });

  context.fileFindings.forEach((finding, index) => {
    artifacts.push({
      id: `file-${finding.path}-${index}`,
      kind: 'file',
      stage: stageFor(finding.sourceAgentId),
      title: finding.path,
      body: finding.summary,
      source: finding.sourceAgentId,
    });
  });

  addTextArtifacts(artifacts, 'decision', 'Decisions', context.decisions);
  addTextArtifacts(artifacts, 'verification', 'Verification', context.verification);
  addTextArtifacts(artifacts, 'issue', 'Issues', [...context.issues, ...context.gotchas]);
  addTextArtifacts(artifacts, 'question', 'Questions', context.openQuestions);
  addTextArtifacts(artifacts, 'fact', 'Research', context.facts);

  return artifacts.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function addTextArtifacts(artifacts: Artifact[], kind: ArtifactKind, stage: string, items: string[]) {
  items.forEach((item, index) => {
    artifacts.push({
      id: `${kind}-${index}-${item.slice(0, 40)}`,
      kind,
      stage,
      title: item,
      body: item,
    });
  });
}

function stageFor(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('research') || lower.includes('librarian') || lower.includes('explorer')) return 'Research';
  if (lower.includes('debate') || lower.includes('signal') || lower.includes('noise')) return 'Debate';
  if (lower.includes('ticket')) return 'Ticket';
  if (lower.includes('architect') || lower.includes('design')) return 'Architecture';
  if (lower.includes('developer') || lower.includes('implement')) return 'Build';
  if (lower.includes('review') || lower.includes('test') || lower.includes('verifier')) return 'Verification';
  if (lower.includes('push') || lower.includes('ship')) return 'Ship';
  return 'General';
}

function kindMeta(kind: ArtifactKind) {
  if (kind === 'file') return { label: 'File finding', icon: <FileText className="w-3.5 h-3.5" /> };
  if (kind === 'decision') return { label: 'Decision', icon: <ListChecks className="w-3.5 h-3.5" /> };
  if (kind === 'verification') return { label: 'Verification', icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  if (kind === 'issue') return { label: 'Issue', icon: <AlertTriangle className="w-3.5 h-3.5" /> };
  if (kind === 'question') return { label: 'Question', icon: <HelpCircle className="w-3.5 h-3.5" /> };
  if (kind === 'fact') return { label: 'Fact', icon: <MessageSquareText className="w-3.5 h-3.5" /> };
  return { label: 'Summary', icon: <MessageSquareText className="w-3.5 h-3.5" /> };
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
