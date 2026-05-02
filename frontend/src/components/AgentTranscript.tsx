// frontend/src/components/AgentTranscript.tsx
//
// Renders an agent's structured event stream as a calm transcript.

import { useEffect, useRef, useState } from 'react';
import { subscribe, send } from '../lib/ipc';
import { ChevronRight, Wrench, Check, X as XIcon } from 'lucide-react';

type AgentEvent =
  | { kind: 'init'; sessionId: string; model: string; cwd: string; tools: string[]; ts: number }
  | { kind: 'text'; text: string; ts: number }
  | { kind: 'thinking'; text: string; ts: number }
  | { kind: 'tool_use'; toolId: string; name: string; input: unknown; ts: number }
  | { kind: 'tool_result'; toolId: string; content: string; isError: boolean; ts: number }
  | { kind: 'result'; success: boolean; turns: number; durationMs: number; costUsd?: number; text?: string; ts: number }
  | { kind: 'stderr'; text: string; ts: number }
  | { kind: 'exit'; code: number; ts: number };

interface Props {
  agentId: string;
  isActive: boolean;
  autoSubscribe?: boolean;
}

export function AgentTranscript({ agentId, isActive, autoSubscribe = true }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    const unsub = subscribe('agent-event', (payload: { id: string; event: AgentEvent }) => {
      if (payload.id !== agentId) return;
      setEvents((prev) => {
        const last = prev[prev.length - 1];
        const incoming = payload.event;
        if (
          last &&
          (incoming.kind === 'text' || incoming.kind === 'thinking') &&
          last.kind === incoming.kind
        ) {
          const merged = { ...last, text: last.text + incoming.text, ts: incoming.ts };
          return [...prev.slice(0, -1), merged as AgentEvent];
        }
        return [...prev, incoming];
      });
    });
    if (autoSubscribe) send('agent-subscribe', { id: agentId });
    return unsub;
  }, [agentId, autoSubscribe]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events]);

  const toolResultByUseId = new Map<string, AgentEvent & { kind: 'tool_result' }>();
  for (const e of events) if (e.kind === 'tool_result') toolResultByUseId.set(e.toolId, e);

  return (
    <div className="h-full relative overflow-hidden">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-5 py-4 text-[13px] leading-[1.6] text-[var(--color-text-dim)]"
      >
        {events.length === 0 && (
          <div className="flex items-center gap-2 text-[var(--color-text-faint)] text-[12px]">
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'live-dot' : ''}`}
              style={{ background: isActive ? 'var(--color-accent)' : 'var(--color-text-faint)' }}
            />
            <span>{isActive ? 'Awaiting stream' : 'Idle'}</span>
          </div>
        )}

        {events.map((e, idx) => {
          if (e.kind === 'init') return <InitBanner key={idx} event={e} />;
          if (e.kind === 'text') return <TextBlock key={idx} event={e} />;
          if (e.kind === 'thinking') return <ThinkingBlock key={idx} event={e} />;
          if (e.kind === 'tool_use') {
            return <ToolCard key={idx} event={e} result={toolResultByUseId.get(e.toolId)} />;
          }
          if (e.kind === 'tool_result') return null;
          if (e.kind === 'result') return <ResultFooter key={idx} event={e} />;
          if (e.kind === 'stderr') return <StderrLine key={idx} event={e} />;
          if (e.kind === 'exit') return <ExitLine key={idx} event={e} />;
          return null;
        })}

        {isActive && events.some((e) => e.kind !== 'exit' && e.kind !== 'result') && (
          <div className="mt-2 inline-block w-1.5 h-3.5 align-middle live-cursor" style={{ background: 'var(--color-accent)' }} />
        )}
      </div>
    </div>
  );
}

function InitBanner({ event }: { event: Extract<AgentEvent, { kind: 'init' }> }) {
  return (
    <div className="mb-4 fade-in text-[11.5px] text-[var(--color-text-muted)]">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        <span className="text-[var(--color-text-faint)]">Model</span>
        <span className="text-[var(--color-text-dim)] font-mono break-all">{event.model || '—'}</span>
        <span className="text-[var(--color-text-faint)]">Path</span>
        <span className="text-[var(--color-text-dim)] font-mono truncate">{event.cwd || '—'}</span>
        {event.tools.length > 0 && (
          <>
            <span className="text-[var(--color-text-faint)]">Tools</span>
            <span className="flex flex-wrap gap-1">
              {event.tools.slice(0, 8).map((t) => (
                <span key={t} className="px-1.5 py-0 rounded text-[10.5px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-2)]">
                  {t}
                </span>
              ))}
              {event.tools.length > 8 && (
                <span className="text-[10.5px] text-[var(--color-text-faint)] self-center">+{event.tools.length - 8}</span>
              )}
            </span>
          </>
        )}
      </div>
      <div className="mt-3 h-px bg-[var(--color-hair)]" />
    </div>
  );
}

function TextBlock({ event }: { event: Extract<AgentEvent, { kind: 'text' }> }) {
  return (
    <div className="mb-3 fade-in whitespace-pre-wrap text-[var(--color-text)]">
      {event.text}
    </div>
  );
}

function ThinkingBlock({ event }: { event: Extract<AgentEvent, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  const preview = event.text.slice(0, 120).replace(/\s+/g, ' ');
  return (
    <div className="mb-3 fade-in">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-2 w-full text-left text-[var(--color-text-muted)] hover:text-[var(--color-text-dim)] transition-colors"
      >
        <ChevronRight className={`w-3.5 h-3.5 mt-[2px] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[11.5px] text-[var(--color-text-faint)] shrink-0 pt-[1px]">Thinking</span>
        {!open && <span className="italic text-[var(--color-text-faint)] truncate text-[12.5px]">{preview}…</span>}
      </button>
      {open && (
        <div className="ml-6 mt-1.5 pl-3 border-l border-[var(--color-hair)] whitespace-pre-wrap italic text-[var(--color-text-muted)] text-[12.5px]">
          {event.text}
        </div>
      )}
    </div>
  );
}

