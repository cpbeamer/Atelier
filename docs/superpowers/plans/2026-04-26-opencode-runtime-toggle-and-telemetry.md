# opencode Runtime Toggle + Telemetry Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Replaces Tasks 8–23 of `2026-04-25-opencode-agent-terminal-routing.md`,** which are abandoned. That plan was written before the activity layer evolved to include `withJsonRetry`, `architect-judge` best-of-3, the 4-specialist `reviewCodePanel`, `implementCodeBestOfN`, and per-call telemetry. Tasks 1–7 of that plan (per-run serve lifecycle, run registry, sessions, bootstrap, persona matrix, arbiter persona, `bun test` wiring) **shipped** and are reused here.

**Goal:** Make `opencode` a first-class, settings-toggleable backend for the developer activity, with usage telemetry forwarded into `agent_calls` so the cost-by-agent panel reflects developer cost.

**Architecture:** Add a global `app_settings` KV table behind backend HTTP + IPC. The worker's developer activity reads `useOpencode` from the backend (env var fallback) instead of `process.env.ATELIER_USE_OPENCODE`. When the flag is on, the autopilot workflow starts a per-run `opencode serve` (Tasks 1-7's `lifecycle.ts`) and the developer activity routes prompts through the serve's HTTP session API via `@opencode-ai/sdk`. Token usage from the SDK's session response is forwarded to `/api/agent/call` so it appears in the cost panel alongside the other personas.

**Tech Stack:** Bun + TypeScript (existing), `bun test` (existing — Task 1 of prior plan), Temporal TS SDK (existing), `@opencode-ai/sdk` (new — added in Task 6), node-pty (existing, no longer used by developer path).

**Out of scope (explicitly deferred to a follow-up plan):**
- Best-of-N for high-complexity tickets under opencode (`implementCodeBestOfN` short-circuits to single-pass; needs per-candidate sub-worktrees, separate design).
- Migrating planning/review activities (researcher, architect, reviewer panel) to opencode. They use `callLLM` and don't benefit from tools.

---

## File map

**New (backend):**
- `backend/src/app-settings.ts` — KV repository over a new `app_settings` table
- `backend/test/app-settings.test.ts`

**New (worker):**
- `worker/src/llm/featureFlags.ts` — `useOpencode()` resolver: backend setting → env-var fallback → false
- `worker/test/featureFlags.test.ts`
- `worker/src/llm/opencodeServeClient.ts` — thin wrapper over `@opencode-ai/sdk` for sending a prompt to a run's developer session and collecting usage

**Modified (backend):**
- `backend/src/db.ts` — add `app_settings` DDL block
- `backend/src/index.ts` — add `GET /api/settings/useOpencode`, `POST /api/settings/useOpencode`, plus per-run lifecycle + session routes
- `backend/src/ipc-handlers.ts` — add `settings.useOpencode:get`, `settings.useOpencode:set`

