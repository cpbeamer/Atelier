# Settings Model Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings modal where users can configure MiniMax and OpenRouter AI providers with API keys stored in the OS keychain.

**Architecture:** Settings modal in React communicates with the Bun backend via WebSocket IPC messages. Backend stores provider configs in SQLite and API keys in OS keychain via `node-keytar`. Existing WebSocket server in `index.ts` is extended to route non-PTY messages to IPC handlers.

**Tech Stack:** `node-keytar` (keychain), `better-sqlite3` (existing DB), WebSocket IPC (existing transport), React

---

## Task 1: Add model config table to SQLite

**Files:**
- Modify: `backend/src/db.ts` (add new table + queries)

- [ ] **Step 1: Add migration for model_config table**

In `backend/src/db.ts`, inside the `migrate()` function, add after the existing CREATE TABLE statements:

```typescript
    CREATE TABLE IF NOT EXISTS model_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      models_json TEXT DEFAULT '[]'
    );
```

- [ ] **Step 2: Add modelConfig export**

After the `milestones` export in `db.ts`, add:

```typescript
export const modelConfig = {
  upsert: (id: string, name: string, baseUrl: string, enabled: number, modelsJson: string) =>
    getDb().prepare(`
      INSERT INTO model_config (id, name, base_url, enabled, models_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, base_url=excluded.base_url,
        enabled=excluded.enabled, models_json=excluded.models_json
    `).run(id, name, baseUrl, enabled, modelsJson),
  list: () => getDb().prepare('SELECT * FROM model_config ORDER BY name').all(),
  setEnabled: (id: string, enabled: number) =>
    getDb().prepare('UPDATE model_config SET enabled=? WHERE id=?').run(enabled, id),
  setModels: (id: string, modelsJson: string) =>
    getDb().prepare('UPDATE model_config SET models_json=? WHERE id=?').run(modelsJson, id),
};
```

- [ ] **Step 3: Seed default providers**

Add at the end of `migrate()`:

```typescript
  // Seed MiniMax and OpenRouter if no providers exist
  const count = getDb().prepare('SELECT COUNT(*) as c FROM model_config').get() as { c: number };
  if (count.c === 0) {
    getDb().prepare(`INSERT INTO model_config (id, name, base_url, enabled, models_json) VALUES (?,?,?,?,?)`)
      .run('minimax', 'MiniMax', 'https://api.minimax.chat/v1', 0, '["MiniMax/Abab6.5s-chat","MiniMax/Abab6.5-chat"]');
    getDb().prepare(`INSERT INTO model_config (id, name, base_url, enabled, models_json) VALUES (?,?,?,?,?)`)
      .run('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 0, '["anthropic/claude-3.5-sonnet","openai/gpt-4o"]');
  }
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat(backend): add model_config table to SQLite"
```

---

## Task 2: Wire IPC handlers to WebSocket server

**Files:**
- Modify: `backend/src/index.ts` (route non-PTY messages to handlers)

- [ ] **Step 1: Import ipc-handlers**

At the top of `backend/src/index.ts`, add:

```typescript
import './ipc-handlers.js';
```

- [ ] **Step 2: Add IPC message handler to WebSocket server**

In the `ws.on('message', ...)` block in `index.ts`, add after the `pty-resize` handler:

```typescript
    } else if (msg.type.startsWith('settings:') || msg.type.startsWith('db:')) {
      // Route to IPC handlers via event emitter
      const handlers = (globalThis as any).__ipcHandlers;
      if (handlers && handlers[msg.type]) {
        handlers[msg.type](msg.payload).then((result: any) => {
          ws.send(JSON.stringify({ type: msg.type + ':response', id: msg.id, payload: result }));
        }).catch((err: any) => {
          ws.send(JSON.stringify({ type: msg.type + ':response', id: msg.id, error: err.message }));
        });
      }
```

Note: `globalThis.__ipcHandlers` will be populated by the handlers registration. See Task 3.

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): route IPC messages to handlers via WebSocket"
```

---

## Task 3: Implement model config IPC handlers

**Files:**
- Modify: `backend/src/ipc-handlers.ts` (add settings handlers)
- Modify: `package.json` (add node-keytar dependency — done in Task 0)

- [ ] **Step 1: Add node-keytar dependency**

In the root `package.json`, add to dependencies:

```json
"node-keytar": "^7.9.0"
```

Run `bun add node-keytar` in the backend directory.

- [ ] **Step 2: Replace ipc-handlers.ts with full implementation**

Replace the contents of `backend/src/ipc-handlers.ts` with:

```typescript
// backend/src/ipc-handlers.ts
import { projects, runs, milestones, modelConfig } from './db.js';
import { ptyManager } from './pty-manager.js';
import { createWorktree, removeWorktree } from './worktree.js';
import { startSidecar, stopSidecar, getSidecarStatus } from './sidecar-lifecycle.js';
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
register('milestone.listPending', async () => milestones.listPending());

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
    result.push({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      configured: !!apiKey,
      models: JSON.parse(row.models_json || '[]'),
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
  await keytar.setPassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'), opts.apiKey);
});

register('settings.apiKey:delete', async (opts: { providerId: string }) => {
  await keytar.deletePassword(SERVICE_NAME, keychainKey(opts.providerId, 'apiKey'));
});
```

- [ ] **Step 3: Add type for global handler registry**

In `backend/src/index.ts` (or a new `backend/src/global.d.ts`), add:

```typescript
declare global {
  var __ipcHandlers: Record<string, (opts: any) => Promise<any>> | undefined;
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/ipc-handlers.ts backend/src/index.ts package.json
git commit -m "feat(backend): add model config IPC handlers with keytar keychain"
```

---

## Task 4: Create WebSocket IPC utility for frontend

**Files:**
- Create: `frontend/src/lib/ipc.ts`

- [ ] **Step 1: Write IPC WebSocket utility**

Create `frontend/src/lib/ipc.ts`:

```typescript
// frontend/src/lib/ipc.ts

let ws: WebSocket | null = null;
let messageId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function getWs(): WebSocket {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    ws = new WebSocket('ws://localhost:3000');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.payload);
      }
    };
  }
  return ws;
}

