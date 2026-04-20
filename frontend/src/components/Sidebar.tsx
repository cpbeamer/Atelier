// frontend/src/components/Sidebar.tsx
import { useState, useEffect } from 'react';
import { FolderClosed, Play, Settings, SquareTerminal, Plus, Zap } from 'lucide-react';
import { invoke } from '../lib/ipc';
import type { Project } from '../lib/db';

interface Props {
  onProjectSelect?: (project: Project) => void;
  onWorkflowSelect?: (workflow: { name: string; language: 'typescript' | 'python' }) => void;
  onSettingsClick?: () => void;
  onAutopilotClick?: () => void;
  activeProject?: Project | null;
}

export function Sidebar({ onProjectSelect, onWorkflowSelect, onSettingsClick, onAutopilotClick, activeProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflows, setWorkflows] = useState<Array<{ name: string; language: 'typescript' | 'python' }>>([]);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const list = await invoke<Project[]>('db.listProjects');
      setProjects(list as Project[]);
    } catch (e) {
      // Backend may not have DB ready yet
    }
  }

  async function handleAddProject() {
    if (window.electronAPI) {
      const folderPath = await window.electronAPI.openFolder();
      if (folderPath) {
        try {
          const projectName = folderPath.split('/').pop() || 'New Project';
          const id = `proj-${Date.now()}`;
          const now = Date.now();
          await invoke('db.addProject', { id, name: projectName, path: folderPath });
          setProjects(prev => [...prev, {
            id,
            name: projectName,
            path: folderPath,
            created_at: now,
            last_opened_at: now,
            settings_json: '{}',
          }]);
        } catch (e) {
          console.error('Failed to add project:', e);
        }
      }
    }
  }

  async function handleProjectClick(project: Project) {
    setWorkflows([
      { name: 'feature', language: 'typescript' },
      { name: 'pm-validation', language: 'typescript' },
      { name: 'research', language: 'python' },
    ]);
    onProjectSelect?.(project);
  }

  function handleSettingsClick() {
    onSettingsClick?.();
  }

  return (
    <div className="w-64 border-r border-border bg-card flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-border font-bold text-lg flex items-center gap-2">
        <SquareTerminal className="w-5 h-5 text-primary" />
        Atelier
      </div>

      {/* Projects */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">Projects</div>
          <button onClick={handleAddProject} className="p-1 rounded hover:bg-secondary">
            <Plus className="w-3 h-3" />
          </button>
        </div>

        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => handleProjectClick(project)}
            className={`w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 text-sm ${
              activeProject?.id === project.id ? 'bg-secondary' : 'hover:bg-secondary/50'
            }`}
          >
            <FolderClosed className="w-4 h-4" />
            {project.name}
          </button>
        ))}
      </div>

      {/* Workflows (when project selected) */}
      {activeProject && (
        <div className="p-2 border-t border-border">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Workflows</div>
          {workflows.map((wf) => (
            <button
              key={wf.name}
              onClick={() => onWorkflowSelect?.(wf)}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-secondary/50 flex items-center gap-2 text-sm"
            >
              <Play className="w-3 h-3" />
              {wf.name}
              <span className="ml-auto text-xs text-muted-foreground">
                {wf.language === 'python' ? '.py' : '.ts'}
              </span>
            </button>
          ))}
        </div>
      )}

      {activeProject && (
        <div className="p-2 border-t border-border">
          <button
            onClick={() => onAutopilotClick?.()}
            className="w-full text-left px-2 py-1.5 rounded-md bg-primary/10 hover:bg-primary/20 flex items-center gap-2 text-sm text-primary font-medium"
          >
            <Zap className="w-4 h-4" />
            Autopilot
          </button>
        </div>
      )}

      {/* Settings */}
      <div className="p-4 border-t border-border">
        <button
          onClick={handleSettingsClick}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>
    </div>
  );
}
