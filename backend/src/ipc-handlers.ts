// backend/src/ipc-handlers.ts
import { projects, runs, milestones, modelConfig } from './db.js';
import { ptyManager } from './pty-manager.js';
import { createWorktree, removeWorktree } from './worktree.js';
import { startSidecar, stopSidecar, getSidecarStatus } from './sidecar-lifecycle.js';
import { createMilestone, resolveMilestone, getPendingMilestones } from './milestone-service.js';
import keytar from 'node-keytar';

const SERVICE_NAME = 'Atelier';
const KEYCHAIN_PREFIX = 'atelier.provider.';

// In-memory handler registry for WebSocket routing
const handlerMap: Record<string, (opts: any) => Promise<any>> = {};

// @ts-ignore - global registration for index.ts to find
globalThis.__ipcHandlers = handlerMap;

function register(name: string, handler: (opts: any) => Promise<any>) {
  handlerMap[name] = handler;
}

function keychainKey(providerId: string, key: string) {
  return `${KEYCHAIN_PREFIX}${providerId}.${key}`;
}

// Existing handlers
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
register('milestone.listPending', async () => getPendingMilestones());
register('milestone.create', async (opts: { runId: string; name: string; payload: unknown }) => {
  try {
    return await createMilestone(opts.runId, opts.name, opts.payload);
  } catch (err) {
    throw new Error(`Failed to create milestone: ${err}`);
  }
});
register('milestone.resolve', async (opts: { id: string; verdict: string; reason?: string }) => {
  await resolveMilestone(opts.id, opts.verdict as 'Approved' | 'Rejected', opts.reason);
});

register('worktree.create', async (opts: { projectPath: string; projectSlug: string; runId: string }) =>
  createWorktree(opts.projectPath, opts.projectSlug, opts.runId));
register('worktree.remove', async (opts: { worktreePath: string }) =>
  removeWorktree(opts.worktreePath));

register('sidecar.status', async () => getSidecarStatus());
register('sidecar.start', async () => { await startSidecar(); });
register('sidecar.stop', async () => { await stopSidecar(); });

// Model config handlers
register('settings.modelConfig:get', async () => {
  const rows = modelConfig.list() as any[];
  const result: any[] = [];
  for (const row of rows) {
    const apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey(row.id, 'apiKey'));
    let models: string[] = [];
    try {
      models = JSON.parse(row.models_json || '[]');
    } catch {
      models = [];
    }
    result.push({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      configured: !!apiKey,
      models,
    });
  }
  return result;
});

register('settings.modelConfig:set', async (opts: { id: string; enabled: boolean; models: string[] }) => {
  modelConfig.setEnabled(opts.id, opts.enabled ? 1 : 0);
  modelConfig.setModels(opts.id, JSON.stringify(opts.models));
});

register('settings.apiKey:get', async (opts: { providerId: string }) => {
  return keytar.getPassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'));
});

register('settings.apiKey:set', async (opts: { providerId: string; apiKey: string }) => {
  if (!opts.apiKey || !opts.apiKey.trim()) {
    throw new Error('API key cannot be empty');
  }
  await keytar.setPassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'), opts.apiKey.trim());
});

register('settings.apiKey:delete', async (opts: { providerId: string }) => {
  await keytar.deletePassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'));
});