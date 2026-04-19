import { useState } from 'react';
import { TerminalPane } from './components/TerminalPane';
import { Play, Settings, FolderClosed, SquareTerminal } from 'lucide-react';

function App() {
  const [workflowActive, setWorkflowActive] = useState(false);
  const [prompt, setPrompt] = useState('Write a hello world program in Python');

  const handleRun = () => {
    setWorkflowActive(true);
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border font-bold text-lg flex items-center gap-2">
          <SquareTerminal className="w-5 h-5 text-primary" />
          Atelier
        </div>
        
        <div className="flex-1 p-2 space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 mt-4">Projects</div>
          <button className="w-full text-left px-2 py-1.5 rounded-md bg-secondary text-secondary-foreground flex items-center gap-2 text-sm font-medium">
            <FolderClosed className="w-4 h-4" />
            Atelier MVP
          </button>
          
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 mt-8">Workflows</div>
          <div className="px-2">
            <div className="bg-background border border-border rounded-md p-3 shadow-sm">
              <h3 className="font-medium text-sm mb-2">Feature Workflow</h3>
              <input 
                className="w-full text-sm bg-input text-foreground border border-border rounded px-2 py-1 mb-3"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Agent prompt..."
              />
              <button 
                onClick={handleRun}
                disabled={workflowActive}
                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground py-1.5 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
              >
                <Play className="w-4 h-4" />
                {workflowActive ? 'Running...' : 'Run Workflow'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border mt-auto">
          <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-background">
        <div className="h-12 border-b border-border flex items-center px-4 justify-between bg-card">
          <div className="font-medium text-sm flex items-center gap-2">
            <span className="text-muted-foreground">Run:</span>
            {workflowActive ? 'feature-run-001' : 'Waiting for trigger'}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Provider:</span>
            <span className="bg-secondary px-2 py-0.5 rounded text-xs font-medium">Anthropic</span>
          </div>
        </div>
        
        <div className="flex-1 p-4 bg-muted/20">
          <div className="h-full rounded-xl overflow-hidden border border-border shadow-sm flex flex-col">
            <div className="h-8 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 text-xs text-zinc-400 font-mono">
              agent: Code Writer (Claude Code)
            </div>
            <div className="flex-1 bg-black">
              <TerminalPane isActive={workflowActive} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