export function invoke<T = any>(channel: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    const socket = getWs();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: channel, id, payload }));
    } else {
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: channel, id, payload }));
      };
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/ipc.ts
git commit -m "feat(frontend): add WebSocket IPC invoke utility"
```

---

## Task 5: Create SettingsModal component

**Files:**
- Create: `frontend/src/components/SettingsModal.tsx`
- Create: `frontend/src/components/ProviderCard.tsx` (extracted sub-component)

- [ ] **Step 1: Write SettingsModal component**

Create `frontend/src/components/SettingsModal.tsx`:

```tsx
// frontend/src/components/SettingsModal.tsx
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { invoke } from '../lib/ipc';

interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  configured: boolean;
  models: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: Props) {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<{ providerId: string; value: string } | null>(null);

  useEffect(() => {
    if (isOpen) loadConfig();
  }, [isOpen]);

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const config = await invoke<ModelProvider[]>('settings.modelConfig:get');
      setProviders(config);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string) {
    const updated = providers.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    );
    setProviders(updated);
    const p = updated.find(x => x.id === id)!;
    await invoke('settings.modelConfig:set', { id, enabled: p.enabled, models: p.models });
  }

  async function handleModelSelect(providerId: string, model: string) {
    const p = providers.find(x => x.id === providerId)!;
    await invoke('settings.modelConfig:set', { id: providerId, enabled: p.enabled, models: [model] });
    setProviders(prev => prev.map(x => x.id === providerId ? { ...x, models: [model] } : x));
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput) return;
    await invoke('settings.apiKey:set', { providerId: apiKeyInput.providerId, apiKey: apiKeyInput.value });
    setApiKeyInput(null);
    await loadConfig();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Model Providers</h3>

          {loading && <p className="text-muted-foreground">Loading...</p>}
          {error && <p className="text-red-500">{error}</p>}

          <div className="space-y-4">
            {providers.map(provider => (
              <div key={provider.id} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{provider.name}</span>
                    {provider.configured && (
                      <span className="text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded">Configured</span>
                    )}
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Enabled</span>
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={() => handleToggle(provider.id)}
                      className="w-4 h-4"
                    />
                  </label>
                </div>

                {provider.configured && provider.models.length > 0 && (
                  <div className="mb-3">
                    <label className="text-xs text-muted-foreground block mb-1">Model</label>
                    <select
                      value={provider.models[0]}
                      onChange={(e) => handleModelSelect(provider.id, e.target.value)}
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                    >
                      {provider.models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* API Key management */}
                {apiKeyInput?.providerId === provider.id ? (
                  <div className="mt-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="Enter API key"
                      value={apiKeyInput.value}
                      onChange={(e) => setApiKeyInput({ ...apiKeyInput, value: e.target.value })}
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm mb-2"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveApiKey}
                        className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:opacity-90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setApiKeyInput(null)}
                        className="px-3 py-1 border border-border rounded text-sm hover:bg-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setApiKeyInput({ providerId: provider.id, value: '' })}
                    className="mt-2 text-sm text-muted-foreground hover:text-foreground underline"
                  >
                    {provider.configured ? 'Update API Key' : 'Add API Key'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SettingsModal.tsx
git commit -m "feat(frontend): add SettingsModal component with model provider config"
```

---

## Task 6: Wire Settings button to open modal

**Files:**
- Modify: `frontend/src/App.tsx` — add `showSettings` state and render `<SettingsModal>`
- Modify: `frontend/src/components/Sidebar.tsx` — add `onSettingsClick` prop

- [ ] **Step 1: Update Sidebar props**

In `frontend/src/components/Sidebar.tsx`, update the Props interface:

```tsx
interface Props {
  onProjectSelect?: (project: Project) => void;
  onWorkflowSelect?: (workflow: { name: string; language: 'typescript' | 'python' }) => void;
  onSettingsClick?: () => void;
  activeProject?: Project | null;
}
```

Update the Settings button:

```tsx
<button
  onClick={onSettingsClick}
  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
>
  <Settings className="w-4 h-4" />
  Settings
</button>
```

- [ ] **Step 2: Update App.tsx**

In `frontend/src/App.tsx`, add `showSettings` state and render the modal:

```tsx
const [showSettings, setShowSettings] = useState(false);
```

Add `<SettingsModal>` inside the App div (before closing `</div>` of the main content area):

```tsx
<SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
```

Pass to Sidebar:

```tsx
<Sidebar
  activeProject={activeProject}
  onProjectSelect={setActiveProject}
  onWorkflowSelect={handleWorkflowSelect}
  onSettingsClick={() => setShowSettings(true)}
/>
```

- [ ] **Step 3: Import SettingsModal**

Add to the imports in `App.tsx`:

```tsx
import { SettingsModal } from './components/SettingsModal';
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat(frontend): wire Settings button to open SettingsModal"
```

---

## Verification

After all tasks:

1. Run `bun run dev` from project root
2. Click **Settings** in sidebar footer — modal should open
3. Provider cards for **MiniMax** and **OpenRouter** should appear
4. Click **Add API Key**, enter a key, click Save — card should show "Configured"
5. Toggle **Enabled** — toggle should respond
6. Select a model from dropdown — should save
7. Close and reopen modal — config should persist

**No keys should appear in React DevTools component state or props.**