**Modified (worker):**
- `worker/src/activities.ts` — replace `process.env.ATELIER_USE_OPENCODE === '1'` checks with `await useOpencode()`; add `startRunOpencode` / `stopRunOpencode` / `useOpencodeForRun` activities
- `worker/src/llm/opencodeAgent.ts` — replace PTY-spawn body with SDK call; keep the `snapshotHead` / `diffFilesSince` / `extractSummary` helpers (they're correct and reused)
- `worker/src/workflows/autopilot.workflow.ts` — wrap the body in a try/finally that ensures `stopRunOpencode(runId)` runs on every exit; call `startRunOpencode` at the top when `useOpencodeForRun()` is true

**Modified (frontend):**
- `frontend/src/components/SettingsModal.tsx` — add an "Implementation backend" section with the toggle

**Modified (docs):**
- `docs/opencode-integration.md` — update "Enable" section to describe the UI toggle as primary, env var as fallback; update "Tradeoffs" to note telemetry is now forwarded

**Removed:** None. The PTY-based developer path is rewritten in place; the legacy `callLLM` + `BEGIN FILE` parsing path is preserved unchanged for users who keep the toggle off.

---

## Task 1: Add `app_settings` KV table to the DB layer

**Files:**
- Modify: `backend/src/db.ts`
- Create: `backend/src/app-settings.ts`
- Create: `backend/test/app-settings.test.ts`

- [ ] **Step 1: Add the table DDL**

In `backend/src/db.ts`, inside the `db.exec(\`...\`)` block that creates the schema (around line 90, after the `project_context` table), add:

```sql
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
```

- [ ] **Step 2: Write the failing repository test**

Create `backend/test/app-settings.test.ts`:

```ts
import { test, expect, beforeEach } from 'bun:test';
import { initDb, getDb } from '../src/db.js';
import { appSettings } from '../src/app-settings.js';

beforeEach(() => {
  // Use an in-memory DB per test to avoid cross-test pollution.
  initDb(':memory:');
  getDb().exec('DELETE FROM app_settings');
});

test('get returns null when key is absent', () => {
  expect(appSettings.get('useOpencode')).toBeNull();
});

test('set then get returns the stored string value', () => {
  appSettings.set('useOpencode', 'true');
  expect(appSettings.get('useOpencode')).toBe('true');
});

test('set overwrites an existing value', () => {
  appSettings.set('useOpencode', 'true');
  appSettings.set('useOpencode', 'false');
  expect(appSettings.get('useOpencode')).toBe('false');
});

test('getBool parses "true"/"false" and falls back to default', () => {
  expect(appSettings.getBool('useOpencode', false)).toBe(false);
  appSettings.set('useOpencode', 'true');
  expect(appSettings.getBool('useOpencode', false)).toBe(true);
  appSettings.set('useOpencode', 'false');
  expect(appSettings.getBool('useOpencode', true)).toBe(false);
});
```

- [ ] **Step 3: Verify the test fails**

Run: `cd backend && bun test test/app-settings.test.ts`
Expected: FAIL with `Cannot find module './app-settings.js'` or similar.

- [ ] **Step 4: Implement `app-settings.ts`**

Create `backend/src/app-settings.ts`:

```ts
import { getDb } from './db.js';

export const appSettings = {
  get(key: string): string | null {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    getDb()
      .prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(key, value, Date.now());
  },

  /** Convenience: parses "true" / "false" strings, returns `defaultValue` when
   *  the key is absent or the stored value is anything else. */
  getBool(key: string, defaultValue: boolean): boolean {
    const raw = this.get(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultValue;
  },
};
```

If `initDb` does not currently accept a path argument, update `backend/src/db.ts` so `initDb(':memory:')` works for tests:

```ts
let db: import('better-sqlite3').Database | null = null;

export function initDb(pathOverride?: string): void {
  const Database = require('better-sqlite3');
  const dbPath = pathOverride ?? path.join(/* existing default */);
  db = new Database(dbPath);
  // ... existing exec() ...
}

export function getDb() {
  if (!db) throw new Error('initDb not called');
  return db;
}
```

If `initDb` is already path-parameterized, leave it alone.

- [ ] **Step 5: Verify the test passes**

Run: `cd backend && bun test test/app-settings.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db.ts backend/src/app-settings.ts backend/test/app-settings.test.ts
git commit -m "feat(backend): add app_settings KV table"
```

---

## Task 2: Backend HTTP and IPC handlers for `useOpencode`

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/src/ipc-handlers.ts`

- [ ] **Step 1: Add HTTP handlers**

In `backend/src/index.ts`, add these route handlers BEFORE the `// Default: 404` block (currently around line 522):

```ts
  // GET /api/settings/useOpencode — returns { useOpencode: boolean }
  if (req.method === 'GET' && url.pathname === '/api/settings/useOpencode') {
    try {
      const value = appSettings.getBool('useOpencode', false);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ useOpencode: value }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // POST /api/settings/useOpencode — body { useOpencode: boolean }
  if (req.method === 'POST' && url.pathname === '/api/settings/useOpencode') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { useOpencode?: unknown };
        if (typeof parsed.useOpencode !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'body must be { useOpencode: boolean }' }));
          return;
        }
        appSettings.set('useOpencode', parsed.useOpencode ? 'true' : 'false');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, useOpencode: parsed.useOpencode }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }
```

Add the import at the top of the file:

```ts
import { appSettings } from './app-settings.js';
```

- [ ] **Step 2: Add IPC handlers**

In `backend/src/ipc-handlers.ts`, register new handlers (match the existing `settings.modelConfig:*` style; if those are inside a `case` switch, add cases there; if they're a registry object, add entries):

```ts
  'settings.useOpencode:get': async () => {
    return { useOpencode: appSettings.getBool('useOpencode', false) };
  },

  'settings.useOpencode:set': async ({ useOpencode }: { useOpencode: boolean }) => {
    if (typeof useOpencode !== 'boolean') {
      throw new Error('useOpencode must be a boolean');
    }
    appSettings.set('useOpencode', useOpencode ? 'true' : 'false');
    return { ok: true };
  },
```

Add the import at the top:

```ts
import { appSettings } from './app-settings.js';
```

- [ ] **Step 3: Manual smoke test the HTTP path**

Start the backend: `cd backend && bun run dev`

In a separate terminal:

```bash
curl -s http://localhost:3001/api/settings/useOpencode
# expected: {"useOpencode":false}

curl -s -X POST http://localhost:3001/api/settings/useOpencode \
  -H 'Content-Type: application/json' \
  -d '{"useOpencode":true}'
# expected: {"ok":true,"useOpencode":true}

curl -s http://localhost:3001/api/settings/useOpencode
# expected: {"useOpencode":true}

# Reset for next task:
curl -s -X POST http://localhost:3001/api/settings/useOpencode \
  -H 'Content-Type: application/json' \
  -d '{"useOpencode":false}'
```

Expected: each curl returns the JSON shown.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts backend/src/ipc-handlers.ts
git commit -m "feat(backend): add useOpencode HTTP and IPC handlers"
```

---

## Task 3: Worker `featureFlags.ts` with backend-resolved `useOpencode`

**Files:**
- Create: `worker/src/llm/featureFlags.ts`
- Create: `worker/test/featureFlags.test.ts`
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/featureFlags.test.ts`:

```ts
import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { useOpencode } from '../src/llm/featureFlags.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = process.env.ATELIER_USE_OPENCODE;

beforeEach(() => {
  delete process.env.ATELIER_USE_OPENCODE;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENV !== undefined) process.env.ATELIER_USE_OPENCODE = ORIGINAL_ENV;
  else delete process.env.ATELIER_USE_OPENCODE;
});

test('returns true when backend reports true', async () => {
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ useOpencode: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  expect(await useOpencode()).toBe(true);
});

test('returns false when backend reports false', async () => {
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ useOpencode: false }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  expect(await useOpencode()).toBe(false);
});

test('falls back to env var when backend is unreachable', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  process.env.ATELIER_USE_OPENCODE = '1';
  expect(await useOpencode()).toBe(true);
});

test('returns false when both backend and env var are absent', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  expect(await useOpencode()).toBe(false);
});

test('env var "0" is treated as false', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  process.env.ATELIER_USE_OPENCODE = '0';
  expect(await useOpencode()).toBe(false);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `cd worker && bun test test/featureFlags.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `featureFlags.ts`**

Create `worker/src/llm/featureFlags.ts`:

```ts
// Resolves Atelier feature flags. Backend is authoritative; env vars are a
// developer-mode fallback (lets the worker run standalone without the backend).

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export async function useOpencode(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND}/api/settings/useOpencode`);
    if (response.ok) {
      const data = await response.json() as { useOpencode: boolean };
      return data.useOpencode === true;
    }
  } catch {
    // Backend unreachable — fall through to env var.
  }
  return process.env.ATELIER_USE_OPENCODE === '1';
}
```

- [ ] **Step 4: Verify the test passes**

Run: `cd worker && bun test test/featureFlags.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Replace env-var checks in `activities.ts`**

