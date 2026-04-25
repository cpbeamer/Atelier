// frontend/src/components/AgentTranscript.tsx
//
// Renders a structured stream of agent events (as produced by `claude
// --output-format stream-json`) as a control-room transcript: system init
// banner, assistant text, tool_use cards with attached tool_results,
// thinking blocks, and a final result summary.

import { useEffect, useRef, useState } from 'react';
import { subscribe, send } from '../lib/ipc';
import { ChevronRight, Wrench, CheckCircle2, XCircle, Cpu, Sparkles } from 'lucide-react';

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
}

export function AgentTranscript({ agentId, isActive }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    const unsub = subscribe('agent-event', (payload: { id: string; event: AgentEvent }) => {
      if (payload.id !== agentId) return;
      setEvents((prev) => {
        // Streaming deltas arrive coalesced at ~80ms intervals. Merge adjacent
        // same-kind chunks so the transcript renders as one flowing block per
        // run, not a stack of sparkle-prefixed slivers.
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
    send('agent-subscribe', { id: agentId });
    return unsub;
  }, [agentId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Auto-scroll only if user is near the bottom.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events]);

  const toolResultByUseId = new Map<string, AgentEvent & { kind: 'tool_result' }>();
  for (const e of events) if (e.kind === 'tool_result') toolResultByUseId.set(e.toolId, e);

  return (
    <div className="h-full relative bg-[#0a0b0d] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 scanlines opacity-[0.06] mix-blend-screen" />
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-5 py-4 font-body text-[13px] leading-[1.55] text-[#d4d2cc]"
      >
        {events.length === 0 && (
          <div className="flex items-center gap-2 text-[#4a4d52]">
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#d4ff00] live-dot' : 'bg-[#3a3d42]'}`} />
            <span className="text-[11px] uppercase tracking-[0.25em] font-display">
              {isActive ? 'awaiting stream' : 'idle'}
            </span>
          </div>
        )}

        {events.map((e, idx) => {
          if (e.kind === 'init') return <InitBanner key={idx} event={e} />;
          if (e.kind === 'text') return <TextBlock key={idx} event={e} />;
          if (e.kind === 'thinking') return <ThinkingBlock key={idx} event={e} />;
          if (e.kind === 'tool_use') {
            return <ToolCard key={idx} event={e} result={toolResultByUseId.get(e.toolId)} />;
          }
          if (e.kind === 'tool_result') return null; // Rendered inside its tool_use card
          if (e.kind === 'result') return <ResultFooter key={idx} event={e} />;
          if (e.kind === 'stderr') return <StderrLine key={idx} event={e} />;
          if (e.kind === 'exit') return <ExitLine key={idx} event={e} />;
          return null;
        })}

        {isActive && events.some((e) => e.kind !== 'exit' && e.kind !== 'result') && (
          <div className="mt-2 flex items-center gap-2 text-[#6b6b68]">
            <span className="w-1 h-3 bg-[#d4ff00] live-cursor" />
            <span className="text-[10px] uppercase tracking-[0.3em] font-display text-[#4a4d52]">live</span>
          </div>
        )}
      </div>
    </div>
  );
}

function timecode(ts: number) {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function InitBanner({ event }: { event: Extract<AgentEvent, { kind: 'init' }> }) {
  return (
    <div className="mb-4 border border-[#1e2024] bg-[#101114] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2 text-[#63d4ff]">
        <Cpu className="w-3 h-3" />
        <span className="font-display uppercase tracking-[0.25em]">session open</span>
        <span className="ml-auto text-[#4a4d52]">{timecode(event.ts)}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[#8a8d92]">
        <span className="text-[#4a4d52]">model</span>
        <span className="text-[#d4d2cc] break-all">{event.model || '—'}</span>
        <span className="text-[#4a4d52]">cwd</span>
        <span className="truncate text-[#d4d2cc]">{event.cwd || '—'}</span>
        <span className="text-[#4a4d52]">tools</span>
        <span className="flex flex-wrap gap-1">
          {event.tools.slice(0, 12).map((t) => (
            <span key={t} className="px-1.5 py-[1px] border border-[#1e2024] text-[10px] text-[#8a8d92] font-display tracking-wider">
              {t}
            </span>
          ))}
          {event.tools.length > 12 && (
            <span className="text-[10px] text-[#4a4d52]">+{event.tools.length - 12}</span>
          )}
        </span>
      </div>
    </div>
  );
}

function TextBlock({ event }: { event: Extract<AgentEvent, { kind: 'text' }> }) {
  return (
    <div className="mb-3 flex gap-3">
      <div className="shrink-0 pt-[3px]">
        <Sparkles className="w-3 h-3 text-[#d4ff00]" />
      </div>
      <div className="flex-1 whitespace-pre-wrap text-[#e8e6e0]">{event.text}</div>
    </div>
  );
}

function ThinkingBlock({ event }: { event: Extract<AgentEvent, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  const preview = event.text.slice(0, 140).replace(/\s+/g, ' ');
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-2 w-full text-left hover:text-[#8a8d92] transition-colors text-[#5a5d62]"
      >
        <ChevronRight className={`w-3 h-3 mt-[3px] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[10px] uppercase tracking-[0.3em] font-display text-[#4a4d52] shrink-0 pt-[1px]">thinking</span>
        {!open && <span className="italic text-[#5a5d62] truncate">{preview}…</span>}
      </button>
      {open && (
        <div className="ml-5 mt-1 pl-3 border-l border-[#1e2024] whitespace-pre-wrap italic text-[#7a7d82] text-[12px]">
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
  const statusColor =
    status === 'running' ? '#ffb84a' : status === 'error' ? '#ff6b5a' : '#d4ff00';

  return (
    <div className="mb-3 border border-[#1e2024] bg-[#0d0f12]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1e2024] bg-[#101114]">
        <Wrench className="w-3 h-3 text-[#ffb84a]" />
        <span className="font-display uppercase tracking-[0.25em] text-[10px] text-[#8a8d92]">tool</span>
        <span className="font-display text-[12px] text-[#e8e6e0]">{event.name}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-[#ffb84a] animate-pulse" />}
          {status === 'ok' && <CheckCircle2 className="w-3 h-3" style={{ color: statusColor }} />}
          {status === 'error' && <XCircle className="w-3 h-3" style={{ color: statusColor }} />}
          <span className="font-display uppercase tracking-[0.25em] text-[10px]" style={{ color: statusColor }}>
            {status}
          </span>
        </span>
      </div>
      <div className="px-3 py-2 text-[12px] text-[#8a8d92]">
        <div className="font-body text-[#d4d2cc] break-all">{inputPreview}</div>
        {result && (
          <>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[10px] uppercase tracking-[0.25em] font-display text-[#4a4d52] hover:text-[#8a8d92]"
            >
              {expanded ? '— collapse output' : '+ show output'}
            </button>
            {expanded && (
              <pre className="mt-2 px-2 py-1.5 bg-[#060708] border border-[#1e2024] text-[11px] text-[#a8a69f] whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
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
  // Heuristics: surface the most informative field first.
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
  const color = event.success ? '#d4ff00' : '#ff6b5a';
  return (
    <div className="mt-5 border-t border-[#1e2024] pt-3 flex items-center gap-4 text-[11px] font-display uppercase tracking-[0.25em]">
      <span style={{ color }}>{event.success ? 'complete' : 'failed'}</span>
      <span className="text-[#4a4d52]">
        <span className="text-[#8a8d92]">{event.turns}</span> turns
      </span>
      <span className="text-[#4a4d52]">
        <span className="text-[#8a8d92]">{(event.durationMs / 1000).toFixed(1)}s</span>
      </span>
      {typeof event.costUsd === 'number' && (
        <span className="text-[#4a4d52]">
          <span className="text-[#8a8d92]">${event.costUsd.toFixed(4)}</span>
        </span>
      )}
    </div>
  );
}

function StderrLine({ event }: { event: Extract<AgentEvent, { kind: 'stderr' }> }) {
  return (
    <div className="mb-1 px-2 py-1 border-l-2 border-[#ff6b5a] bg-[#170e0e] text-[11px] text-[#ff9b8f] whitespace-pre-wrap">
      {event.text}
    </div>
  );
}

function ExitLine({ event }: { event: Extract<AgentEvent, { kind: 'exit' }> }) {
  const color = event.code === 0 ? '#8a8d92' : '#ff6b5a';
  return (
    <div className="mt-2 flex items-center gap-2 text-[10px] font-display uppercase tracking-[0.3em]" style={{ color }}>
      <span className="w-4 border-t border-current" />
      exit · code {event.code}
    </div>
  );
}
