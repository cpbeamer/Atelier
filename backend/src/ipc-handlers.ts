// backend/src/ipc-handlers.ts
import { projects, runs, milestones, modelConfig } from './db.js';
import { appSettings } from './app-settings.js';
import { AGENT_RUNTIMES, DEFAULT_AGENT_RUNTIME, isAgentRuntimeId, runtimeFromLegacyUseOpencode, type AgentRuntimeId } from './agent-runtime.js';
import { ptyManager } from './pty-manager.js';
import { agentStreamManager } from './agent-stream.js';
import { createWorktree, removeWorktree } from './worktree.js';
import { startSidecar, stopSidecar, getSidecarStatus } from './sidecar-lifecycle.js';
import { createMilestone, resolveMilestone, getPendingMilestones } from './milestone-service.js';
import keytar from 'keytar';
import { Client, Connection } from '@temporalio/client';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const SERVICE_NAME = 'Atelier';
const KEYCHAIN_PREFIX = 'atelier.provider.';
const execFileAsync = promisify(execFile);

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

function getAgentRuntimeSetting(): AgentRuntimeId {
  const current = appSettings.get('agentRuntime');
  if (isAgentRuntimeId(current)) return current;
  const migrated = runtimeFromLegacyUseOpencode(appSettings.get('useOpencode'));
  if (migrated) {
    appSettings.set('agentRuntime', migrated);
    return migrated;
  }
  return DEFAULT_AGENT_RUNTIME;
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
  fs.mkdirSync(path.join(opts.path, '.atelier', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(opts.path, '.atelier', 'workflows'), { recursive: true });
  projects.insert(opts.id, opts.name, opts.path, now, now);
});
register('db.openProject', async (opts: { id: string }) => {
  projects.updateLastOpened(opts.id, Date.now());
  return projects.findById(opts.id);
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
async function keytarWithTimeout<T>(op: Promise<T>, ms = 2000): Promise<T> {
  return await Promise.race([
    op,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('keyring timeout')), ms)
    ),
  ]);
}

register('settings.modelConfig:get', async () => {
  let rows: any[] = [];
  try {
    rows = modelConfig.list() as any[];
  } catch (e) {
    console.error('settings.modelConfig:get: DB list failed:', e);
    return [];
  }
  const result: any[] = [];
  for (const row of rows) {
    let apiKey: string | null = null;
    try {
      apiKey = await keytarWithTimeout(
        keytar.getPassword(SERVICE_NAME, keychainKey(row.id, 'apiKey'))
      );
    } catch (e) {
      // keytar may fail or hang if no keyring is available (headless, no gnome-keyring, etc.)
      console.warn(`Failed to get API key for ${row.id} from keyring:`, e);
    }
    let models: string[] = [];
    try {
      models = JSON.parse(row.models_json || '[]');
    } catch {
      models = [];
    }
    // Repair stale selected_model: if it's not in the current models list,
    // fall back to the first model. Prevents a phantom dropdown value.
    const stored = row.selected_model as string | null;
    const selectedModel = stored && models.includes(stored) ? stored : (models[0] ?? null);
    result.push({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      kind: row.kind ?? 'openai-compatible',
      enabled: row.enabled === 1,
      configured: !!apiKey,
      isCustom: row.is_custom === 1,
      isPrimary: row.is_primary === 1,
      models,
      selectedModel,
    });
  }
  return result;
});

register('settings.modelConfig:set', async (opts: { id: string; enabled: boolean }) => {
  modelConfig.setEnabled(opts.id, opts.enabled ? 1 : 0);
});

register('settings.modelConfig:selectModel', async (opts: { id: string; model: string }) => {
  modelConfig.setSelectedModel(opts.id, opts.model);
});

register('settings.modelConfig:setPrimary', async (opts: { id: string }) => {
  const row = modelConfig.findById(opts.id);
  if (!row) throw new Error(`Provider not found: ${opts.id}`);
  modelConfig.setPrimary(opts.id);
});