In `worker/src/activities.ts`, find the two existing env-var checks:

- Line 769: `if (process.env.ATELIER_USE_OPENCODE === '1') {` (inside `implementCode`)
- Line 867: `if (process.env.ATELIER_USE_OPENCODE === '1') {` (inside `implementCodeBestOfN`)

Replace both with:

```ts
  if (await useOpencode()) {
```

Add the import near the top of the file (alongside the existing `withJsonRetry`/`callLLM` imports):

```ts
import { useOpencode } from './llm/featureFlags.js';
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/llm/featureFlags.ts worker/test/featureFlags.test.ts worker/src/activities.ts
git commit -m "feat(worker): resolve useOpencode from backend setting with env fallback"
```

---

## Task 4: Settings UI toggle for "Use opencode for implementation"

**Files:**
- Modify: `frontend/src/components/SettingsModal.tsx`

- [ ] **Step 1: Add state and load logic**

In `frontend/src/components/SettingsModal.tsx`, inside the `SettingsModal` component (after the existing `customError` state, around line 49):

```tsx
  const [useOpencodeFlag, setUseOpencodeFlag] = useState<boolean>(false);
  const [useOpencodeLoading, setUseOpencodeLoading] = useState(false);
```

In the `loadConfig` function (around line 55), AFTER the `setProviders(config)` line, add:

```tsx
      const flag = await invoke<{ useOpencode: boolean }>('settings.useOpencode:get');
      setUseOpencodeFlag(flag.useOpencode);
```

- [ ] **Step 2: Add the toggle handler**

After `handleSubmitCustom` (around line 130), add:

```tsx
  async function handleToggleUseOpencode() {
    const next = !useOpencodeFlag;
    setUseOpencodeLoading(true);
    setUseOpencodeFlag(next);
    try {
      await invoke('settings.useOpencode:set', { useOpencode: next });
    } catch (e: any) {
      setError(e.message);
      setUseOpencodeFlag(!next); // revert
    } finally {
      setUseOpencodeLoading(false);
    }
  }
```

- [ ] **Step 3: Render the toggle section**

In the JSX, BEFORE the `<div className="mt-6 pt-5 border-t border-[var(--color-hair)]">` block that wraps custom-provider-form (around line 213), add:

