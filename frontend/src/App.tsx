// frontend/src/App.tsx
import { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { TerminalGrid, TerminalPaneConfig } from './components/TerminalGrid';
import { MilestoneInbox } from './components/MilestoneInbox';
import { WorkflowGraph } from './components/WorkflowGraph';
import { SettingsModal } from './components/SettingsModal';
import type { Project } from './lib/db';
import { invoke } from './lib/ipc';

function App() {
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [panes, setPanes] = useState<TerminalPaneConfig[]>([]);
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [workflowActive, setWorkflowActive] = useState(false);

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
              <TerminalGrid panes={panes} onPaneClose={handlePaneClose} onPaneAdd={handlePaneAdd} />
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
