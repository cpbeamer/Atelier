// backend/src/ipc-handlers.ts
import { projects, runs, milestones, modelConfig } from './db.js';
import { ptyManager } from './pty-manager.js';
import { createWorktree, removeWorktree } from './worktree.js';
import { startSidecar, stopSidecar, getSidecarStatus } from './sidecar-lifecycle.js';
import { createMilestone, resolveMilestone, getPendingMilestones } from './milestone-service.js';
import keytar from 'keytar';
import { Client, Connection } from '@temporalio/client';
import path from 'node:path';

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
register('pty.spawnAgent', async (opts: { id: string; agentName: string; persona: string; task: string; cwd?: string }) => {
  const { id, agentName, persona, task, cwd } = opts;

  // Build the Claude Code command
  const personaPath = path.join(process.cwd(), 'src', '.atelier', 'agents', `${persona}.md`);
  const personaContent = await Bun.file(personaPath).text();
  const fullPrompt = `${personaContent}\n\n---\n\n${task}`;

  // Spawn Claude Code in the PTY
  const shell = process.platform === 'win32' ? 'wsl.exe' : '/bin/bash';
  const shellArgs = process.platform === 'win32'
    ? ['-d', 'Ubuntu', '--', 'bash', '-c', `claude --dangerously-skip-permissions -p "${fullPrompt.replace(/"/g, '\\"')}"`]
    : ['-c', `claude --dangerously-skip-permissions -p "${fullPrompt.replace(/"/g, '\\"')}"`];

  ptyManager.spawn(id, shell, shellArgs, cwd);

  return { spawned: true, ptyId: id };
});

register('db.listProjects', async () => projects.list());
register('db.addProject', async (opts: { id: string; name: string; path: string }) => {
  const now = Date.now();
  projects.insert(opts.id, opts.name, opts.path, now, now);
});
register('db.listRuns', async (opts: { projectId: string }) => runs.listByProject(opts.projectId));
register('milestone.listPending', async () => {
  try {
    return await getPendingMilestones();
  } catch (err) {
    throw new Error(`Failed to list pending milestones: ${err}`);
  }
});
register('milestone.create', async (opts: { runId: string; name: string; payload: unknown }) => {
  try {
    return await createMilestone(opts.runId, opts.name, opts.payload);
  } catch (err) {
    throw new Error(`Failed to create milestone: ${err}`);
  }
});
register('milestone.resolve', async (opts: { id: string; verdict: string; reason?: string }) => {
  try {
    await resolveMilestone(opts.id, opts.verdict as 'Approved' | 'Rejected', opts.reason);
  } catch (err) {
    throw new Error(`Failed to resolve milestone: ${err}`);
  }
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
    let apiKey: string | null = null;
    try {
      apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey(row.id, 'apiKey'));
    } catch (e) {
      // keytar may fail if no keyring is available (e.g., headless environment)
      console.warn('Failed to get API key from keyring:', e);
    }
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

register('autopilot.start', async (opts: { projectPath: string; projectSlug: string; suggestedFeatures?: string[] }) => {
  const connection = await Connection.connect({ address: '127.0.0.1:7466' });
  const client = new Client({ connection });

  const runId = `autopilot-${Date.now()}`;
  const handle = await client.workflow.start('autopilot', {
    args: [{
      projectPath: opts.projectPath,
      projectSlug: opts.projectSlug,
      runId,
      suggestedFeatures: opts.suggestedFeatures || [],
    }],
    taskQueue: 'atelier-default-ts',
    workflowId: `autopilot-${opts.projectSlug}-${runId}`,
  });

  return { runId, workflowId: handle.workflowId };
});

register('greenfield.start', async (opts: { projectPath: string; projectSlug: string; userRequest: string }) => {
  const connection = await Connection.connect({ address: '127.0.0.1:7466' });
  const client = new Client({ connection });
  const runId = `greenfield-${Date.now()}`;
  const handle = await client.workflow.start('greenfield', {
    args: [{
      projectPath: opts.projectPath,
      projectSlug: opts.projectSlug,
      runId,
      userRequest: opts.userRequest,
    }],
    taskQueue: 'atelier-default-ts',
    workflowId: `greenfield-${opts.projectSlug}-${runId}`,
  });
  return { runId, workflowId: handle.workflowId };
});