```tsx
          <div className="mt-6 pt-5 border-t border-[var(--color-hair)]">
            <div className="text-[12px] text-[var(--color-text-faint)] mb-3">
              Implementation backend
            </div>
            <div className="rounded-lg border border-[var(--color-hair)] bg-[var(--color-surface-2)]/50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium mb-1">
                    Use opencode for the developer agent
                  </div>
                  <div className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
                    When on, the developer agent runs as a tool-using opencode session
                    inside the worktree (Read, Edit, Bash, Grep). When off, the developer
                    uses the legacy one-shot LLM dictation path.
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-[12px] cursor-pointer shrink-0 pt-1">
                  <input
                    type="checkbox"
                    checked={useOpencodeFlag}
                    disabled={useOpencodeLoading}
                    onChange={handleToggleUseOpencode}
                    className="w-3 h-3 accent-[var(--color-accent)]"
                  />
                  <span className="text-[var(--color-text-muted)]">
                    {useOpencodeFlag ? 'On' : 'Off'}
                  </span>
                </label>
              </div>
            </div>
          </div>
```

- [ ] **Step 4: Manual UI verification**

Start the dev stack:

```bash
make dev
```

(Or the project's standard launcher — check `Makefile`.)

Open the app, open Settings (the gear icon in the sidebar). Expected:

1. The new "Implementation backend" section appears below the providers.
2. The toggle reflects the current backend setting (default off).
3. Clicking the toggle persists across modal close/reopen.
4. With backend running but no opencode binary on PATH, the toggle should still flip in the UI; the worker won't crash because `useOpencode()` failing falls back to `false`.

If the modal shows an error after toggling, check the browser console; the most likely cause is an IPC handler typo in Task 2.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SettingsModal.tsx
git commit -m "feat(frontend): settings toggle for opencode developer backend"
```

---

## Task 5: Wire per-run opencode serve into the autopilot workflow lifecycle

**Files:**
- Modify: `worker/src/activities.ts`
- Modify: `worker/src/workflows/autopilot.workflow.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add backend HTTP endpoints to start, stop, and look up a run's opencode serve**

In `backend/src/index.ts`, add BEFORE the `// Default: 404` block:

```ts
  // POST /api/opencode/run/:runId/start — body { worktreePath: string }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/opencode\/run\/[^/]+\/start$/)) {
    const runId = url.pathname.split('/')[4];
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { worktreePath } = JSON.parse(body) as { worktreePath: string };
        if (!worktreePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'worktreePath required' }));
          return;
        }
        const { startOpencodeServer } = await import('./opencode/lifecycle.js');
        const info = await startOpencodeServer(runId, worktreePath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runId, ...info }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // POST /api/opencode/run/:runId/stop
  if (req.method === 'POST' && url.pathname.match(/^\/api\/opencode\/run\/[^/]+\/stop$/)) {
    const runId = url.pathname.split('/')[4];
    try {
      const { stopOpencodeServer } = await import('./opencode/lifecycle.js');
      await stopOpencodeServer(runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // GET /api/opencode/run/:runId — returns { runId, worktreePath, port, password } or 404
  if (req.method === 'GET' && url.pathname.match(/^\/api\/opencode\/run\/[^/]+$/)) {
    const runId = url.pathname.split('/')[4];
    try {
      const { getOpencodeServer } = await import('./opencode/lifecycle.js');
      const info = getOpencodeServer(runId);
      if (!info) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `no opencode server for run ${runId}` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        runId,
        worktreePath: info.worktreePath,
        port: info.port,
        password: info.password,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // POST /api/opencode/run/:runId/session/:persona — ensure the persona session
  // exists for this run, returns { sessionId }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/opencode\/run\/[^/]+\/session\/[^/]+$/)) {
    const parts = url.pathname.split('/');
    const runId = parts[4];
    const persona = parts[6];
    try {
      const { ensureSession } = await import('./opencode/sessions.js');
      const result = await ensureSession(runId, persona as any);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }
```

- [ ] **Step 2: Add worker activities for start/stop and a workflow-callable flag wrapper**

In `worker/src/activities.ts`, append near the other HTTP-emitting helpers:

```ts
const OPENCODE_BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export async function startRunOpencode(input: { runId: string; worktreePath: string }): Promise<void> {
  const response = await fetch(`${OPENCODE_BACKEND}/api/opencode/run/${encodeURIComponent(input.runId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreePath: input.worktreePath }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to start opencode serve for run ${input.runId}: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
}

export async function stopRunOpencode(input: { runId: string }): Promise<void> {
  // Best-effort: failure here is non-fatal, the cleanup just leaks a subprocess
  // until the backend exits. Don't throw.
  try {
    await fetch(`${OPENCODE_BACKEND}/api/opencode/run/${encodeURIComponent(input.runId)}/stop`, {
      method: 'POST',
    });
  } catch {
    // Backend unreachable — caller has nothing useful to do.
  }
}

// Workflow code can't read process.env or call fetch directly. Expose the
// flag resolver as an activity so the workflow can branch on it.
export async function useOpencodeForRun(): Promise<boolean> {
  return useOpencode();
}
```

- [ ] **Step 3: Update the autopilot workflow to start/stop the serve**

In `worker/src/workflows/autopilot.workflow.ts`, extend the `proxyActivities` destructure to include the three new activities:

```ts
const {
  setupWorkspace,
  researchRepo,
  debateFeatures,
  generateTickets,
  scopeArchitecture,
  implementCode,
  implementCodeBestOfN,
  reviewCodePanel,
  testCode,
  verifyCode,
  pushChanges,
  emitStalledMilestone,
  notifyAgentStart,
  notifyAgentComplete,
  startRunOpencode,
  stopRunOpencode,
  useOpencodeForRun,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2s',
    backoffCoefficient: 2.0,
    maximumInterval: '1 minute',
    nonRetryableErrorTypes: ['NonRetryableAgentError'],
  },
});
```

Wrap the existing workflow body in a try/finally so the stop runs on every exit path. Replace the body of `autopilotWorkflow` so the structure becomes:

```ts
export async function autopilotWorkflow(input: AutopilotInput): Promise<AutopilotOutput> {
  const { projectPath, projectSlug, runId, userContext = {}, suggestedFeatures = [] } = input;
  let opencodeStarted = false;
  try {
    // Phase 0: Create git worktree for isolated work
    const { worktreePath } = await setupWorkspace({ projectPath, projectSlug, runId });

    // If opencode is the chosen backend, start the per-run serve.
    if (await useOpencodeForRun()) {
      await startRunOpencode({ runId, worktreePath });
      opencodeStarted = true;
    }

    // ... existing phases 1 through 8, unchanged ...

    return {
      status: 'completed',
      ticketsCreated: scopedTickets.length,
      prBranch: pushResult.branch,
    };
  } finally {
    if (opencodeStarted) {
      await stopRunOpencode({ runId });
    }
  }
}
```

Existing `return { status: 'stalled', ... }` paths inside the body remain — they'll fall through to the finally block automatically, which is the point.

- [ ] **Step 4: Smoke test the lifecycle end-to-end**

Manual integration test (opencode binary required):

```bash
# 1. Toggle useOpencode on
curl -X POST http://localhost:3001/api/settings/useOpencode \
  -H 'Content-Type: application/json' -d '{"useOpencode":true}'

