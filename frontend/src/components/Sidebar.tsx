// frontend/src/components/Sidebar.tsx
import { useState, useEffect } from 'react';
import { FolderClosed, Play, Settings, Plus, Sparkles } from 'lucide-react';
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
      setAddError('Adding a project requires the desktop app — the browser cannot resolve absolute folder paths.');
      return;
    }
    let folderPath: string | null;
    try {
      folderPath = await window.electronAPI.openFolder();
    } catch (e) {
      setAddError(e instanceof Error ? `Couldn't open folder picker: ${e.message}` : 'Couldn\'t open folder picker.');
      return;
    }
    if (!folderPath) return;
    try {
      const projectName = folderPath.split('/').pop() || 'New project';
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
      setAddError(msg.includes('UNIQUE') ? 'This project is already in your library.' : `Couldn't add project: ${msg}`);
    }
  }

  async function handleProjectClick(project: Project) {
    try {
      const list = await invoke<Array<{ name: string; language: 'typescript' | 'python' }>>('workflow.list', { projectId: project.id });
      setWorkflows(list);
    } catch {
      setWorkflows([]);
    }
    onProjectSelect?.(project);
  }

  return (
    <aside className="w-60 shrink-0 border-r border-[var(--color-hair)] flex flex-col h-full">
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-baseline gap-2">
          <span className="font-serif italic text-[24px] leading-none text-[var(--color-text)]">
            Atelier
          </span>
        </div>
        <div className="mt-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug">
          Studio for agents
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <Section
          title="Projects"
          action={
            <button
              onClick={handleAddProject}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
              title="Add project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          }
        >
          {addError && (
            <div className="mx-2 mb-2 px-2.5 py-2 rounded border border-[var(--color-error)]/30 bg-[var(--color-error)]/8 text-[11.5px] text-[var(--color-error)]/90 leading-snug">
              {addError}
            </div>
          )}
          {projects.length === 0 && (
            <div className="px-3 py-1.5 text-[12px] text-[var(--color-text-faint)]">
              No projects yet
            </div>
          )}
          {projects.map((project) => {
            const active = activeProject?.id === project.id;
            return (
              <button
                key={project.id}
                onClick={() => handleProjectClick(project)}
                className={`group w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2.5 text-[13px] transition-colors ${
                  active
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)]/60 hover:text-[var(--color-text)]'
                }`}
              >
                <FolderClosed className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`} />
                <span className="truncate">{project.name}</span>
              </button>
            );
          })}
        </Section>

        {activeProject && (
          <Section title="Workflows">
            {workflows.length === 0 && (
              <div className="px-3 py-1.5 text-[12px] text-[var(--color-text-faint)]">
                No custom workflows
              </div>
            )}
            {workflows.map((wf) => (
              <button
                key={wf.name}
                onClick={() => onWorkflowSelect?.(wf)}
                className="group w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2.5 text-[13px] text-[var(--color-text-dim)] hover:bg-[var(--color-surface)]/60 hover:text-[var(--color-text)] transition-colors"
              >
                <Play className="w-3 h-3 shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors" />
                <span className="truncate">{wf.name}</span>
                <span className="ml-auto font-mono text-[10.5px] text-[var(--color-text-faint)]">
                  {wf.language === 'python' ? 'py' : 'ts'}
                </span>
              </button>
            ))}
          </Section>
        )}

        {activeProject && (
          <div className="mt-3 px-1">
            <button
              onClick={() => onAutopilotClick?.()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-[13px] font-medium text-[var(--color-accent)] bg-[var(--color-accent-soft)] hover:bg-[rgba(255,107,53,0.18)] transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Run autopilot</span>
            </button>
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-t border-[var(--color-hair)]">
        <button
          onClick={() => onSettingsClick?.()}
          className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </button>
      </div>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pt-3 pb-1">
      <div className="flex items-center justify-between px-3 mb-1">
        <span className="text-[11px] font-medium text-[var(--color-text-faint)]">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
