// frontend/src/App.tsx
import { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { TerminalGrid, TerminalPaneConfig } from './components/TerminalGrid';
import { MilestoneInbox } from './components/MilestoneInbox';
import { WorkflowGraph } from './components/WorkflowGraph';
import { SettingsModal } from './components/SettingsModal';
import type { Project } from './lib/db';
import { invoke } from './lib/ipc';

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

  const handleAutopilotSelect = useCallback(async () => {
    if (!activeProject) return;

    const { runId } = await invoke<{ runId: string }>('autopilot.start', {
      projectPath: activeProject.path,
      projectSlug: activeProject.name.toLowerCase().replace(/\s+/g, '-'),
      suggestedFeatures: [],
    });

    setWorkflowActive(true);
    setActiveRun(runId);
    setPanes(AUTOPILOT_PANES);
  }, [activeProject]);

  const handleWorkflowSelect = useCallback(async (workflow: { name: string; language: string }) => {
    const { runId } = await invoke<{ runId: string }>('workflow.start', {
      name: workflow.name,
      input: { language: workflow.language },
    });
    setWorkflowActive(true);
    setActiveRun(runId);
    setPanes([
      { id: 'agent-1', agentName: 'PM Specialist', agentType: 'terminal', status: 'running' },
      { id: 'agent-2', agentName: 'PM Validator', agentType: 'terminal', status: 'running' },
    ]);
  }, []);

  const handlePaneClose = useCallback((id: string) => {
    setPanes((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handlePaneAdd = useCallback(() => {
    const newId = `agent-${Date.now()}`;
    setPanes((prev) => [...prev, {
      id: newId,
      agentName: 'New Agent',
      agentType: 'terminal',
      status: 'waiting',
    }]);
  }, []);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar
        activeProject={activeProject}
        onProjectSelect={setActiveProject}
        onWorkflowSelect={handleWorkflowSelect}
        onSettingsClick={() => setShowSettings(true)}
        onAutopilotClick={handleAutopilotSelect}
      />

      <div className="flex-1 flex flex-col bg-background">
        <div className="h-12 border-b border-border flex items-center px-4 justify-between bg-card">
          <div className="font-medium text-sm flex items-center gap-2">
            <span className="text-muted-foreground">Run:</span>
            {workflowActive ? (activeRun || 'Running...') : 'Waiting for trigger'}
          </div>
          <button
            onClick={() => setShowInbox(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Milestones
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1">
            {workflowActive ? (
              <TerminalGrid panes={panes} connections={AUTOPILOT_CONNECTIONS} onPaneClose={handlePaneClose} onPaneAdd={handlePaneAdd} />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Select a workflow to run
              </div>
            )}
          </div>

          {workflowActive && (
            <div className="w-64 border-l border-border">
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

export default App;
