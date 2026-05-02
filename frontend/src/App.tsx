// frontend/src/App.tsx
import { useState, useCallback, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import type { TerminalPaneConfig } from './components/TerminalGrid';
import { AgentWorkspace } from './components/AgentWorkspace';
import { MilestoneInbox } from './components/MilestoneInbox';
import { ArtifactLedger } from './components/ArtifactLedger';
import { SettingsModal } from './components/SettingsModal';
import type { Project } from './lib/db';
import { invoke, send, subscribe } from './lib/ipc';
import { Inbox, AlertTriangle } from 'lucide-react';

const AUTOPILOT_PANES: TerminalPaneConfig[] = [
  { id: 'researcher', agentName: 'Research', agentType: 'terminal', status: 'waiting' },
  { id: 'debate-a', agentName: 'Debate A', agentType: 'terminal', status: 'waiting' },
  { id: 'debate-b', agentName: 'Debate B', agentType: 'terminal', status: 'waiting' },
  { id: 'ticket-bot', agentName: 'Ticket', agentType: 'direct-llm', status: 'waiting' },
  { id: 'architect', agentName: 'Architect', agentType: 'terminal', status: 'waiting' },
  { id: 'developer', agentName: 'Developer', agentType: 'terminal', status: 'waiting' },
  { id: 'reviewer', agentName: 'Reviewer', agentType: 'terminal', status: 'waiting' },
  { id: 'tester', agentName: 'Tester', agentType: 'terminal', status: 'waiting' },
  { id: 'pusher', agentName: 'Pusher', agentType: 'direct-llm', status: 'waiting' },
];

interface PreflightResult {
  ok: boolean;
  checks: Array<{ id: string; label: string; ok: boolean; detail?: string; required: boolean }>;
}

function App() {
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [panes, setPanes] = useState<TerminalPaneConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [autopilotError, setAutopilotError] = useState<string | null>(null);

  useEffect(() => {
    const unsubStarted = subscribe('agent:started', (payload: { agentId: string; agentName: string; terminalType: 'terminal' | 'direct-llm'; runId?: string }) => {
      if (!payload?.agentId) return;
      if (activeRun && payload.runId && payload.runId !== activeRun) return;
      setPanes((prev) => {
        const idx = prev.findIndex((p) => p.id === payload.agentId);
        if (idx >= 0) {
          return prev.map((p) => p.id === payload.agentId
            ? {
                ...p,
                agentName: payload.agentName || p.agentName,
                agentType: payload.terminalType || p.agentType,
                status: 'running',
              }
            : p);
        }
        return [...prev, {
          id: payload.agentId,
          agentName: payload.agentName || payload.agentId,
          agentType: payload.terminalType || 'direct-llm',
          status: 'running',
        }];
      });
      setSelectedAgentId((current) => current ?? payload.agentId);
    });
    const unsubCompleted = subscribe('agent:completed', (payload: { agentId: string; status?: 'completed' | 'error'; runId?: string }) => {
      if (!payload?.agentId) return;
      if (activeRun && payload.runId && payload.runId !== activeRun) return;
      setPanes((prev) => prev.map((p) => p.id === payload.agentId
        ? { ...p, status: payload.status === 'error' ? 'killed' : 'exited' }
        : p));
    });
    return () => {
      unsubStarted();
      unsubCompleted();
    };
  }, [activeRun]);

  const startAutopilot = useCallback(async (project: Project) => {
    setAutopilotError(null);
    setActiveRun(null);
    const live = AUTOPILOT_PANES.map((p) => ({ ...p, status: 'waiting' as const }));
    setPanes(live);
    setSelectedAgentId(live[0]?.id ?? null);
    setWorkflowActive(true);
    try {
      const preflight = await invoke<PreflightResult>('app.preflight');
      if (!preflight.ok) {
        const failed = preflight.checks
          .filter((c) => c.required && !c.ok)
          .map((c) => `${c.label}: ${c.detail || 'not available'}`)
          .join('; ');
        throw new Error(`Preflight failed: ${failed}`);
      }
      const { runId } = await invoke<{ runId: string }>('autopilot.start', {
        projectPath: project.path,
        projectSlug: project.name.toLowerCase().replace(/\s+/g, '-'),
        suggestedFeatures: [],
      });
      setActiveRun(runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setWorkflowActive(false);
      setAutopilotError(
        msg.includes('ECONNREFUSED') || msg.includes('No IPC handler')
          ? `Couldn't start autopilot: ${msg}. Is Temporal + the worker running? Try \`make dev\`.`
          : `Couldn't start autopilot: ${msg}`,
      );
    }
  }, []);

  const handleProjectSelect = useCallback((project: Project) => {
    setActiveProject(project);
    invoke('db.openProject', { id: project.id }).catch(() => {});
  }, []);

  const handleAutopilotSelect = useCallback(() => {
    if (activeProject) void startAutopilot(activeProject);
  }, [activeProject, startAutopilot]);

  const handleWorkflowSelect = useCallback(async (workflow: { name: string; language: string }) => {
    setAutopilotError(null);
    const live: TerminalPaneConfig[] = [
      { id: `${workflow.name}-specialist`, agentName: `${workflow.name} · specialist`, agentType: 'terminal', status: 'running' },
      { id: `${workflow.name}-validator`, agentName: `${workflow.name} · validator`, agentType: 'terminal', status: 'running' },
    ];
    setPanes(live);
    setSelectedAgentId(live[0]?.id ?? null);
    setWorkflowActive(true);
    try {
      const { runId } = await invoke<{ runId: string }>('workflow.start', {
        name: workflow.name,
        input: { language: workflow.language },
      });
      setActiveRun(runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAutopilotError(`Couldn't start workflow: ${msg}`);
    }
  }, []);

  const handlePaneClose = useCallback((id: string) => {
    send('agent-kill', { id });
    setPanes((prev) => prev.filter((p) => p.id !== id));
    setSelectedAgentId((current) => current === id ? panes.find((p) => p.id !== id)?.id ?? null : current);
  }, [panes]);

  const handlePaneAdd = useCallback(() => {
    const newId = `agent-${Date.now()}`;
    const newPane: TerminalPaneConfig = {
      id: newId,
      agentName: 'Ad-hoc agent',
      agentType: 'terminal',
      status: 'running',
    };
    setPanes((prev) => [...prev, newPane]);
    setSelectedAgentId(newId);
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-ink)] text-[var(--color-text)]">
      <Sidebar
        activeProject={activeProject}
        onProjectSelect={handleProjectSelect}
        onWorkflowSelect={handleWorkflowSelect}
        onSettingsClick={() => setShowSettings(true)}
        onAutopilotClick={handleAutopilotSelect}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — quiet identity, no telemetry decoration */}
        <header className="h-14 shrink-0 border-b border-[var(--color-hair)] flex items-center px-6 gap-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[14px] font-medium text-[var(--color-text)] truncate">
              {activeProject?.name ?? <span className="text-[var(--color-text-muted)] font-normal">No project selected</span>}
            </span>
            {workflowActive && (
              <>
                <span className="text-[var(--color-text-faint)]">/</span>
                <span className="font-mono text-[12px] text-[var(--color-text-muted)] truncate">
                  {activeRun || 'starting…'}
                </span>
              </>
            )}
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setShowInbox(true)}
            className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <Inbox className="w-4 h-4" />
            <span>Milestones</span>
          </button>
        </header>

        {autopilotError && (
          <div className="mx-6 mt-4 px-3.5 py-2.5 rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/8 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[var(--color-error)] mt-[1px] shrink-0" />
            <span className="text-[12.5px] text-[var(--color-error)]/90 leading-snug">{autopilotError}</span>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 min-w-0">
            {workflowActive ? (
              <AgentWorkspace
                agents={panes}
                selectedAgentId={selectedAgentId}
                onSelectedAgentChange={setSelectedAgentId}
                onAgentClose={handlePaneClose}
                onAgentAdd={handlePaneAdd}
              />
            ) : (
              <EmptyState />
            )}
          </div>

          {workflowActive && (
            <div className="w-96 shrink-0 border-l border-[var(--color-hair)] flex flex-col">
              <div className="flex-1 min-h-0">
                <ArtifactLedger runId={activeRun || undefined} />
              </div>
            </div>
          )}
        </div>
      </div>

      <MilestoneInbox isOpen={showInbox} onClose={() => setShowInbox(false)} />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full w-full flex items-center justify-center px-8">
      <div className="max-w-md text-center">
        <h1 className="font-serif italic text-[42px] leading-[1.05] text-[var(--color-text)] tracking-tight">
          A quiet studio
          <br />
          <span className="text-[var(--color-text-muted)]">for noisy agents.</span>
        </h1>
        <p className="mt-5 text-[13.5px] leading-[1.65] text-[var(--color-text-muted)]">
          Pick a project to begin. Agents stay visible in one roster while the
          focused transcript streams thinking, tools and results.
        </p>
      </div>
    </div>
  );
}

export default App;