# 2. Start a small autopilot run from the UI against a sandbox repo

# 3. While it's running, in another terminal:
ps aux | grep "opencode serve" | grep -v grep
# expected: one opencode serve process per active run

# 4. After the run completes (or you cancel it), confirm the process exited:
ps aux | grep "opencode serve" | grep -v grep
# expected: no output
```

If the process leaks past run completion, the `stopRunOpencode` finally-block isn't firing — check Temporal worker logs and the `stopOpencodeServer` implementation in `backend/src/opencode/lifecycle.ts`.

- [ ] **Step 5: Commit**

```bash
git add worker/src/activities.ts worker/src/workflows/autopilot.workflow.ts backend/src/index.ts
git commit -m "feat: per-run opencode serve start/stop on workflow lifecycle"
```

---

## Task 6: Add the `@opencode-ai/sdk` dependency and serve client wrapper

**Files:**
- Modify: `worker/package.json`
- Create: `worker/src/llm/opencodeServeClient.ts`

- [ ] **Step 1: Add the SDK dep**

```bash
cd worker && bun add @opencode-ai/sdk
```

This updates `worker/package.json` with the new dep and the lockfile.

- [ ] **Step 2: Implement the wrapper**

Create `worker/src/llm/opencodeServeClient.ts`:

```ts
// Wraps @opencode-ai/sdk for sending a developer prompt to an existing per-run
// opencode session and collecting back the assistant text + token usage.
//
// The per-run server is started by the workflow's startRunOpencode activity
// (Task 5). We resolve port/password from the backend, lazily create or reuse
// the developer session, send the prompt, and return the result.

import OpencodeClient from '@opencode-ai/sdk';

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export interface ServeRunInfo {
  runId: string;
  worktreePath: string;
  port: number;
  password: string;
}

export interface ServeMessageInput {
  runId: string;
  /** Persona key — must match a Persona literal in backend/src/opencode/personas.ts */
  persona: string;
  /** Full prompt body sent to the session as a user message. */
  prompt: string;
  /** Optional model override (e.g. "primary/MiniMax-M2.7"). Defaults to whatever
   *  the bootstrapped opencode.json declares as `model`. */
  model?: string;
}

export interface ServeMessageOutput {
  text: string;
  promptTokens: number;
  completionTokens: number;
  /** opencode session id — useful for follow-up turns and audit. */
  sessionId: string;
  /** Aggregate cost in USD if the SDK reports it; 0 otherwise. */
  costUsd: number;
}

