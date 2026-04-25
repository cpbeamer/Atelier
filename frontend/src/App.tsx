// frontend/src/App.tsx
import { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { TerminalGrid, TerminalPaneConfig } from './components/TerminalGrid';
import { MilestoneInbox } from './components/MilestoneInbox';
import { WorkflowGraph } from './components/WorkflowGraph';
import { SettingsModal } from './components/SettingsModal';
import type { Project } from './lib/db';
import { invoke, send } from './lib/ipc';
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

const AUTOPILOT_CONNECTIONS = [
  { from: 'researcher', to: 'debate-a', type: 'signal' as const },
  { from: 'researcher', to: 'debate-b', type: 'noise' as const },
  { from: 'debate-a', to: 'architect', type: 'parent-child' as const },
  { from: 'debate-b', to: 'architect', type: 'parent-child' as const },
  { from: 'architect', to: 'developer', type: 'parent-child' as const },
  { from: 'developer', to: 'reviewer', type: 'parent-child' as const },
  { from: 'reviewer', to: 'tester', type: 'parent-child' as const },
  { from: 'tester', to: 'pusher', type: 'parent-child' as const },
];

function App() {
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [panes, setPanes] = useState<TerminalPaneConfig[]>([]);
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [autopilotError, setAutopilotError] = useState<string | null>(null);

  const startAutopilot = useCallback(async (project: Project) => {
    setAutopilotError(null);
    const live = AUTOPILOT_PANES.map((p) => ({ ...p, status: 'waiting' as const }));
    setPanes(live);
    setWorkflowActive(true);
    try {
      const { runId } = await invoke<{ runId: string }>('autopilot.start', {
        projectPath: project.path,
        projectSlug: project.name.toLowerCase().replace(/\s+/g, '-'),
        suggestedFeatures: [],
      });
      setActiveRun(runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAutopilotError(
        msg.includes('ECONNREFUSED') || msg.includes('No IPC handler')
          ? `Couldn't start autopilot: ${msg}. Is Temporal + the worker running? Try \`make dev\`.`
          : `Couldn't start autopilot: ${msg}`,
      );
    }
  }, []);

  const handleProjectSelect = useCallback((project: Project) => {
    setActiveProject(project);
    void startAutopilot(project);
  }, [startAutopilot]);

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
  }, []);

  const handlePaneAdd = useCallback(() => {
    const newId = `agent-${Date.now()}`;
    const newPane: TerminalPaneConfig = {
      id: newId,
      agentName: 'Ad-hoc agent',
      agentType: 'terminal',
      status: 'running',
    };
    setPanes((prev) => [...prev, newPane]);
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
              <TerminalGrid
                panes={panes}
                connections={AUTOPILOT_CONNECTIONS}
                onPaneClose={handlePaneClose}
                onPaneAdd={handlePaneAdd}
              />
            ) : (
              <EmptyState />
            )}
          </div>

          {workflowActive && (
            <div className="w-72 shrink-0 border-l border-[var(--color-hair)]">
              <WorkflowGraph runId={activeRun || undefined} />
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
          Pick a project to begin. Each agent streams its thinking, tools and
          results into its own pane — composed, not shouted.
        </p>
      </div>
    </div>
  );
}

export default App;
