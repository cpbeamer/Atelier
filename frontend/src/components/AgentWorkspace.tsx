// frontend/src/components/AgentWorkspace.tsx
//
// Compact operator view for many parallel agents: every agent is visible in a
// roster, while one selected agent owns the detailed transcript.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, Clock, Plus, Radio, Square, X } from 'lucide-react';
import { send, subscribe } from '../lib/ipc';
import { AgentTranscript } from './AgentTranscript';
import type { TerminalPaneConfig } from './TerminalGrid';

type AgentEvent =
  | { kind: 'init'; sessionId: string; model: string; cwd: string; tools: string[]; ts: number }
  | { kind: 'text'; text: string; ts: number }
  | { kind: 'thinking'; text: string; ts: number }
  | { kind: 'tool_use'; toolId: string; name: string; input: unknown; ts: number }
  | { kind: 'tool_result'; toolId: string; content: string; isError: boolean; ts: number }
  | { kind: 'result'; success: boolean; turns: number; durationMs: number; costUsd?: number; text?: string; ts: number }
  | { kind: 'stderr'; text: string; ts: number }
  | { kind: 'exit'; code: number; ts: number };

interface AgentActivityState {
  lastEvent?: AgentEvent;
  lastText?: string;
  eventCount: number;
  activeTool?: string;
}

interface Props {
  agents: TerminalPaneConfig[];
  selectedAgentId?: string | null;
  onSelectedAgentChange?: (id: string) => void;
  onAgentClose?: (id: string) => void;
  onAgentAdd?: () => void;
}

export function AgentWorkspace({
  agents,
  selectedAgentId,
  onSelectedAgentChange,
  onAgentClose,
  onAgentAdd,
}: Props) {
  const subscribedIds = useRef(new Set<string>());
  const [activityByAgent, setActivityByAgent] = useState<Record<string, AgentActivityState>>({});

  const selectedAgent = useMemo(() => {
    if (selectedAgentId) {
      const explicit = agents.find((agent) => agent.id === selectedAgentId);
      if (explicit) return explicit;
    }
    return agents.find((agent) => agent.status === 'running') ?? agents[0] ?? null;
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgent && agents[0]) onSelectedAgentChange?.(agents[0].id);
  }, [agents, selectedAgent, onSelectedAgentChange]);

  useEffect(() => {
    for (const agent of agents) {
      if (subscribedIds.current.has(agent.id)) continue;
      subscribedIds.current.add(agent.id);
      send('agent-subscribe', { id: agent.id });
    }
  }, [agents]);

  useEffect(() => {
    const unsub = subscribe('agent-event', (payload: { id: string; event: AgentEvent }) => {
      if (!payload?.id || !payload.event) return;
      setActivityByAgent((prev) => {
        const current = prev[payload.id] ?? { eventCount: 0 };
        return {
          ...prev,
          [payload.id]: {
            eventCount: current.eventCount + 1,
            lastEvent: payload.event,
            lastText: summarizeEvent(payload.event) || current.lastText,
            activeTool: activeToolName(payload.event, current.activeTool),
          },
        };
      });
    });
    return unsub;
  }, []);

  return (
    <div className="h-full w-full min-w-0 overflow-hidden flex">
      <aside className="w-[360px] shrink-0 border-r border-[var(--color-hair)] bg-[var(--color-ink)]/40 flex flex-col min-h-0">
        <div className="shrink-0 px-4 py-3 border-b border-[var(--color-hair)]">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--color-text-muted)]" />
            <span className="text-[13px] font-medium text-[var(--color-text)]">Agents</span>
            <span className="ml-auto text-[11px] font-mono text-[var(--color-text-faint)]">
              {agents.filter((agent) => agent.status === 'running').length}/{agents.length} live
            </span>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {agents.length === 0 ? (
            <div className="h-full flex items-center justify-center px-6 text-center text-[12px] text-[var(--color-text-faint)]">
              No agents are running
            </div>
          ) : (
            <div className="space-y-1">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  activity={activityByAgent[agent.id]}
                  selected={selectedAgent?.id === agent.id}
                  onSelect={() => onSelectedAgentChange?.(agent.id)}
                  onClose={() => onAgentClose?.(agent.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--color-hair)] p-2">
          <button
            onClick={onAgentAdd}
            className="w-full h-9 rounded-md border border-dashed border-[var(--color-hair-2)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent-soft)]/40 transition-colors flex items-center justify-center"
            title="Add agent"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {selectedAgent ? (
          <>
            <FocusedHeader agent={selectedAgent} activity={activityByAgent[selectedAgent.id]} />
            <div className="flex-1 min-h-0">
              <AgentTranscript
                agentId={selectedAgent.id}
                isActive={selectedAgent.status === 'running'}
              />
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-[12px] text-[var(--color-text-faint)]">
            Select an agent
          </div>
        )}
      </main>
    </div>
  );
}

