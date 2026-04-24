// frontend/src/App.tsx
import { useState, useCallback, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { TerminalGrid, TerminalPaneConfig } from './components/TerminalGrid';
import { MilestoneInbox } from './components/MilestoneInbox';
import { WorkflowGraph } from './components/WorkflowGraph';
import { SettingsModal } from './components/SettingsModal';
import type { Project } from './lib/db';
import { invoke, send } from './lib/ipc';
import { Inbox, Radio, AlertTriangle } from 'lucide-react';

const AUTOPILOT_PANES: TerminalPaneConfig[] = [
  { id: 'researcher', agentName: 'Research Agent', agentType: 'terminal', status: 'waiting' },
  { id: 'debate-a', agentName: 'Debate Agent A', agentType: 'terminal', status: 'waiting' },
  { id: 'debate-b', agentName: 'Debate Agent B', agentType: 'terminal', status: 'waiting' },
  { id: 'ticket-bot', agentName: 'Ticket Bot', agentType: 'direct-llm', status: 'waiting' },
  { id: 'architect', agentName: 'Architect', agentType: 'terminal', status: 'waiting' },
  { id: 'developer', agentName: 'Developer', agentType: 'terminal', status: 'waiting' },
  { id: 'reviewer', agentName: 'Code Reviewer', agentType: 'terminal', status: 'waiting' },
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
  const [clock, setClock] = useState<string>(() => timecode());

  useEffect(() => {
    const i = setInterval(() => setClock(timecode()), 1000);
    return () => clearInterval(i);
  }, []);

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
          ? `Could not start autopilot workflow: ${msg}. Is Temporal + the worker running? Try \`make dev\`.`
          : `Could not start autopilot workflow: ${msg}`,
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
      { id: `${workflow.name}-specialist`, agentName: `${workflow.name} · Specialist`, agentType: 'terminal', status: 'running' },
      { id: `${workflow.name}-validator`, agentName: `${workflow.name} · Validator`, agentType: 'terminal', status: 'running' },
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
      setAutopilotError(`Could not start workflow: ${msg}`);
    }
  }, [activeProject]);

  const handlePaneClose = useCallback((id: string) => {
    send('agent-kill', { id });
    setPanes((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handlePaneAdd = useCallback(() => {
    const newId = `agent-${Date.now()}`;
    const newPane: TerminalPaneConfig = {
      id: newId,
      agentName: 'Ad-hoc Agent',
      agentType: 'terminal',
      status: 'running',
    };
    setPanes((prev) => [...prev, newPane]);
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0b0d] text-[#e8e6e0]">
      <Sidebar
        activeProject={activeProject}
        onProjectSelect={handleProjectSelect}
        onWorkflowSelect={handleWorkflowSelect}
        onSettingsClick={() => setShowSettings(true)}
        onAutopilotClick={handleAutopilotSelect}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Control-room header bar */}
        <div className="h-11 shrink-0 border-b border-[#1e2024] bg-[#0a0b0d] flex items-stretch">
          <div className="px-4 flex items-center gap-3 border-r border-[#1e2024]">
            <Radio className="w-3.5 h-3.5 text-[#d4ff00]" />
            <span className="font-display uppercase tracking-[0.3em] text-[10px] text-[#4a4d52]">run</span>
            <span className="font-display text-[12px] text-[#e8e6e0] truncate max-w-[260px]">
              {workflowActive ? (activeRun || 'starting…') : 'no active run'}
            </span>
          </div>

          <div className="px-4 flex items-center gap-3 border-r border-[#1e2024]">
            <span className="font-display uppercase tracking-[0.3em] text-[10px] text-[#4a4d52]">project</span>
            <span className="font-display text-[12px] text-[#d4d2cc] truncate max-w-[220px]">
              {activeProject?.name ?? '—'}
            </span>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setShowInbox(true)}
            className="px-4 flex items-center gap-2 border-l border-[#1e2024] text-[#8a8d92] hover:text-[#d4ff00] hover:bg-[#0d0f12] transition-colors"
          >
            <Inbox className="w-3.5 h-3.5" />
            <span className="font-display uppercase tracking-[0.3em] text-[10px]">milestones</span>
          </button>

          <div className="px-4 flex items-center border-l border-[#1e2024]">
            <span className="font-display text-[12px] text-[#d4ff00] tabular-nums">{clock}</span>
          </div>
        </div>

        {autopilotError && (
          <div className="mx-4 mt-3 px-3 py-2 border border-[#ff6b5a]/40 bg-[#170e0e] flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[#ff6b5a] mt-[2px] shrink-0" />
            <span className="font-body text-[11px] text-[#ff9b8f] leading-snug">{autopilotError}</span>
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
            <div className="w-64 shrink-0 border-l border-[#1e2024] bg-[#0a0b0d]">
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
    <div className="h-full w-full flex items-center justify-center relative bg-[#0a0b0d]">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="relative z-10 text-center max-w-md px-6">
        <div className="font-display uppercase tracking-[0.4em] text-[10px] text-[#4a4d52] mb-3">
          standing by
        </div>
        <div className="font-display uppercase tracking-[0.18em] text-[20px] text-[#e8e6e0] leading-snug mb-2">
          Select a project
          <br />
          <span className="text-[#d4ff00]">·</span> launch a workflow
          <br />
          <span className="text-[#d4ff00]">·</span> engage autopilot
        </div>
        <div className="mt-4 font-body text-[12px] text-[#6b6b68] leading-relaxed">
          Each agent streams its thinking, tool calls, and results into the grid — one rack unit per node, colour-coded by channel.
        </div>
      </div>
    </div>
  );
}

function timecode(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export default App;
