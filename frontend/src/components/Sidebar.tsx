// frontend/src/components/Sidebar.tsx
import { useState, useEffect } from 'react';
import { FolderClosed, Play, Settings, Plus, Zap } from 'lucide-react';
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
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const list = await invoke<Project[]>('db.listProjects');
      setProjects(list as Project[]);
    } catch {
      /* backend not ready */
    }
  }

  async function handleAddProject() {
    setAddError(null);
    if (!window.electronAPI) {
      setAddError('Adding a project requires the Electron app — the browser cannot resolve absolute folder paths.');
      return;
    }
    let folderPath: string | null;
    try {
      folderPath = await window.electronAPI.openFolder();
    } catch (e) {
      setAddError(e instanceof Error ? `Could not open folder picker: ${e.message}` : 'Could not open folder picker.');
      return;
    }
    if (!folderPath) return;
    try {
      const projectName = folderPath.split('/').pop() || 'New Project';
      const id = `proj-${Date.now()}`;
      const now = Date.now();
      await invoke('db.addProject', { id, name: projectName, path: folderPath });
      setProjects(prev => [...prev, {
        id,
        name: projectName,
        path: folderPath!,
        created_at: now,
        last_opened_at: now,
        settings_json: '{}',
      }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAddError(msg.includes('UNIQUE') ? 'This project has already been added.' : `Failed to add project: ${msg}`);
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
    <div className="w-60 shrink-0 bg-[#0a0b0d] border-r border-[#1e2024] flex flex-col h-full relative">
      {/* Wordmark */}
      <div className="px-4 pt-5 pb-4 border-b border-[#1e2024] relative">
        <div className="flex items-baseline gap-2">
          <span className="font-display font-bold text-[18px] tracking-[0.25em] uppercase text-[#e8e6e0]">
            Atelier
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#d4ff00] live-dot shrink-0 translate-y-[-2px]" />
        </div>
        <div className="mt-1 font-display text-[9px] uppercase tracking-[0.4em] text-[#4a4d52]">
          agent · control · room
        </div>
      </div>

      {/* Projects */}
      <div className="flex-1 overflow-y-auto">
        <Section
          title="Projects"
          action={
            <button
              onClick={handleAddProject}
              className="p-1 hover:bg-[#101114] transition-colors text-[#6b6b68] hover:text-[#d4ff00]"
              title="Add project"
            >
              <Plus className="w-3 h-3" />
            </button>
          }
        >
          {addError && (
            <div className="mx-2 mb-2 px-2 py-1.5 border border-[#ff6b5a]/40 bg-[#170e0e] text-[10px] text-[#ff9b8f] leading-snug">
              {addError}
            </div>
          )}
          {projects.length === 0 && (
            <div className="px-3 py-2 text-[10px] font-display uppercase tracking-[0.25em] text-[#4a4d52]">
              no projects yet
            </div>
          )}
          {projects.map((project) => {
            const active = activeProject?.id === project.id;
            return (
              <button
                key={project.id}
                onClick={() => handleProjectClick(project)}
                className={`group w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] border-l-2 transition-all ${
                  active
                    ? 'border-[#d4ff00] bg-[#101114] text-[#e8e6e0]'
                    : 'border-transparent text-[#8a8d92] hover:border-[#1e2024] hover:bg-[#0d0f12] hover:text-[#d4d2cc]'
                }`}
              >
                <FolderClosed className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{project.name}</span>
              </button>
            );
          })}
        </Section>

        {activeProject && (
          <Section title="Workflows">
            {workflows.map((wf) => (
              <button
                key={wf.name}
                onClick={() => onWorkflowSelect?.(wf)}
                className="group w-full text-left px-3 py-1.5 flex items-center gap-2 text-[12px] text-[#8a8d92] hover:bg-[#0d0f12] hover:text-[#d4d2cc] transition-colors"
              >
                <Play className="w-3 h-3 shrink-0 text-[#4a4d52] group-hover:text-[#d4ff00] transition-colors" />
                <span className="truncate">{wf.name}</span>
                <span className="ml-auto font-display text-[9px] uppercase tracking-[0.25em] text-[#4a4d52]">
                  {wf.language === 'python' ? 'py' : 'ts'}
                </span>
              </button>
            ))}
          </Section>
        )}

        {activeProject && (
          <div className="px-2 pt-2 pb-3 border-t border-[#1e2024]">
            <button
              onClick={() => onAutopilotClick?.()}
              className="w-full relative flex items-center justify-center gap-2 px-3 py-2 border border-[#d4ff00]/40 bg-gradient-to-b from-[#1a1d00]/60 to-[#0a0b0d] hover:border-[#d4ff00] transition-all group"
            >
              <Zap className="w-3.5 h-3.5 text-[#d4ff00]" />
              <span className="font-display uppercase tracking-[0.3em] text-[11px] text-[#d4ff00]">
                autopilot
              </span>
              <span className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4ff00]/60 to-transparent" />
            </button>
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="px-3 py-3 border-t border-[#1e2024] flex items-center justify-between">
        <button
          onClick={() => onSettingsClick?.()}
          className="flex items-center gap-2 font-display uppercase tracking-[0.25em] text-[10px] text-[#6b6b68] hover:text-[#d4d2cc] transition-colors"
        >
          <Settings className="w-3 h-3" />
          settings
        </button>
        <span className="font-display text-[9px] uppercase tracking-[0.3em] text-[#4a4d52]">v0.1</span>
      </div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pt-3 pb-2">
      <div className="flex items-center justify-between px-3 mb-1.5">
        <span className="font-display uppercase tracking-[0.35em] text-[9px] text-[#4a4d52]">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
