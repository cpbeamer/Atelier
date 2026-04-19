// backend/src/ipc-handlers.ts
import { ptyManager } from './pty-manager.js';
import { projects, runs, milestones } from './db.js';
import { createWorktree, removeWorktree } from './worktree.js';

type RegisterFn = (name: string, handler: (opts: any) => Promise<void>) => void;
const register: RegisterFn = (name, handler) => {
  // Handler registration - handlers are called by the IPC router
  console.log(`Registered handler: ${name}`);
};

register('pty.spawn', async (opts: { id: string; command: string; args: string[]; cwd?: string }) => {
  ptyManager.spawn(opts.id, opts.command, opts.args, opts.cwd);
});

register('pty.write', async (opts: { id: string; data: string }) => {
  ptyManager.write(opts.id, opts.data);
});

register('pty.resize', async (opts: { id: string; cols: number; rows: number }) => {
  ptyManager.resize(opts.id, opts.cols, opts.rows);
});

register('pty.kill', async (opts: { id: string }) => {
  ptyManager.kill(opts.id);
});

register('db.listProjects', async () => projects.list());
register('db.addProject', async (opts: { id: string; name: string; path: string }) => {
  const now = Date.now();
  projects.insert(opts.id, opts.name, opts.path, now, now);
});
register('db.listRuns', async (opts: { projectId: string }) => runs.listByProject(opts.projectId));
register('milestone.listPending', async () => milestones.listPending());

register('worktree.create', async (opts: { projectPath: string; projectSlug: string; runId: string }) =>
  createWorktree(opts.projectPath, opts.projectSlug, opts.runId));

register('worktree.remove', async (opts: { worktreePath: string }) =>
  removeWorktree(opts.worktreePath));
