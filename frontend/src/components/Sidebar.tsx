// frontend/src/components/Sidebar.tsx
import { useState, useEffect } from 'react';
import { FolderClosed, Play, Settings, SquareTerminal, Plus, Inbox } from 'lucide-react';
import type { Project } from '../lib/db';

interface Props {
  onProjectSelect?: (project: Project) => void;
  onWorkflowSelect?: (workflow: { name: string; language: 'typescript' | 'python' }) => void;
  activeProject?: Project | null;
}

export function Sidebar({ onProjectSelect, onWorkflowSelect, activeProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflows, setWorkflows] = useState<Array<{ name: string; language: 'typescript' | 'python' }>>([]);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const list = await fetch('http://localhost:3000/api/projects').then(r => r.json());
      setProjects(list as Project[]);
    } catch (e) {
      // Backend may not have DB ready yet
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
          <button onClick={() => {/* TODO: folder picker */}} className="p-1 rounded hover:bg-secondary">
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

      {/* Settings */}
      <div className="p-4 border-t border-border">
        <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>
    </div>
  );
}