register('settings.modelConfig:setModels', async (opts: { id: string; models: string[] }) => {
  if (!Array.isArray(opts.models)) throw new Error('models must be an array');
  modelConfig.setModels(opts.id, JSON.stringify(opts.models));
});

register('settings.modelConfig:add', async (opts: {
  id: string;
  name: string;
  baseUrl: string;
  kind: 'openai-compatible' | 'anthropic' | 'minimax';
  models: string[];
}) => {
  const id = opts.id?.trim();
  const name = opts.name?.trim();
  const baseUrl = opts.baseUrl?.trim();
  if (!/^[a-z0-9][a-z0-9-_]{1,40}$/i.test(id || '')) {
    throw new Error('id must be alphanumeric (with -_), 2-41 chars');
  }
  if (!name) throw new Error('name is required');
  if (!/^https?:\/\//.test(baseUrl || '')) throw new Error('baseUrl must start with http:// or https://');
  if (!['openai-compatible', 'anthropic', 'minimax'].includes(opts.kind)) {
    throw new Error('invalid kind');
  }
  if (modelConfig.findById(id)) throw new Error(`provider id "${id}" already exists`);
  const models = Array.isArray(opts.models) ? opts.models.filter(m => typeof m === 'string' && m.trim()) : [];
  modelConfig.addCustom(id, name, baseUrl, opts.kind, JSON.stringify(models));
});

register('settings.modelConfig:remove', async (opts: { id: string }) => {
  const row = modelConfig.findById(opts.id);
  if (!row) return;
  if (row.is_custom !== 1) throw new Error('Cannot remove a curated provider');
  modelConfig.removeCustom(opts.id);
  // Best-effort: delete its keychain entry too.
  try {
    await keytarWithTimeout(
      keytar.deletePassword(SERVICE_NAME, keychainKey(opts.id, 'apiKey'))
    );
  } catch { /* keyring unavailable — non-fatal */ }
});

register('settings.useOpencode:get', async () => {
  return { useOpencode: getAgentRuntimeSetting() === 'opencode' };
});

register('settings.useOpencode:set', async (opts: { useOpencode: boolean }) => {
  if (typeof opts?.useOpencode !== 'boolean') {
    throw new Error('useOpencode must be a boolean');
  }
  appSettings.set('useOpencode', opts.useOpencode ? 'true' : 'false');
  appSettings.set('agentRuntime', opts.useOpencode ? 'opencode' : 'direct-llm');
  return { ok: true };
});

register('settings.agentRuntime:get', async () => {
  return { agentRuntime: getAgentRuntimeSetting(), runtimes: AGENT_RUNTIMES };
});

register('settings.agentRuntime:set', async (opts: { agentRuntime: AgentRuntimeId }) => {
  if (!isAgentRuntimeId(opts?.agentRuntime)) {
    throw new Error('agentRuntime must be opencode, claude-code, or direct-llm');
  }
  appSettings.set('agentRuntime', opts.agentRuntime);
  return { ok: true, agentRuntime: opts.agentRuntime };
});

register('settings.apiKey:get', async (opts: { providerId: string }) => {
  try {
    return await keytarWithTimeout(
      keytar.getPassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'))
    );
  } catch (e) {
    console.warn('settings.apiKey:get failed:', e);
    return null;
  }
});

register('settings.apiKey:set', async (opts: { providerId: string; apiKey: string }) => {
  if (!opts.apiKey || !opts.apiKey.trim()) {
    throw new Error('API key cannot be empty');
  }
  try {
    await keytarWithTimeout(
      keytar.setPassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'), opts.apiKey.trim())
    );
  } catch (e) {
    throw new Error(
      'Could not save API key: no OS keyring is available. On Linux, install and run gnome-keyring or kwallet.'
    );
  }
});

register('settings.apiKey:delete', async (opts: { providerId: string }) => {
  try {
    await keytarWithTimeout(
      keytar.deletePassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'))
    );
  } catch (e) {
    console.warn('settings.apiKey:delete failed:', e);
  }
});

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7466';
let temporalClient: Client | null = null;
async function getTemporalClient(): Promise<Client> {
  if (temporalClient) return temporalClient;
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  temporalClient = new Client({ connection });
  return temporalClient;
}

function projectIdForPath(projectPath: string): string {
  return projects.findByPath(projectPath)?.id ?? `path:${projectPath}`;
}

function expectedWorktreePath(projectSlug: string, runId: string): string {
  return path.join(process.env.HOME || '', '.atelier', 'worktrees', projectSlug, runId);
}

function settleRun(runId: string, resultPromise: Promise<unknown>) {
  resultPromise
    .then((result) => {
      const status = (result as any)?.status === 'stalled' ? 'stalled' : 'completed';
      runs.complete(runId, status, Date.now(), JSON.stringify(result ?? null));
    })
    .catch((err) => {
      runs.complete(runId, 'failed', Date.now(), JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }));
    });
}