export async function getServeRunInfo(runId: string): Promise<ServeRunInfo> {
  const response = await fetch(`${BACKEND}/api/opencode/run/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(`No opencode server registered for run ${runId} (HTTP ${response.status})`);
  }
  return await response.json() as ServeRunInfo;
}

function buildClient(info: ServeRunInfo): OpencodeClient {
  return new OpencodeClient({
    baseURL: `http://127.0.0.1:${info.port}`,
    auth: { username: 'opencode', password: info.password },
  });
}

export async function sendDeveloperPrompt(input: ServeMessageInput): Promise<ServeMessageOutput> {
  const info = await getServeRunInfo(input.runId);
  const client = buildClient(info);

  // Reuse the per-persona session created by backend/src/opencode/sessions.ts.
  // The backend's run registry caches sessionId per persona, so this is a
  // cheap lookup after the first call.
  const sessionResp = await fetch(`${BACKEND}/api/opencode/run/${encodeURIComponent(input.runId)}/session/${encodeURIComponent(input.persona)}`, {
    method: 'POST',
  });
  if (!sessionResp.ok) {
    const text = await sessionResp.text().catch(() => '');
    throw new Error(`Failed to ensure opencode session for ${input.persona}: HTTP ${sessionResp.status} ${text.slice(0, 200)}`);
  }
  const { sessionId } = await sessionResp.json() as { sessionId: string };

  const result = await client.sessions.message({
    sessionId,
    role: 'user',
    content: input.prompt,
    ...(input.model ? { model: input.model } : {}),
  });

  return {
    text: result.content ?? '',
    promptTokens: result.usage?.inputTokens ?? 0,
    completionTokens: result.usage?.outputTokens ?? 0,
    costUsd: result.usage?.costUsd ?? 0,
    sessionId,
  };
}
```

> **NOTE on SDK shape:** the `@opencode-ai/sdk` API surface above (`new OpencodeClient(...)`, `client.sessions.message(...)`, `result.usage.{inputTokens,outputTokens,costUsd}`) reflects the SDK's documented shape as of writing. If the installed version's surface differs, adjust the import + method names but **keep the function signature** of `sendDeveloperPrompt` unchanged — Task 7 depends on the `ServeMessageOutput` shape exactly. Run `bun pm ls @opencode-ai/sdk` and check the SDK's README to verify before implementing.

- [ ] **Step 3: Commit**

```bash
git add worker/package.json worker/bun.lockb worker/src/llm/opencodeServeClient.ts
git commit -m "feat(worker): add opencode SDK serve client wrapper"
```

---

## Task 7: Replace the developer's PTY-spawn path with the serve client and forward telemetry

**Files:**
- Modify: `worker/src/llm/opencodeAgent.ts`

- [ ] **Step 1: Rewrite `runOpenCodeAgent`**

In `worker/src/llm/opencodeAgent.ts`, KEEP the existing `snapshotHead`, `diffFilesSince`, `extractSummary`, and `buildTaskPrompt` helpers. REPLACE the PTY-using parts of `runOpenCodeAgent` with an SDK-based body and add a telemetry forwarder. The full new file body:

```ts
// Routes the developer activity through the per-run opencode serve via the
// SDK, capturing token usage on each turn for the cost-by-agent panel.

import { writeOpencodeConfig, writeAgentsRules } from './opencodeConfig';
import { sendDeveloperPrompt } from './opencodeServeClient';
import type { PrimaryProvider } from './callLLM';
import type { ScopedTicket } from '../activities';

export interface OpenCodeRunInput {
  worktreePath: string;
  ticket: ScopedTicket;
  feedback?: string[];
  testFeedback?: string[];
  agentId: string;
  runId: string;
  /** Resolved primary-provider API key. Currently unused on the SDK path
   *  because the per-run serve already has the key wired in via the
   *  bootstrapped opencode.json — kept for signature compatibility. */
  apiKey: string;
  primaryProvider: PrimaryProvider;
  developerPersona: string;
}

export interface OpenCodeRunOutput {
  summary: string;
  filesChanged: string[];
  exitCode: number;
  outputTail: string;
}

export class NoOpencodeChangesError extends Error {
  name = 'NonRetryableAgentError';
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { stdout, exitCode };
  } catch {
    return { stdout: '', exitCode: 1 };
  }
}

async function snapshotHead(worktreePath: string): Promise<string | null> {
  const { stdout, exitCode } = await runGit(worktreePath, ['rev-parse', 'HEAD']);
  if (exitCode !== 0) return null;
  const sha = stdout.trim();
  return sha.length > 0 ? sha : null;
}

async function diffFilesSince(worktreePath: string, baseSha: string | null): Promise<string[]> {
  const files = new Set<string>();
  if (baseSha) {
    const tracked = await runGit(worktreePath, ['diff', '--name-only', baseSha]);
    tracked.stdout.split('\n').filter(Boolean).forEach((f) => files.add(f.trim()));
  }
  const untracked = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
  untracked.stdout.split('\n').filter(Boolean).forEach((f) => files.add(f.trim()));
  return Array.from(files);
}