function AgentRow({
  agent,
  activity,
  selected,
  onSelect,
  onClose,
}: {
  agent: TerminalPaneConfig;
  activity?: AgentActivityState;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const status = statusMeta(agent.status);
  const lastText = activity?.lastText ?? status.label;

  return (
    <button
      onClick={onSelect}
      className={`group w-full min-h-[74px] rounded-md px-3 py-2.5 text-left border transition-colors ${
        selected
          ? 'border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)]'
          : 'border-transparent hover:border-[var(--color-hair-2)] hover:bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.status === 'running' ? 'live-dot' : ''}`}
          style={{ background: status.color }}
        />
        <span className="text-[13px] text-[var(--color-text)] truncate">{agent.agentName}</span>
        <span className="ml-auto shrink-0 flex items-center gap-1 text-[10.5px] text-[var(--color-text-faint)]">
          {status.icon}
          {status.label}
        </span>
        <span
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="ml-0.5 shrink-0 p-1 rounded text-[var(--color-text-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-all"
          title="Close agent"
          role="button"
          tabIndex={-1}
        >
          <X className="w-3.5 h-3.5" />
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-text-faint)] min-w-0">
        <span className="font-mono shrink-0">{activity?.eventCount ?? 0} events</span>
        {activity?.activeTool && (
          <>
            <span className="shrink-0">·</span>
            <span className="font-mono truncate">{activity.activeTool}</span>
          </>
        )}
      </div>

      <div className="mt-1 text-[12px] leading-snug text-[var(--color-text-muted)] line-clamp-2">
        {lastText}
      </div>
    </button>
  );
}

function FocusedHeader({
  agent,
  activity,
}: {
  agent: TerminalPaneConfig;
  activity?: AgentActivityState;
}) {
  const status = statusMeta(agent.status);
  return (
    <div className="h-14 shrink-0 border-b border-[var(--color-hair)] px-5 flex items-center gap-3">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.status === 'running' ? 'live-dot' : ''}`}
        style={{ background: status.color }}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-medium text-[var(--color-text)] truncate">{agent.agentName}</span>
          <span className="text-[11px] text-[var(--color-text-faint)] shrink-0">{status.label}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-text-faint)] truncate">
          {activity?.activeTool ? `Running ${activity.activeTool}` : activity?.lastText ?? 'Waiting for stream'}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px] text-[var(--color-text-faint)]">
        <span className="font-mono">{activity?.eventCount ?? 0} events</span>
      </div>
    </div>
  );
}

function statusMeta(status: TerminalPaneConfig['status']) {
  if (status === 'running') {
    return {
      label: 'Live',
      color: 'var(--color-accent)',
      icon: <Radio className="w-3 h-3" />,
    };
  }
  if (status === 'exited') {
    return {
      label: 'Done',
      color: 'var(--color-success)',
      icon: <Check className="w-3 h-3" />,
    };
  }
  if (status === 'killed') {
    return {
      label: 'Stopped',
      color: 'var(--color-error)',
      icon: <Square className="w-3 h-3" />,
    };
  }
  return {
    label: 'Waiting',
    color: 'var(--color-text-faint)',
    icon: <Clock className="w-3 h-3" />,
  };
}

function summarizeEvent(event: AgentEvent): string {
  if (event.kind === 'text') return compact(event.text);
  if (event.kind === 'thinking') return `Thinking: ${compact(event.text)}`;
  if (event.kind === 'tool_use') return `Using ${event.name}`;
  if (event.kind === 'tool_result') return event.isError ? `Tool failed: ${compact(event.content)}` : `Tool finished: ${compact(event.content)}`;
  if (event.kind === 'result') return event.success ? 'Completed' : 'Failed';
  if (event.kind === 'stderr') return compact(event.text);
  if (event.kind === 'exit') return `Exited with code ${event.code}`;
  if (event.kind === 'init') return event.model ? `Started on ${event.model}` : 'Started';
  return '';
}

function activeToolName(event: AgentEvent, current?: string): string | undefined {
  if (event.kind === 'tool_use') return event.name;
  if (event.kind === 'tool_result' || event.kind === 'result' || event.kind === 'exit') return undefined;
  return current;
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}