register('workflow.list', async () => {
  // Only return workflows that can be launched from the current UI without
  // extra form input. Greenfield/feature workflows exist in the worker but need
  // dedicated input screens before they should be presented as runnable.
  return [];
});

register('app.preflight', async () => {
  const checks: Array<{ id: string; label: string; ok: boolean; detail?: string; required: boolean }> = [];
  const bunPath = process.env.BUN_PATH || path.join(process.env.HOME || '', '.bun', 'bin', 'bun');
  checks.push({
    id: 'bun',
    label: 'Bun runtime',
    ok: fs.existsSync(bunPath),
    detail: fs.existsSync(bunPath) ? bunPath : 'Bun not found at ~/.bun/bin/bun',
    required: true,
  });
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    checks.push({ id: 'git', label: 'Git', ok: true, detail: stdout.trim(), required: true });
  } catch (e) {
    checks.push({ id: 'git', label: 'Git', ok: false, detail: e instanceof Error ? e.message : String(e), required: true });
  }
  const temporalBinary = path.join(process.env.HOME || '', '.atelier', 'temporal', 'temporal');
  checks.push({
    id: 'temporal',
    label: 'Temporal binary',
    ok: process.env.USE_EXTERNAL_TEMPORAL === 'true' || fs.existsSync(temporalBinary),
    detail: process.env.USE_EXTERNAL_TEMPORAL === 'true' ? `external at ${TEMPORAL_ADDRESS}` : temporalBinary,
    required: true,
  });
  const primary = modelConfig.findPrimary();
  let primaryConfigured = false;
  if (primary) {
    try {
      primaryConfigured = !!(await keytarWithTimeout(
        keytar.getPassword(SERVICE_NAME, keychainKey(primary.id, 'apiKey'))
      ));
    } catch {
      primaryConfigured = false;
    }
  }
  checks.push({
    id: 'provider',
    label: 'Primary model provider',
    ok: !!primary && primaryConfigured,
    detail: primary
      ? `${primary.name} / ${primary.selected_model || 'default model'}${primaryConfigured ? '' : ' (missing API key)'}`
      : 'Set a primary provider in Settings',
    required: true,
  });
  const selectedRuntime = getAgentRuntimeSetting();
  checks.push({
    id: 'agent-runtime',
    label: 'Agent CLI runtime',
    ok: true,
    detail: AGENT_RUNTIMES.find((runtime) => runtime.id === selectedRuntime)?.label ?? selectedRuntime,
    required: true,
  });
  for (const runtime of AGENT_RUNTIMES.filter((candidate) => candidate.requiresBinary)) {
    try {
      const { stdout } = await execFileAsync(runtime.requiresBinary!, ['--version']);
      checks.push({
        id: `runtime-${runtime.id}`,
        label: `${runtime.label} CLI`,
        ok: true,
        detail: stdout.trim() || `${runtime.requiresBinary} found`,
        required: selectedRuntime === runtime.id,
      });
    } catch (e) {
      checks.push({
        id: `runtime-${runtime.id}`,
        label: `${runtime.label} CLI`,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
        required: selectedRuntime === runtime.id,
      });
    }
  }
  return {
    ok: checks.every((c) => !c.required || c.ok),
    checks,
  };
});