function ToolCard({
  event,
  result,
}: {
  event: Extract<AgentEvent, { kind: 'tool_use' }>;
  result?: Extract<AgentEvent, { kind: 'tool_result' }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputPreview = summarizeToolInput(event.input);
  const status = !result ? 'running' : result.isError ? 'error' : 'ok';

  return (
    <div className="mb-3 fade-in rounded-md border border-[var(--color-hair)] bg-[var(--color-surface-2)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <Wrench className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        <span className="font-mono text-[12px] text-[var(--color-text)]">{event.name}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px]">
          {status === 'running' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] live-dot" />
              <span className="text-[var(--color-accent)]">Running</span>
            </>
          )}
          {status === 'ok' && (
            <>
              <Check className="w-3 h-3 text-[var(--color-success)]" />
              <span className="text-[var(--color-text-muted)]">Done</span>
            </>
          )}
          {status === 'error' && (
            <>
              <XIcon className="w-3 h-3 text-[var(--color-error)]" />
              <span className="text-[var(--color-error)]">Failed</span>
            </>
          )}
        </span>
      </div>
      <div className="px-3 pb-2.5 text-[12px] text-[var(--color-text-muted)]">
        <div className="font-mono text-[var(--color-text-dim)] break-all text-[11.5px]">{inputPreview}</div>
        {result && (
          <>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition-colors"
            >
              {expanded ? 'Hide output' : 'Show output'}
            </button>
            {expanded && (
              <pre className="mt-2 px-2.5 py-2 rounded bg-[var(--color-ink)] border border-[var(--color-hair)] text-[11px] font-mono text-[var(--color-text-dim)] whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
                {result.content.length > 5000 ? result.content.slice(0, 5000) + '\n… truncated' : result.content}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return String(input ?? '');
  const obj = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'url', 'command', 'pattern', 'query', 'description']) {
    if (typeof obj[key] === 'string') return `${key}: ${obj[key] as string}`;
  }
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function ResultFooter({ event }: { event: Extract<AgentEvent, { kind: 'result' }> }) {
  const color = event.success ? 'var(--color-success)' : 'var(--color-error)';
  return (
    <div className="mt-5 pt-3 border-t border-[var(--color-hair)] flex items-center gap-4 text-[11.5px] text-[var(--color-text-muted)]">
      <span style={{ color }}>{event.success ? 'Complete' : 'Failed'}</span>
      <span className="text-[var(--color-text-faint)]">·</span>
      <span>{event.turns} turn{event.turns === 1 ? '' : 's'}</span>
      <span className="text-[var(--color-text-faint)]">·</span>
      <span className="font-mono">{(event.durationMs / 1000).toFixed(1)}s</span>
      {typeof event.costUsd === 'number' && (
        <>
          <span className="text-[var(--color-text-faint)]">·</span>
          <span className="font-mono">${event.costUsd.toFixed(4)}</span>
        </>
      )}
    </div>
  );
}

function StderrLine({ event }: { event: Extract<AgentEvent, { kind: 'stderr' }> }) {
  return (
    <div className="mb-1 px-2.5 py-1.5 rounded border-l-2 border-[var(--color-error)] bg-[var(--color-error)]/8 text-[11.5px] text-[var(--color-error)]/90 whitespace-pre-wrap font-mono">
      {event.text}
    </div>
  );
}

function ExitLine({ event }: { event: Extract<AgentEvent, { kind: 'exit' }> }) {
  const color = event.code === 0 ? 'var(--color-text-muted)' : 'var(--color-error)';
  return (
    <div className="mt-2 flex items-center gap-2 text-[11px]" style={{ color }}>
      <span className="w-4 border-t border-current opacity-50" />
      Exit · code {event.code}
    </div>
  );
}