function buildTaskPrompt(input: OpenCodeRunInput): string {
  const { ticket, feedback, testFeedback } = input;
  const parts: string[] = [
    `Implement the following ticket in this repository. Use your tools to read existing code, write changes, and verify your work.`,
    ``,
    `Ticket: ${ticket.title}`,
    ticket.description,
    ``,
    `Technical plan:`,
    ticket.technicalPlan,
    ``,
    `Acceptance criteria:`,
    ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n'),
  ];
  if (ticket.filesToChange?.length) {
    parts.push('', `Suggested files to change: ${ticket.filesToChange.join(', ')}`);
  }
  if (feedback?.length) {
    parts.push('', `CODE REVIEW FEEDBACK to address:`, feedback.join('\n'));
  }
  if (testFeedback?.length) {
    parts.push('', `TEST FAILURES to fix:`, testFeedback.join('\n'));
  }
  parts.push(
    '',
    `When you finish, end your response with a single line: "SUMMARY: <one-line description of the change>".`,
  );
  return parts.join('\n');
}

function extractSummary(outputTail: string): string {
  const lines = outputTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^SUMMARY:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return outputTail.slice(-500).trim();
}

const TELEMETRY_BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

async function recordOpencodeCall(row: {
  runId: string; agentId: string; providerId: string; model: string;
  promptTokens: number; completionTokens: number; costUsd: number;
  durationMs: number; startedAt: number; completedAt: number;
}): Promise<void> {
  try {
    await fetch(`${TELEMETRY_BACKEND}/api/agent/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: row.runId,
        agentId: row.agentId,
        providerId: row.providerId,
        model: row.model,
        kind: 'opencode',
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        costUsd: row.costUsd,
        durationMs: row.durationMs,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        error: null,
      }),
    });
  } catch { /* telemetry failure is never fatal */ }
}

export async function runOpenCodeAgent(input: OpenCodeRunInput): Promise<OpenCodeRunOutput> {
  const { worktreePath, primaryProvider, developerPersona, runId, agentId } = input;

  // Snapshot HEAD before opencode runs so the diff is correct whether or not
  // opencode commits as part of its workflow.
  const baseSha = await snapshotHead(worktreePath);

  // The per-run serve already wrote opencode.json + .opencode/agent/* during
  // bootstrap. We re-write opencode.json here only as a safety net for the
  // standalone-worker dev path — it's a no-op overwrite when the serve
  // bootstrap already produced the same shape.
  await writeOpencodeConfig(worktreePath, primaryProvider);
  await writeAgentsRules(worktreePath, developerPersona);

  const taskPrompt = buildTaskPrompt(input);

  const startedAt = Date.now();
  const result = await sendDeveloperPrompt({
    runId,
    persona: 'developer',
    prompt: taskPrompt,
    model: primaryProvider.selectedModel ? `primary/${primaryProvider.selectedModel}` : undefined,
  });
  const completedAt = Date.now();

  await recordOpencodeCall({
    runId,
    agentId,
    providerId: primaryProvider.id,
    model: primaryProvider.selectedModel ?? '',
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costUsd: result.costUsd,
    durationMs: completedAt - startedAt,
    startedAt,
    completedAt,
  });

  const filesChanged = await diffFilesSince(worktreePath, baseSha);
  const outputTail = result.text;
  const summary = extractSummary(outputTail);

  return { summary, filesChanged, exitCode: 0, outputTail };
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `cd worker && bun build src/worker.ts --target=bun --outfile=/tmp/worker-check.js`

Expected: build succeeds.

If type errors fire on `result.usage?.inputTokens`, adjust the property names in `sendDeveloperPrompt` (Task 6) to match the SDK's actual response shape — keep the `ServeMessageOutput` interface as the contract.

- [ ] **Step 3: Run the worker tests**

Run: `cd worker && bun test`

Expected: existing tests pass plus the `featureFlags.test.ts` from Task 3.

- [ ] **Step 4: Manual integration test**

With useOpencode flag on, start an autopilot run against a small sandbox repo. While it runs (or just after a ticket completes):

```bash
# Watch agent_calls for developer rows
sqlite3 ~/.atelier/atelier.db \
  "SELECT agent_id, prompt_tokens, completion_tokens, cost_usd FROM agent_calls WHERE run_id = '<runId>' ORDER BY started_at DESC LIMIT 10"
```

Expected: at least one row with `agent_id = 'developer'` and non-zero token counts.

If `prompt_tokens` is always zero, the SDK isn't returning usage in the shape `opencodeServeClient` expects — log `result` in `sendDeveloperPrompt` and adjust the field lookups.

- [ ] **Step 5: Commit**

```bash
git add worker/src/llm/opencodeAgent.ts
git commit -m "feat(worker): route developer through opencode serve SDK with telemetry"
```

---

## Task 8: Verify telemetry surfaces in the cost panel

**Files:** None (verification only).

- [ ] **Step 1: Run a full autopilot to completion**

Pick a small but realistic repo (50–500 LOC, has tests, uses Node or Python). Toggle useOpencode on. Run autopilot.

- [ ] **Step 2: Confirm the cost-by-agent panel shows developer rows**

```bash
curl -s http://localhost:3001/api/runs/<runId>/cost | jq .
```

Expected: `byAgent` array contains a `developer` entry with `total_tokens > 0` and `total_cost_usd >= 0`.

- [ ] **Step 3: Confirm aggregate totals reflect developer spend**

```bash
sqlite3 ~/.atelier/atelier.db \
  "SELECT total_tokens, total_cost_usd FROM workflow_runs WHERE id = '<runId>'"
```

Expected: `total_tokens` includes the developer's contribution. Compare against the same run with useOpencode toggled off (run a separate run for parity); the with-opencode run should report at minimum the planning agents' tokens PLUS the developer's tokens.

- [ ] **Step 4: If usage is zero or missing**

Most likely causes, in order:

1. SDK response shape differs — log `result` in `sendDeveloperPrompt` (Task 6) and adjust the `inputTokens` / `outputTokens` field names.
2. `recordOpencodeCall` is failing silently — temporarily add `console.error` in its catch block to surface the error.
3. The session is being created fresh per turn instead of cached — verify the backend's run registry returns the same `sessionId` across the multiple turns within a single ticket (review feedback loop, test feedback loop). The registry caches per-persona sessions, so this should be automatic.

No commit for this task — it's verification.

---

## Task 9: Update integration documentation

**Files:**
- Modify: `docs/opencode-integration.md`

- [ ] **Step 1: Update the "Enable" section**

Replace the existing "Enable" section (currently around lines 21–26) with:

```markdown
## Enable

Open Settings (gear icon in the sidebar) and toggle "Use opencode for the developer agent". The setting persists across restarts.

For headless / standalone-worker development, set `ATELIER_USE_OPENCODE=1` in the worker's environment as a fallback. The worker resolves the flag from the backend first; if the backend is unreachable, it consults the env var.
```

- [ ] **Step 2: Update the "Tradeoffs" section**

Find the bullet starting "Telemetry under-reports the implementer." Replace it with:

```markdown
- **Telemetry now forwards developer usage.** When the developer runs through the per-run `opencode serve`, the SDK returns input/output token counts on each turn. Those rows land in `agent_calls` with `kind = 'opencode'` and the `developer` agent id, so the cost-by-agent panel reflects developer spend. The SDK's `costUsd` is recorded as-is when present; when it's zero (some providers don't report cost), the run will show `total_cost_usd = 0` for the developer rows but `total_tokens` is still accurate.
```

Find the bullet starting "Best-of-N is disabled under opencode." Leave it unchanged — that's still true and is the next plan's work.

- [ ] **Step 3: Update the architectural note at the top**

Find the paragraph that mentions "the worker probes `opencode --version` at boot." Add a sentence after it:

```markdown
The autopilot workflow now starts a per-run `opencode serve` subprocess at the top of each run when the toggle is on (managed by `backend/src/opencode/lifecycle.ts`), and the developer activity sends prompts to the run's session via `@opencode-ai/sdk`. The serve subprocess is stopped in the workflow's `finally` block on every exit path.
```

- [ ] **Step 4: Commit**

```bash
git add docs/opencode-integration.md
git commit -m "docs: update opencode integration for UI toggle and telemetry"
```

---

## Self-Review Notes

Spec coverage: every task maps back to one of the three known gaps from the analysis (Tasks 1–4: UI toggle replacing env var; Tasks 5–8: telemetry forwarding via per-run serve; Task 9: docs). Best-of-N sub-worktrees are explicitly out of scope.

Type consistency: `useOpencode()` returns `Promise<boolean>` everywhere. `ServeMessageOutput` declares the shape `runOpenCodeAgent` consumes. The `app_settings` KV stores strings only (`'true'` / `'false'`); `appSettings.getBool` is the typed reader. `OpenCodeRunInput` keeps the `apiKey` field for signature compatibility even though the SDK path doesn't use it directly.

Open risk: the exact `@opencode-ai/sdk` API surface is documented inline in Task 6 with a NOTE callout. If the installed version differs, adjust the SDK calls but keep `sendDeveloperPrompt`'s public signature so Task 7 doesn't need changes.

End state: with all 9 tasks merged, toggling "Use opencode" in Settings flips the developer activity over to a per-run opencode serve, the developer's tokens appear in `agent_calls`, the per-run subprocess is cleaned up in every workflow exit path, and the docs reflect the new state. The legacy `callLLM` + `BEGIN FILE` path is preserved unchanged for users who keep the toggle off.