register('autopilot.start', async (opts: { projectPath: string; projectSlug: string; suggestedFeatures?: string[] }) => {
  const client = await getTemporalClient();
  agentStreamManager.killAll();
  const runId = `autopilot-${Date.now()}`;
  const workflowId = `autopilot-${opts.projectSlug}-${runId}`;
  runs.insert(
    runId,
    projectIdForPath(opts.projectPath),
    'autopilot',
    workflowId,
    'running',
    Date.now(),
    JSON.stringify({ projectPath: opts.projectPath, suggestedFeatures: opts.suggestedFeatures || [] }),
  );
  runs.updateWorktree(runId, expectedWorktreePath(opts.projectSlug, runId));
  let handle;
  try {
    handle = await client.workflow.start('autopilotWorkflow', {
      args: [{
        projectPath: opts.projectPath,
        projectSlug: opts.projectSlug,
        runId,
        suggestedFeatures: opts.suggestedFeatures || [],
      }],
      taskQueue: 'atelier-default-ts',
      workflowId,
    });
  } catch (err) {
    runs.complete(runId, 'failed', Date.now(), JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    throw err;
  }
  settleRun(runId, handle.result());

  return { runId, workflowId: handle.workflowId };
});

register('greenfield.start', async (opts: { projectPath: string; projectSlug: string; userRequest: string }) => {
  const client = await getTemporalClient();
  agentStreamManager.killAll();
  const runId = `greenfield-${Date.now()}`;
  const workflowId = `greenfield-${opts.projectSlug}-${runId}`;
  runs.insert(
    runId,
    projectIdForPath(opts.projectPath),
    'greenfield',
    workflowId,
    'running',
    Date.now(),
    JSON.stringify({ projectPath: opts.projectPath, userRequest: opts.userRequest }),
  );
  runs.updateWorktree(runId, expectedWorktreePath(opts.projectSlug, runId));
  let handle;
  try {
    handle = await client.workflow.start('greenfieldWorkflow', {
      args: [{
        projectPath: opts.projectPath,
        projectSlug: opts.projectSlug,
        runId,
        userRequest: opts.userRequest,
      }],
      taskQueue: 'atelier-default-ts',
      workflowId,
    });
  } catch (err) {
    runs.complete(runId, 'failed', Date.now(), JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    throw err;
  }
  settleRun(runId, handle.result());
  return { runId, workflowId: handle.workflowId };
});

register('workflow.start', async (opts: { name: string; input?: unknown }) => {
  const supported: Record<string, string> = {
    mvp: 'mvpWorkflow',
    featurePipeline: 'featurePipeline',
  };
  const workflowType = supported[opts.name];
  if (!workflowType) {
    throw new Error(`Workflow "${opts.name}" is not launchable from the generic runner`);
  }
  const client = await getTemporalClient();
  agentStreamManager.killAll();
  const runId = `${opts.name}-${Date.now()}`;
  runs.insert(
    runId,
    'unknown',
    opts.name,
    `${opts.name}-${runId}`,
    'running',
    Date.now(),
    JSON.stringify(opts.input ?? {}),
  );
  let handle;
  try {
    handle = await client.workflow.start(workflowType, {
      args: [opts.input ?? {}],
      taskQueue: 'atelier-default-ts',
      workflowId: `${opts.name}-${runId}`,
    });
  } catch (err) {
    runs.complete(runId, 'failed', Date.now(), JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    throw err;
  }
  settleRun(runId, handle.result());
  return { runId, workflowId: handle.workflowId };
});
