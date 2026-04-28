# Routing Atelier Agents Through opencode — Implementation Plan

> **STATUS (2026-04-26): SUPERSEDED.** Tasks 1–7 (per-run-serve infrastructure: `bun test` wiring, `Persona` type + tools matrix, bootstrap, registry, lifecycle, sessions, arbiter persona) shipped on `develop` and stand. **Tasks 8–23 are abandoned** and replaced by `2026-04-26-opencode-runtime-toggle-and-telemetry.md`, which layers on top of the existing activity layer instead of tearing it out. Do not execute Tasks 8–23 below — they were written before `withJsonRetry`, the 4-specialist `reviewCodePanel`, `architect-judge` best-of-3, `implementCodeBestOfN`, and the per-call `agent_calls` telemetry pipeline existed, and running them would regress that work.
>
> **Spec deviations discovered during Task 5** (encoded in committed code, not yet propagated to the spec doc):
> - opencode HTTP API uses **HTTP Basic auth** (`Basic base64("opencode:<password>")`), not Bearer.
> - `opencode serve` has **no `--cwd` flag** — set cwd via Node `spawn` options.
> - `--port 0` always returns **4096** (no ephemeral port assignment); concurrent runs would collide on EADDRINUSE.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct MiniMax HTTP and the dormant `claude -p` PTY path with a per-run `opencode serve` plus per-persona session model, so every agent in the Terminal Grid actually runs inside an opencode session with scoped tool access.

**Architecture:** At run start the backend bootstraps `<worktree>/opencode.json` and `<worktree>/.opencode/agent/*.md`, then spawns one `opencode serve` per run. Worker activities call a backend HTTP endpoint that lazily creates a per-persona opencode session and spawns a thin `opencode run --attach` PTY whose output is rendered by the existing xterm pipeline. Planning agents write structured JSON to `<worktree>/.atelier/output/<persona>.json`; code-touching agents mutate the worktree directly.

**Tech Stack:** Bun runtime + TypeScript, node-pty (existing), `bun test` for tests, opencode 1.14+ (already installed at `/usr/bin/opencode`), Temporal TS SDK (existing), keytar (existing).

**Spec:** `docs/superpowers/specs/2026-04-25-opencode-agent-terminal-routing-design.md`

---

## File map

**New (backend):**
- `backend/src/opencode/personas.ts` — `Persona` type and `PERSONA_TOOLS` matrix
- `backend/src/opencode/bootstrap.ts` — write `opencode.json` + materialize `.opencode/agent/*.md`
- `backend/src/opencode/lifecycle.ts` — start/stop/health-check `opencode serve` per run
- `backend/src/opencode/sessions.ts` — per-run session registry (lazy create via opencode HTTP)
- `backend/src/opencode/run-registry.ts` — `runId → { worktreePath, port, password, sessions }` map (shared by lifecycle + sessions + IPC)
- `backend/test/opencode/bootstrap.test.ts`
- `backend/test/opencode/sessions.test.ts`
- `backend/test/opencode/lifecycle.test.ts` (integration; needs `opencode` on PATH)

**New (worker):**
- `worker/src/opencode-client.ts` — `runOpencodeAgent` + `readStructuredOutput` helpers
- `worker/src/.atelier/agents/arbiter.md` — new persona for the debate arbiter

**Modified (backend):**
- `backend/src/ipc-handlers.ts` — add `opencode.startServer`, `opencode.stopServer`, `opencode.serverStatus`, `opencode.runAgent`; remove `pty.spawnAgent`
- `backend/src/index.ts` — add `POST /api/opencode/runAgent`, `GET /api/opencode/agent/:ptyId/exit`; remove `POST /api/pty/spawn`, `GET /api/agent/:agentId/status` (no longer needed)
- `backend/package.json` — add `bun test` dev dep wiring (none needed; `bun test` is built in) and a `test` script

**Modified (worker):**
- `worker/src/activities.ts` — every persona activity replaces `callMiniMax(...)` with `runOpencodeAgent(...)`; `callMiniMax`, `runTerminalAgentViaPty`, `spawnAgent`, `loadPersona` are removed; activity input interfaces gain `runId`; `Implementation.code` field removed
- `worker/src/workflows/autopilot.workflow.ts` — pass `runId` to every activity call; `implementation.code = ...` lines removed; finally-block calls backend stop endpoint
- `worker/src/workflows/greenfield.workflow.ts` — same updates
- `worker/package.json` — add `test` script

**Removed:** `pty.spawnAgent` IPC handler, `runTerminalAgentViaPty`, `callMiniMax`, `loadPersona`, `spawnAgent` (worker), the `POST /api/pty/spawn` endpoint, the `GET /api/agent/:agentId/status` endpoint.

---

## Task 1: Wire `bun test` in backend and worker packages

**Files:**
- Modify: `backend/package.json`
- Modify: `worker/package.json`

- [ ] **Step 1: Add test script to backend**

Edit `backend/package.json`, in the `scripts` block:

```json
"scripts": {
  "dev": "bun run --watch src/index.ts",
  "start": "bun run src/index.ts",
  "test": "bun test"
}
```

- [ ] **Step 2: Add test script to worker**

Edit `worker/package.json`, in the `scripts` block:

```json
"scripts": {
  "start": "bun run src/worker.ts",
  "test": "bun test"
}
```

- [ ] **Step 3: Verify `bun test` resolves**

Run: `cd backend && bun test --bail` and `cd worker && bun test --bail`
Expected: both print `0 pass, 0 fail` (no test files yet) and exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json worker/package.json
git commit -m "chore: add bun test scripts to backend and worker"
```

---

## Task 2: Create the `Persona` type and tools matrix

**Files:**
- Create: `backend/src/opencode/personas.ts`
- Create: `backend/test/opencode/personas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/opencode/personas.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { ALL_PERSONAS, PERSONA_TOOLS } from '../../src/opencode/personas.js';

test('PERSONA_TOOLS covers every persona in ALL_PERSONAS', () => {
  for (const p of ALL_PERSONAS) {
    expect(PERSONA_TOOLS[p]).toBeDefined();
    expect(PERSONA_TOOLS[p].read).toBe(true);
    expect(PERSONA_TOOLS[p].write).toBe(true);
  }
});

test('only the developer can edit existing files', () => {
  for (const p of ALL_PERSONAS) {
    const expected = p === 'developer';
    expect(PERSONA_TOOLS[p].edit).toBe(expected);
  }
});

test('only architect, developer, tester, pusher can run bash', () => {
  const bashAllowed = new Set(['architect', 'developer', 'tester', 'pusher']);
  for (const p of ALL_PERSONAS) {
    expect(PERSONA_TOOLS[p].bash).toBe(bashAllowed.has(p));
  }
});

test('only researcher and debate-* can use webfetch', () => {
  const webfetchAllowed = new Set(['researcher', 'debate-signal', 'debate-noise']);
  for (const p of ALL_PERSONAS) {
    expect(PERSONA_TOOLS[p].webfetch).toBe(webfetchAllowed.has(p));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test test/opencode/personas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement personas.ts**

Create `backend/src/opencode/personas.ts`:

```ts
export type Persona =
  | 'researcher'
  | 'debate-signal'
  | 'debate-noise'
  | 'arbiter'
  | 'ticket-bot'
  | 'architect'
  | 'developer'
  | 'code-reviewer'
  | 'tester'
  | 'pusher';

export const ALL_PERSONAS: Persona[] = [
  'researcher',
  'debate-signal',
  'debate-noise',
  'arbiter',
  'ticket-bot',
  'architect',
  'developer',
  'code-reviewer',
  'tester',
  'pusher',
];

export interface PersonaTools {
  read: boolean;
  write: boolean;
  edit: boolean;
  bash: boolean;
  webfetch: boolean;
}

export const PERSONA_TOOLS: Record<Persona, PersonaTools> = {
  researcher:      { read: true, write: true, edit: false, bash: false, webfetch: true  },
  'debate-signal': { read: true, write: true, edit: false, bash: false, webfetch: true  },
  'debate-noise':  { read: true, write: true, edit: false, bash: false, webfetch: true  },
  arbiter:         { read: true, write: true, edit: false, bash: false, webfetch: false },
  'ticket-bot':    { read: true, write: true, edit: false, bash: false, webfetch: false },
  architect:       { read: true, write: true, edit: false, bash: true,  webfetch: false },
  developer:       { read: true, write: true, edit: true,  bash: true,  webfetch: false },
  'code-reviewer': { read: true, write: true, edit: false, bash: false, webfetch: false },
  tester:          { read: true, write: true, edit: false, bash: true,  webfetch: false },
  pusher:          { read: true, write: true, edit: false, bash: true,  webfetch: false },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && bun test test/opencode/personas.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/opencode/personas.ts backend/test/opencode/personas.test.ts
git commit -m "feat(backend): add Persona type and PERSONA_TOOLS matrix"
```

---

## Task 3: Implement `opencode-bootstrap`

**Files:**
- Create: `backend/src/opencode/bootstrap.ts`
- Create: `backend/test/opencode/bootstrap.test.ts`
- Reference (read only): `worker/src/.atelier/agents/*.md`

**Background note:** The personas live today in `worker/src/.atelier/agents/`. The bootstrap copies them into `<worktree>/.opencode/agent/<persona>.md` with frontmatter. The `arbiter.md` body file is created in Task 9; for now this task assumes all 10 source files exist (Task 9 supplies the missing one). Tests use a temporary fixture directory so this is not blocking.

- [ ] **Step 1: Write the failing test**

Create `backend/test/opencode/bootstrap.test.ts`:

```ts
import { test, expect, beforeEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bootstrapWorktree } from '../../src/opencode/bootstrap.js';
import { ALL_PERSONAS } from '../../src/opencode/personas.js';

let tmp: string;
let personasSrc: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-bootstrap-'));
  personasSrc = path.join(tmp, '_src_personas');
  fs.mkdirSync(personasSrc, { recursive: true });
  for (const p of ALL_PERSONAS) {
    fs.writeFileSync(path.join(personasSrc, `${p}.md`), `# ${p}\n\nbody for ${p}\n`);
  }
});

test('writes opencode.json with provider and permission blocks', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const cfg = JSON.parse(fs.readFileSync(path.join(wt, 'opencode.json'), 'utf-8'));
  expect(cfg.provider.minimax.options.apiKey).toBe('sk-test');
  expect(cfg.permission.edit).toBe('allow');
  expect(cfg.permission.bash).toBe('allow');
  expect(cfg.permission.webfetch).toBe('allow');
});

test('materializes one .opencode/agent/<persona>.md per persona with frontmatter', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  for (const p of ALL_PERSONAS) {
    const file = path.join(wt, '.opencode', 'agent', `${p}.md`);
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('description:');
    expect(content).toContain('model: minimax/abab6.5s-chat');
    expect(content).toContain(`body for ${p}`);
  }
});

test('developer agent has edit and bash; researcher does not', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const dev = fs.readFileSync(path.join(wt, '.opencode', 'agent', 'developer.md'), 'utf-8');
  expect(dev).toMatch(/edit:\s*true/);
  expect(dev).toMatch(/bash:\s*true/);
  const res = fs.readFileSync(path.join(wt, '.opencode', 'agent', 'researcher.md'), 'utf-8');
  expect(res).toMatch(/edit:\s*false/);
  expect(res).toMatch(/bash:\s*false/);
});

test('is idempotent (second call does not throw and matches first)', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const first = fs.readFileSync(path.join(wt, 'opencode.json'), 'utf-8');
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const second = fs.readFileSync(path.join(wt, 'opencode.json'), 'utf-8');
  expect(second).toBe(first);
});

test('creates .atelier/output directory for structured agent outputs', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  expect(fs.existsSync(path.join(wt, '.atelier', 'output'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test test/opencode/bootstrap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bootstrap.ts**

Create `backend/src/opencode/bootstrap.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { ALL_PERSONAS, PERSONA_TOOLS, type Persona } from './personas.js';

export interface BootstrapOptions {
  worktreePath: string;
  miniMaxApiKey: string;
  /** Source directory containing <persona>.md body files. Defaults to the bundled worker personas. */
  personasSourceDir?: string;
}

const DEFAULT_PERSONAS_DIR = path.resolve(import.meta.dir, '..', '..', '..', 'worker', 'src', '.atelier', 'agents');
const MODEL_ID = 'minimax/abab6.5s-chat';

const PERSONA_DESCRIPTIONS: Record<Persona, string> = {
  researcher:      'Reads the project and reports structure, features, gaps, and opportunities',
  'debate-signal': 'Argues FOR each candidate feature, finding genuine value',
  'debate-noise':  'Argues AGAINST each candidate feature, finding noise and overreach',
  arbiter:         'Reconciles signal and noise debate output into approved/rejected feature lists',
  'ticket-bot':    'Generates structured tickets with acceptance criteria from approved features',
  architect:       'Scopes tickets into technical plans with file-level precision',
  developer:       'Implements code in the worktree to satisfy a scoped ticket',
  'code-reviewer': 'Reviews implementation against acceptance criteria; never writes code',
  tester:          'Writes and runs tests verifying each acceptance criterion',
  pusher:          'Creates a branch, commits all changes, pushes, and reports the result',
};

export async function bootstrapWorktree(opts: BootstrapOptions): Promise<void> {
  const sourceDir = opts.personasSourceDir ?? DEFAULT_PERSONAS_DIR;

  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: { minimax: { options: { apiKey: opts.miniMaxApiKey } } },
    permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
  };
  fs.writeFileSync(path.join(opts.worktreePath, 'opencode.json'), JSON.stringify(config, null, 2));

  const agentDir = path.join(opts.worktreePath, '.opencode', 'agent');
  fs.mkdirSync(agentDir, { recursive: true });

  for (const persona of ALL_PERSONAS) {
    const sourceFile = path.join(sourceDir, `${persona}.md`);
    const body = fs.readFileSync(sourceFile, 'utf-8');
    const tools = PERSONA_TOOLS[persona];
    const frontmatter = [
      '---',
      `description: ${PERSONA_DESCRIPTIONS[persona]}`,
      `model: ${MODEL_ID}`,
      'tools:',
      `  read: ${tools.read}`,
      `  write: ${tools.write}`,
      `  edit: ${tools.edit}`,
      `  bash: ${tools.bash}`,
      `  webfetch: ${tools.webfetch}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(agentDir, `${persona}.md`), frontmatter + body);
  }

  fs.mkdirSync(path.join(opts.worktreePath, '.atelier', 'output'), { recursive: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && bun test test/opencode/bootstrap.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/opencode/bootstrap.ts backend/test/opencode/bootstrap.test.ts
git commit -m "feat(backend): bootstrap opencode.json and per-persona agent files"
```

---

## Task 4: Create per-run registry

**Files:**
- Create: `backend/src/opencode/run-registry.ts`
- Create: `backend/test/opencode/run-registry.test.ts`

This is a tiny in-memory shared map. Lifecycle, sessions, and IPC handlers all read from it.

- [ ] **Step 1: Write the failing test**

Create `backend/test/opencode/run-registry.test.ts`:

```ts
import { test, expect, beforeEach } from 'bun:test';
import { runRegistry } from '../../src/opencode/run-registry.js';

beforeEach(() => runRegistry.clearAll());

test('register / get / unregister', () => {
  runRegistry.register('run-1', { worktreePath: '/wt/1', port: 4096, password: 'pw', pid: 123 });
  expect(runRegistry.get('run-1')?.port).toBe(4096);
  expect(runRegistry.get('run-1')?.sessions.size).toBe(0);
  runRegistry.unregister('run-1');
  expect(runRegistry.get('run-1')).toBeNull();
});

test('attachSession stores per-persona sessionId', () => {
  runRegistry.register('run-1', { worktreePath: '/wt/1', port: 4096, password: 'pw', pid: 123 });
  runRegistry.attachSession('run-1', 'researcher', 'sess-abc');
  expect(runRegistry.get('run-1')?.sessions.get('researcher')).toBe('sess-abc');
});

test('clearAll wipes everything', () => {
  runRegistry.register('a', { worktreePath: '/a', port: 1, password: 'p', pid: 1 });
  runRegistry.register('b', { worktreePath: '/b', port: 2, password: 'p', pid: 2 });
  runRegistry.clearAll();
  expect(runRegistry.get('a')).toBeNull();
  expect(runRegistry.get('b')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test test/opencode/run-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement run-registry.ts**

Create `backend/src/opencode/run-registry.ts`:

```ts
import type { Persona } from './personas.js';

export interface RunEntry {
  worktreePath: string;
  port: number;
  password: string;
  pid: number;
  sessions: Map<Persona, string>;
}

class RunRegistry {
  private map = new Map<string, RunEntry>();

  register(runId: string, info: Omit<RunEntry, 'sessions'>): void {
    this.map.set(runId, { ...info, sessions: new Map() });
  }

  get(runId: string): RunEntry | null {
    return this.map.get(runId) ?? null;
  }

  unregister(runId: string): void {
    this.map.delete(runId);
  }

  attachSession(runId: string, persona: Persona, sessionId: string): void {
    const entry = this.map.get(runId);
    if (!entry) throw new Error(`No run registered for ${runId}`);
    entry.sessions.set(persona, sessionId);
  }

  clearAll(): void {
    this.map.clear();
  }
}

export const runRegistry = new RunRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && bun test test/opencode/run-registry.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/opencode/run-registry.ts backend/test/opencode/run-registry.test.ts
git commit -m "feat(backend): add per-run opencode registry"
```

---

## Task 5: Implement `opencode-lifecycle`

**Files:**
- Create: `backend/src/opencode/lifecycle.ts`
- Create: `backend/test/opencode/lifecycle.test.ts`

Integration test — requires `opencode` on PATH. Skip in CI without it.

- [ ] **Step 1: Verify the opencode CLI is on PATH**

Run: `which opencode && opencode --version`
Expected: prints the binary path and version `1.14.x` or higher. If not, install opencode before continuing.

- [ ] **Step 2: Verify the format of `opencode serve`'s startup line**

Run: `opencode serve --port 0 --hostname 127.0.0.1 --cwd /tmp` in one terminal; note the exact stdout line that announces the assigned port (e.g. `opencode server running at http://127.0.0.1:NNNN`). Kill it with Ctrl-C.

This determines the regex used in the lifecycle module. If the format differs from the assumed `opencode server (?:running|listening) (?:at|on) http://127\.0\.0\.1:(\d+)`, adjust the implementation in Step 4.

- [ ] **Step 3: Write the failing test**

Create `backend/test/opencode/lifecycle.test.ts`:

```ts
import { test, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startOpencodeServer, stopOpencodeServer, getOpencodeServer } from '../../src/opencode/lifecycle.js';
import { bootstrapWorktree } from '../../src/opencode/bootstrap.js';
import { ALL_PERSONAS } from '../../src/opencode/personas.js';
import { runRegistry } from '../../src/opencode/run-registry.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-lifecycle-'));

afterAll(async () => {
  for (const id of ['run-life-1']) {
    try { await stopOpencodeServer(id); } catch {}
  }
  runRegistry.clearAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('startOpencodeServer spawns serve and exposes a healthy port', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  const personasSrc = path.join(tmp, 'personas');
  fs.mkdirSync(personasSrc, { recursive: true });
  for (const p of ALL_PERSONAS) fs.writeFileSync(path.join(personasSrc, `${p}.md`), `# ${p}\n`);
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'unused', personasSourceDir: personasSrc });

  const { port, password } = await startOpencodeServer('run-life-1', wt);
  expect(port).toBeGreaterThan(0);
  expect(password.length).toBeGreaterThanOrEqual(32);

  const res = await fetch(`http://127.0.0.1:${port}/app`, {
    headers: { Authorization: `Bearer ${password}` },
  });
  expect(res.status).toBe(200);
});

test('getOpencodeServer returns the registered entry', () => {
  const entry = getOpencodeServer('run-life-1');
  expect(entry).not.toBeNull();
  expect(entry!.port).toBeGreaterThan(0);
});

test('stopOpencodeServer kills the process and clears the registry', async () => {
  const before = getOpencodeServer('run-life-1')!;
  await stopOpencodeServer('run-life-1');
  expect(getOpencodeServer('run-life-1')).toBeNull();
  // The serve process should refuse new connections within ~1s
  await new Promise(r => setTimeout(r, 1000));
  let stillUp = false;
  try {
    const res = await fetch(`http://127.0.0.1:${before.port}/app`, {
      headers: { Authorization: `Bearer ${before.password}` },
    });
    stillUp = res.ok;
  } catch { /* expected: connection refused */ }
  expect(stillUp).toBe(false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && bun test test/opencode/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement lifecycle.ts**

Create `backend/src/opencode/lifecycle.ts`:

```ts
import { spawn, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { runRegistry, type RunEntry } from './run-registry.js';

const STARTUP_TIMEOUT_MS = 15_000;
const PORT_REGEX = /https?:\/\/127\.0\.0\.1:(\d+)/;
const processes = new Map<string, ChildProcess>();

export async function startOpencodeServer(
  runId: string,
  worktreePath: string,
): Promise<{ port: number; password: string }> {
  if (runRegistry.get(runId)) {
    throw new Error(`opencode server already running for ${runId}`);
  }
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(
    'opencode',
    ['serve', '--port', '0', '--hostname', '127.0.0.1', '--cwd', worktreePath],
    {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  processes.set(runId, child);

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('opencode serve startup timeout'));
    }, STARTUP_TIMEOUT_MS);
    let buf = '';
    const onLine = (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(PORT_REGEX);
      if (match) {
        clearTimeout(timer);
        child.stdout?.off('data', onLine);
        child.stderr?.off('data', onLine);
        resolve(parseInt(match[1], 10));
      }
    };
    child.stdout?.on('data', onLine);
    child.stderr?.on('data', onLine);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`opencode serve exited with code ${code} before startup`));
    });
  });

  await waitForHealth(port, password);
  runRegistry.register(runId, { worktreePath, port, password, pid: child.pid! });

  child.on('exit', () => {
    processes.delete(runId);
    runRegistry.unregister(runId);
  });

  return { port, password };
}

export async function stopOpencodeServer(runId: string): Promise<void> {
  const child = processes.get(runId);
  if (child) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
    processes.delete(runId);
  }
  runRegistry.unregister(runId);
}

export function getOpencodeServer(runId: string): RunEntry | null {
  return runRegistry.get(runId);
}

async function waitForHealth(port: number, password: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/app`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('opencode serve did not become healthy in time');
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && bun test test/opencode/lifecycle.test.ts`
Expected: 3 pass. If the port-detection regex doesn't match the actual stdout from Step 2, fix `PORT_REGEX` and re-run.

- [ ] **Step 7: Commit**

```bash
git add backend/src/opencode/lifecycle.ts backend/test/opencode/lifecycle.test.ts
git commit -m "feat(backend): per-run opencode serve lifecycle"
```

---

## Task 6: Implement `opencode-sessions`

**Files:**
- Create: `backend/src/opencode/sessions.ts`
- Create: `backend/test/opencode/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/opencode/sessions.test.ts`:

```ts
import { test, expect, beforeEach, mock } from 'bun:test';
import { ensureSession } from '../../src/opencode/sessions.js';
import { runRegistry } from '../../src/opencode/run-registry.js';

beforeEach(() => {
  runRegistry.clearAll();
  runRegistry.register('run-s', { worktreePath: '/wt', port: 4096, password: 'pw', pid: 1 });
});

test('ensureSession creates a session on first call and caches the id', async () => {
  let calls = 0;
  const fetchMock = mock(async (_url: string, _init?: RequestInit) => {
    calls++;
    return new Response(JSON.stringify({ id: 'sess-123' }), { status: 200 });
  });
  // @ts-ignore — replace global fetch for this test
  globalThis.fetch = fetchMock;

  const a = await ensureSession('run-s', 'researcher');
  const b = await ensureSession('run-s', 'researcher');
  expect(a.sessionId).toBe('sess-123');
  expect(b.sessionId).toBe('sess-123');
  expect(calls).toBe(1);
});

test('ensureSession throws if no run is registered', async () => {
  await expect(ensureSession('does-not-exist', 'researcher')).rejects.toThrow(/No run registered/);
});

test('ensureSession passes Authorization and the persona as agent', async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  // @ts-ignore
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ id: 'sess-x' }), { status: 200 });
  });

  await ensureSession('run-s', 'developer');
  expect(captured!.url).toBe('http://127.0.0.1:4096/session');
  expect((captured!.init!.headers as any).Authorization).toBe('Bearer pw');
  const body = JSON.parse(captured!.init!.body as string);
  expect(body.title).toBe('developer');
  expect(body.agentName).toBe('developer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test test/opencode/sessions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sessions.ts**

Create `backend/src/opencode/sessions.ts`:

```ts
import { runRegistry } from './run-registry.js';
import type { Persona } from './personas.js';

export interface EnsureSessionResult { sessionId: string; }

export async function ensureSession(runId: string, persona: Persona): Promise<EnsureSessionResult> {
  const entry = runRegistry.get(runId);
  if (!entry) throw new Error(`No run registered for ${runId}`);

  const cached = entry.sessions.get(persona);
  if (cached) return { sessionId: cached };

  const res = await fetch(`http://127.0.0.1:${entry.port}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${entry.password}`,
    },
    body: JSON.stringify({ title: persona, agentName: persona }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`opencode session create failed (${res.status}): ${text}`);
  }
  const { id } = (await res.json()) as { id: string };
  runRegistry.attachSession(runId, persona, id);
  return { sessionId: id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && bun test test/opencode/sessions.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/opencode/sessions.ts backend/test/opencode/sessions.test.ts
git commit -m "feat(backend): per-run opencode session registry"
```

---

## Task 7: Add the `arbiter` persona body file

**Files:**
- Create: `worker/src/.atelier/agents/arbiter.md`

- [ ] **Step 1: Create the persona body**

Create `worker/src/.atelier/agents/arbiter.md`:

```markdown
# Arbiter

You are a pragmatic product manager. You are given two debate transcripts about a list of candidate features for a project — one transcript argues FOR each feature (signal), the other argues AGAINST (noise). Your job is to decide which features survive.

For each feature, weigh the strongest argument from each side. Approve features with genuine, scoped value. Reject features that are noise, scope creep, or premature. Be willing to reject popular-sounding ideas that lack grounding in the project's actual gaps.

Write your final answer as JSON to `.atelier/output/arbiter.json` using the Write tool. Do not print the JSON to chat. The schema is:

```json
{
  "approvedFeatures": [
    { "name": "string", "rationale": "string", "priority": "high" | "medium" | "low" }
  ],
  "rejectedFeatures": [
    { "name": "string", "reason": "string" }
  ]
}
```

Do not write any other files.
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/.atelier/agents/arbiter.md
git commit -m "feat(worker): add arbiter persona for debate reconciliation"
```

---

## Task 8: Add HTTP and IPC entry points for opencode in backend

**Files:**
- Modify: `backend/src/ipc-handlers.ts`
- Modify: `backend/src/index.ts`

This task wires the new modules into the WebSocket IPC and the HTTP bridge the worker uses. It does not yet remove the old `pty.spawnAgent` / `POST /api/pty/spawn` — that happens in Task 19.

- [ ] **Step 1: Add IPC handlers in `ipc-handlers.ts`**

Add the following imports near the top of `backend/src/ipc-handlers.ts`:

```ts
import { startOpencodeServer, stopOpencodeServer, getOpencodeServer } from './opencode/lifecycle.js';
import { ensureSession } from './opencode/sessions.js';
import { bootstrapWorktree } from './opencode/bootstrap.js';
import type { Persona } from './opencode/personas.js';
```

Append at the bottom of the file (after the existing `register('greenfield.start', ...)` block):

```ts
register('opencode.startServer', async (opts: { runId: string; worktreePath: string }) => {
  const apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey('minimax', 'apiKey'));
  if (!apiKey) throw new Error('MiniMax API key not configured. Add it in Settings.');
  await bootstrapWorktree({ worktreePath: opts.worktreePath, miniMaxApiKey: apiKey });
  return startOpencodeServer(opts.runId, opts.worktreePath);
});

register('opencode.stopServer', async (opts: { runId: string }) => {
  await stopOpencodeServer(opts.runId);
});

register('opencode.serverStatus', async (opts: { runId: string }) => {
  const entry = getOpencodeServer(opts.runId);
  return entry ? { running: true, port: entry.port } : { running: false };
});

register('opencode.runAgent', async (opts: {
  runId: string;
  persona: Persona;
  task: string;
  ptyId: string;
}) => {
  const entry = getOpencodeServer(opts.runId);
  if (!entry) throw new Error(`No opencode server for run ${opts.runId}`);
  const { sessionId } = await ensureSession(opts.runId, opts.persona);

  ptyManager.spawn('opencode', [
    'run',
    '--attach', `http://127.0.0.1:${entry.port}`,
    '--session', sessionId,
    '--agent', opts.persona,
    '--dangerously-skip-permissions',
    '--prompt', opts.task,
  ], entry.worktreePath, opts.ptyId, { OPENCODE_SERVER_PASSWORD: entry.password });

  return { ptyId: opts.ptyId, sessionId };
});
```

Note: this assumes `ptyManager.spawn` accepts `(command, args, cwd, id, env?)`. The current signature is `spawn(id, command, args, cwd?)`. **Update `pty-manager.ts` first** — see Step 2.

- [ ] **Step 2: Extend `ptyManager.spawn` to accept an env override**

Edit `backend/src/pty-manager.ts`. Change:

```ts
spawn(id: string, command: string, args: string[], cwd?: string): PtyInstance {
```

to:

```ts
spawn(id: string, command: string, args: string[], cwd?: string, envOverride?: Record<string, string>): PtyInstance {
```

And inside the function, change:

```ts
env: process.env as Record<string, string>,
```

to:

```ts
env: { ...(process.env as Record<string, string>), ...(envOverride ?? {}) },
```

Then change the IPC handler call from Step 1 to use the existing argument order:

```ts
ptyManager.spawn(opts.ptyId, 'opencode', [
  'run',
  '--attach', `http://127.0.0.1:${entry.port}`,
  '--session', sessionId,
  '--agent', opts.persona,
  '--dangerously-skip-permissions',
  '--prompt', opts.task,
], entry.worktreePath, { OPENCODE_SERVER_PASSWORD: entry.password });
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && bun build src/index.ts --outdir /tmp/atelier-build-check && rm -rf /tmp/atelier-build-check`
Expected: exit 0, no errors.

- [ ] **Step 4: Add the worker-facing HTTP endpoints in `backend/src/index.ts`**

Add the following imports near the top of `backend/src/index.ts`:

```ts
import { startOpencodeServer, stopOpencodeServer, getOpencodeServer } from './opencode/lifecycle.js';
import { ensureSession } from './opencode/sessions.js';
import { bootstrapWorktree } from './opencode/bootstrap.js';
import { runRegistry } from './opencode/run-registry.js';
import type { Persona } from './opencode/personas.js';
import keytar from 'keytar';
```

Inside the `httpServer = http.createServer(async (req, res) => { ... })` body, **before** the final `// Default: 404` block, add:

```ts
// POST /api/opencode/runAgent — spawn an opencode run PTY for a persona
if (req.method === 'POST' && url.pathname === '/api/opencode/runAgent') {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const { runId, persona, task, ptyId } = JSON.parse(body) as {
        runId: string; persona: Persona; task: string; ptyId: string;
      };
      const entry = getOpencodeServer(runId);
      if (!entry) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No opencode server for run ${runId}` }));
        return;
      }
      const { sessionId } = await ensureSession(runId, persona);
      ptyManager.spawn(ptyId, 'opencode', [
        'run',
        '--attach', `http://127.0.0.1:${entry.port}`,
        '--session', sessionId,
        '--agent', persona,
        '--dangerously-skip-permissions',
        '--prompt', task,
      ], entry.worktreePath, { OPENCODE_SERVER_PASSWORD: entry.password });

      // Broadcast agent start to the UI (re-uses existing broadcast)
      broadcastToUI('agent:started', { agentId: ptyId, agentName: persona, terminalType: 'terminal' });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ptyId, sessionId }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  return;
}

// GET /api/opencode/agent/:ptyId/exit — long-poll for the PTY exit code (resolves when the PTY ends)
if (req.method === 'GET' && url.pathname.startsWith('/api/opencode/agent/') && url.pathname.endsWith('/exit')) {
  const ptyId = url.pathname.split('/')[4];
  if (!ptyManager.isRunning(ptyId)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exitCode: 0, alreadyExited: true }));
    return;
  }
  ptyManager.onExit(ptyId, (exitCode, signal) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exitCode, signal }));
    broadcastToUI('agent:completed', { agentId: ptyId, status: exitCode === 0 ? 'completed' : 'error' });
  });
  return;
}

// POST /api/opencode/server — bootstrap the worktree and start the per-run server
if (req.method === 'POST' && url.pathname === '/api/opencode/server') {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const { runId, worktreePath } = JSON.parse(body) as { runId: string; worktreePath: string };
      const apiKey = await keytar.getPassword('Atelier', 'atelier.provider.minimax.apiKey');
      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MiniMax API key not configured' }));
        return;
      }
      await bootstrapWorktree({ worktreePath, miniMaxApiKey: apiKey });
      const result = await startOpencodeServer(runId, worktreePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  return;
}

// DELETE /api/opencode/server/:runId — stop the per-run server
if (req.method === 'DELETE' && url.pathname.startsWith('/api/opencode/server/')) {
  const runId = url.pathname.split('/')[4];
  try {
    await stopOpencodeServer(runId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stopped: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
  return;
}
```

- [ ] **Step 5: Verify backend still compiles**

Run: `cd backend && bun build src/index.ts --outdir /tmp/atelier-build-check && rm -rf /tmp/atelier-build-check`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/ipc-handlers.ts backend/src/index.ts backend/src/pty-manager.ts
git commit -m "feat(backend): wire opencode IPC handlers and HTTP endpoints"
```

---

## Task 9: Worker-side `opencode-client` helper

**Files:**
- Create: `worker/src/opencode-client.ts`
- Create: `worker/test/opencode-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/opencode-client.test.ts`:

```ts
import { test, expect, mock } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runOpencodeAgent, readStructuredOutput } from '../src/opencode-client.js';

test('runOpencodeAgent POSTs runAgent then long-polls /exit and returns exit code', async () => {
  let calls: string[] = [];
  // @ts-ignore
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/runAgent')) {
      return new Response(JSON.stringify({ ptyId: 'researcher', sessionId: 'sess-1' }), { status: 200 });
    }
    if (url.includes('/exit')) {
      return new Response(JSON.stringify({ exitCode: 0 }), { status: 200 });
    }
    throw new Error(`unexpected url: ${url}`);
  });

  const result = await runOpencodeAgent({
    runId: 'r1', persona: 'researcher', task: 'do thing',
  });
  expect(result.exitCode).toBe(0);
  expect(calls[0]).toMatch(/POST .*\/runAgent$/);
  expect(calls[1]).toMatch(/GET .*\/exit$/);
});

test('runOpencodeAgent throws on non-zero exit', async () => {
  // @ts-ignore
  globalThis.fetch = mock(async (url: string) =>
    url.endsWith('/runAgent')
      ? new Response(JSON.stringify({ ptyId: 'developer' }), { status: 200 })
      : new Response(JSON.stringify({ exitCode: 7 }), { status: 200 }));
  await expect(runOpencodeAgent({ runId: 'r1', persona: 'developer', task: 't' }))
    .rejects.toThrow(/exit code 7/);
});

test('readStructuredOutput parses JSON from .atelier/output/<persona>.json', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-out-'));
  fs.mkdirSync(path.join(tmp, '.atelier', 'output'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.atelier', 'output', 'researcher.json'), JSON.stringify({ ok: true }));
  const out = await readStructuredOutput<{ ok: boolean }>(tmp, 'researcher');
  expect(out.ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && bun test test/opencode-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement opencode-client.ts**

Create `worker/src/opencode-client.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

export type Persona =
  | 'researcher' | 'debate-signal' | 'debate-noise' | 'arbiter' | 'ticket-bot'
  | 'architect' | 'developer' | 'code-reviewer' | 'tester' | 'pusher';

const BACKEND_URL = process.env.ATELIER_BACKEND_URL ?? 'http://localhost:3001';

export interface RunAgentOptions {
  runId: string;
  persona: Persona;
  task: string;
  /** Defaults to the persona name. Use a unique id when running two parallel sessions of the same persona. */
  ptyId?: string;
}

export interface RunAgentResult {
  exitCode: number;
  ptyId: string;
  sessionId: string;
}

export async function runOpencodeAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const ptyId = opts.ptyId ?? opts.persona;
  const startRes = await fetch(`${BACKEND_URL}/api/opencode/runAgent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: opts.runId, persona: opts.persona, task: opts.task, ptyId }),
  });
  if (!startRes.ok) {
    throw new Error(`runAgent failed: ${await startRes.text()}`);
  }
  const { sessionId } = await startRes.json() as { sessionId: string };

  const exitRes = await fetch(`${BACKEND_URL}/api/opencode/agent/${ptyId}/exit`);
  if (!exitRes.ok) {
    throw new Error(`agent /exit failed: ${await exitRes.text()}`);
  }
  const { exitCode } = await exitRes.json() as { exitCode: number };
  if (exitCode !== 0) {
    throw new Error(`opencode run exited with exit code ${exitCode} (persona=${opts.persona}, runId=${opts.runId})`);
  }
  return { exitCode, ptyId, sessionId };
}

export async function readStructuredOutput<T>(worktreePath: string, persona: Persona): Promise<T> {
  const file = path.join(worktreePath, '.atelier', 'output', `${persona}.json`);
  const content = await fs.promises.readFile(file, 'utf-8');
  return JSON.parse(content) as T;
}

export async function readStructuredOutputOrFallback<T>(
  worktreePath: string,
  persona: Persona,
  fallback: T,
): Promise<T> {
  try {
    return await readStructuredOutput<T>(worktreePath, persona);
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && bun test test/opencode-client.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/opencode-client.ts worker/test/opencode-client.test.ts
git commit -m "feat(worker): add opencode-client helper for agent invocation"
```

---

## Task 10: Add `runId` to all activity input interfaces

**Files:**
- Modify: `worker/src/activities.ts`

This is a pure type change so we can pass `runId` to the activity bodies in the next tasks. Workflows are updated in Task 18.

- [ ] **Step 1: Edit each input interface**

In `worker/src/activities.ts`, add `runId: string;` to each of: `ResearchInput`, `DebateInput`, `TicketsInput`, `ScopeInput`, `ImplementInput`, `ReviewInput`, `TestInput`, `PushInput`.

Result, e.g.:

```ts
export interface ResearchInput {
  runId: string;
  projectPath: string;
  userContext?: Record<string, string>;
}

export interface DebateInput {
  runId: string;
  repoAnalysis: ResearchOutput;
  suggestedFeatures: string[];
}

export interface TicketsInput {
  runId: string;
  approvedFeatures: DebateOutput['approvedFeatures'];
}

export interface ScopeInput {
  runId: string;
  tickets: Ticket[];
  projectPath: string;
  worktreePath: string;
}

export interface ImplementInput {
  runId: string;
  ticket: ScopedTicket;
  worktreePath: string;
  projectPath: string;
  feedback?: string[];
  testFeedback?: string[];
}

export interface ReviewInput {
  runId: string;
  worktreePath: string;
  implementation: Implementation;
  ticket: ScopedTicket;
}

export interface TestInput {
  runId: string;
  worktreePath: string;
  implementation: Implementation;
  ticket: ScopedTicket;
}

export interface PushInput {
  runId: string;
  worktreePath: string;
  projectPath: string;
  tickets: ScopedTicket[];
}
```

(Note `ReviewInput` and `TestInput` also gain `worktreePath` because they need to read the per-persona output file.)

Also remove the `code: string` field from `Implementation` and from `ImplementOutput`:

```ts
export interface Implementation {
  ticketId: string;
  filesChanged: string[];
}

export interface ImplementOutput {
  filesChanged: string[];
}
```

- [ ] **Step 2: Verify worker compiles (will fail in workflows; expected — they're updated in Task 18)**

Run: `cd worker && bunx tsc --noEmit -p .` if a tsconfig exists, otherwise `cd worker && bun build src/worker.ts --outdir /tmp/check && rm -rf /tmp/check`.
Expected: errors only in `workflows/*.ts` referring to `implementation.code` and the new `runId` not being passed. These are fixed in Task 18. Do not commit yet.

- [ ] **Step 3: Stage but don't commit; the type changes ship together with Task 11–18**

```bash
git add -p worker/src/activities.ts   # only the interface edits
```

The full commit happens at the end of Task 18 once compilation is clean. Skip directly to Task 11.

---

## Task 11: Migrate `researchRepo` to opencode

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Replace the body**

In `worker/src/activities.ts`, replace the entire `researchRepo` function with:

```ts
export async function researchRepo(input: ResearchInput): Promise<ResearchOutput> {
  const { runId, projectPath, userContext = {} } = input;

  const userContextStr = Object.entries(userContext)
    .map(([k, v]) => `${k}: ${v}`).join('\n');

  const task = `
Project path: ${projectPath}

User context (from previous sessions):
${userContextStr || '(none)'}

Read README.md, package.json, and a representative sample of source files.

Identify:
1. What does this project do?
2. What are the current features?
3. What gaps or technical debt exists?
4. What opportunities for improvement?

Write your final answer as JSON to .atelier/output/researcher.json using the Write tool.
Do not print the JSON to chat. The schema is:
{
  "repoStructure": "string",
  "currentFeatures": ["string", ...],
  "gaps": ["string", ...],
  "opportunities": ["string", ...],
  "marketContext": "string"
}
Do not write any other files.
`.trim();

  await runOpencodeAgent({ runId, persona: 'researcher', task });

  // Worktree path == projectPath here (researcher reads original repo).
  return readStructuredOutputOrFallback<ResearchOutput>(projectPath, 'researcher', {
    repoStructure: '',
    currentFeatures: [],
    gaps: [],
    opportunities: [],
    marketContext: '',
  });
}
```

Add at the top of the file:

```ts
import { runOpencodeAgent, readStructuredOutputOrFallback } from './opencode-client.js';
```

(Existing `loadPersona` and `callMiniMax` references in this function are removed.)

- [ ] **Step 2: Verify the rest of the file still references valid symbols**

Other activities still call `callMiniMax` / `loadPersona` — leave them for now; they're migrated in Tasks 12–17.

No commit yet (per Task 10 plan).

---

## Task 12: Migrate `debateFeatures` to two parallel opencode sessions plus arbiter

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Replace the function**

Replace the entire `debateFeatures` function in `worker/src/activities.ts` with:

```ts
export async function debateFeatures(input: DebateInput): Promise<DebateOutput> {
  const { runId, repoAnalysis, suggestedFeatures } = input;
  const featuresToDebate = suggestedFeatures.length > 0
    ? suggestedFeatures
    : repoAnalysis.opportunities;

  const sharedContext = `
REPO ANALYSIS:
${JSON.stringify(repoAnalysis, null, 2)}

FEATURES TO DEBATE:
${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}
`.trim();

  const signalTask = `
You are arguing FOR each feature. ${sharedContext}

For each feature, write 1-3 sentences explaining its strongest possible value.
Write your final answer as JSON to .atelier/output/debate-signal.json using the Write tool.
Schema: { "perFeature": [{ "name": "string", "argumentFor": "string" }] }
Do not write any other files. Do not print the JSON to chat.
`.trim();

  const noiseTask = `
You are arguing AGAINST each feature (skeptical). ${sharedContext}

For each feature, write 1-3 sentences explaining why it is noise, scope creep, or premature.
Write your final answer as JSON to .atelier/output/debate-noise.json using the Write tool.
Schema: { "perFeature": [{ "name": "string", "argumentAgainst": "string" }] }
Do not write any other files. Do not print the JSON to chat.
`.trim();

  await Promise.all([
    runOpencodeAgent({ runId, persona: 'debate-signal', task: signalTask }),
    runOpencodeAgent({ runId, persona: 'debate-noise',  task: noiseTask  }),
  ]);

  const arbiterTask = `
You are reconciling two debate transcripts. They are stored at:
- .atelier/output/debate-signal.json
- .atelier/output/debate-noise.json

Read both files (use the Read tool), then decide which features to APPROVE and which to REJECT.
Write your final answer as JSON to .atelier/output/arbiter.json. Schema:
{
  "approvedFeatures": [{ "name": "string", "rationale": "string", "priority": "high"|"medium"|"low" }],
  "rejectedFeatures": [{ "name": "string", "reason": "string" }]
}
Do not write any other files. Do not print the JSON to chat.
`.trim();

  await runOpencodeAgent({ runId, persona: 'arbiter', task: arbiterTask });

  // Worktree path == cwd of activity == worktree configured in opencode serve.
  // Resolve from environment (worker has CWD set to worktree per spawn? No — read from input).
  // We do not have worktreePath in DebateInput. Use process.cwd() as a fallback.
  const worktreePath = process.env.ATELIER_RUN_WORKTREE ?? process.cwd();
  return readStructuredOutputOrFallback<DebateOutput>(worktreePath, 'arbiter', {
    approvedFeatures: featuresToDebate.slice(0, 3).map(f => ({
      name: f, rationale: 'Default approved (arbiter output unparseable)', priority: 'medium' as const,
    })),
    rejectedFeatures: [],
  });
}
```

- [ ] **Step 2: Add `worktreePath` to `DebateInput` so output reading is explicit**

In `worker/src/activities.ts`, change `DebateInput` to:

```ts
export interface DebateInput {
  runId: string;
  worktreePath: string;
  repoAnalysis: ResearchOutput;
  suggestedFeatures: string[];
}
```

And update the function:

```ts
export async function debateFeatures(input: DebateInput): Promise<DebateOutput> {
  const { runId, worktreePath, repoAnalysis, suggestedFeatures } = input;
  // ...
  return readStructuredOutputOrFallback<DebateOutput>(worktreePath, 'arbiter', { ... });
}
```

(Remove the `process.env.ATELIER_RUN_WORKTREE` and `process.cwd()` fallback.)

No commit yet.

---

## Task 13: Migrate `generateTickets`

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Add `worktreePath` to `TicketsInput`**

```ts
export interface TicketsInput {
  runId: string;
  worktreePath: string;
  approvedFeatures: DebateOutput['approvedFeatures'];
}
```

- [ ] **Step 2: Replace the function body**

Replace `generateTickets` with:

```ts
export async function generateTickets(input: TicketsInput): Promise<TicketsOutput> {
  const { runId, worktreePath, approvedFeatures } = input;

  if (approvedFeatures.length === 0) return { tickets: [] };

  const task = `
Approved features to ticket:
${approvedFeatures.map(f => `- ${f.name}: ${f.rationale} (priority: ${f.priority})`).join('\n')}

For each feature, generate one ticket with:
- id: TICKET-1, TICKET-2, etc.
- title: concise feature name
- description: 2-3 sentences (what and why)
- acceptanceCriteria: 3-5 specific, testable criteria
- estimate: T-shirt size (S/M/L/XL)

Write your final answer as JSON to .atelier/output/ticket-bot.json using the Write tool.
Schema: { "tickets": [{ "id": "string", "title": "string", "description": "string", "acceptanceCriteria": ["string"], "estimate": "S"|"M"|"L"|"XL" }] }
Do not write any other files. Do not print the JSON to chat.
`.trim();

  await runOpencodeAgent({ runId, persona: 'ticket-bot', task });

  return readStructuredOutputOrFallback<TicketsOutput>(worktreePath, 'ticket-bot', {
    tickets: approvedFeatures.map((f, i) => ({
      id: `TICKET-${i + 1}`,
      title: f.name,
      description: f.rationale,
      acceptanceCriteria: ['Implementation complete'],
      estimate: f.priority === 'high' ? 'L' : 'M',
    })),
  });
}
```

No commit yet.

---

## Task 14: Migrate `scopeArchitecture`

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Replace the function**

```ts
export async function scopeArchitecture(input: ScopeInput): Promise<ScopeOutput> {
  const { runId, worktreePath, tickets } = input;

  const task = `
Tickets to scope:
${tickets.map(t => `
TICKET ${t.id}: ${t.title}
Description: ${t.description}
Estimate: ${t.estimate}
Acceptance criteria: ${t.acceptanceCriteria.join('; ')}
`).join('\n---\n')}

For EACH ticket above, provide:
1. technicalPlan: 3-5 sentences, specific to this codebase (read files first; do not be generic)
2. filesToChange: specific paths to create/modify
3. dependencies: tickets that must be completed before this one (use TICKET-N ids)

Write your final answer as JSON to .atelier/output/architect.json using the Write tool.
Schema: { "scopedTickets": [{ "id": "string", "technicalPlan": "string", "filesToChange": ["string"], "dependencies": ["string"] }] }
The order of items in scopedTickets should match the input order.
Do not write any other files. Do not print the JSON to chat.
`.trim();

  await runOpencodeAgent({ runId, persona: 'architect', task });

  type ArchitectOutput = { scopedTickets: Array<{ id: string; technicalPlan: string; filesToChange: string[]; dependencies: string[] }> };
  const fallback: ArchitectOutput = {
    scopedTickets: tickets.map(t => ({ id: t.id, technicalPlan: 'Plan unparseable', filesToChange: [], dependencies: [] })),
  };
  const arch = await readStructuredOutputOrFallback<ArchitectOutput>(worktreePath, 'architect', fallback);

  const byId = new Map(arch.scopedTickets.map(s => [s.id, s]));
  return {
    scopedTickets: tickets.map(t => {
      const s = byId.get(t.id);
      return {
        ...t,
        technicalPlan: s?.technicalPlan ?? 'Plan unparseable',
        filesToChange: s?.filesToChange ?? [],
        dependencies: s?.dependencies ?? [],
      };
    }),
  };
}
```

No commit yet.

---

## Task 15: Migrate `implementCode` (developer)

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Add a helper to derive filesChanged from `git status --porcelain`**

At the bottom of `worker/src/activities.ts` (or near the imports), add:

```ts
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCb);

async function gitChangedFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await execFile('git', ['status', '--porcelain'], { cwd: worktreePath });
  return stdout.split('\n')
    .filter(Boolean)
    .map(line => line.slice(3));
}
```

- [ ] **Step 2: Replace the function**

```ts
export async function implementCode(input: ImplementInput): Promise<ImplementOutput> {
  const { runId, ticket, worktreePath, feedback, testFeedback } = input;

  let task = `
Ticket: ${ticket.id} — ${ticket.title}
${ticket.description}

Acceptance criteria:
${ticket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Technical plan:
${ticket.technicalPlan}

Suggested files to change: ${ticket.filesToChange.join(', ') || '(none specified — discover by reading the repo)'}

You are working inside the worktree (cwd). Use Read, Write, Edit, and Bash tools to implement this ticket.
Do NOT write a JSON output file — your output is the modified worktree itself.
`.trim();

  if (feedback?.length) {
    task += `\n\nCODE REVIEW FEEDBACK from the previous round:\n${feedback.map(c => `- ${c}`).join('\n')}`;
  }
  if (testFeedback?.length) {
    task += `\n\nTEST FAILURES from the previous round:\n${testFeedback.map(c => `- ${c}`).join('\n')}`;
  }

  await runOpencodeAgent({ runId, persona: 'developer', task });

  return { filesChanged: await gitChangedFiles(worktreePath) };
}
```

No commit yet.

---

## Task 16: Migrate `reviewCode`

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Replace the function**

```ts
export async function reviewCode(input: ReviewInput): Promise<ReviewResult> {
  const { runId, worktreePath, implementation, ticket } = input;

  const task = `
Review the implementation of ticket ${ticket.id}: ${ticket.title}

Files changed in this round: ${implementation.filesChanged.join(', ') || '(none)'}

Acceptance criteria:
${ticket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Read the changed files. Evaluate whether the implementation satisfies each acceptance criterion. Be specific and reference line ranges.

Write your final answer as JSON to .atelier/output/code-reviewer.json using the Write tool.
Schema: { "approved": boolean, "comments": ["specific actionable comment", ...] }
- "approved" is true only if every acceptance criterion is met.
- "comments" is empty if approved; otherwise lists what must change.
Do not write any other files. Do not print the JSON to chat.
`.trim();

  await runOpencodeAgent({ runId, persona: 'code-reviewer', task });

  return readStructuredOutputOrFallback<ReviewResult>(worktreePath, 'code-reviewer', {
    approved: false,
    comments: ['Reviewer output could not be parsed; rejecting by default'],
  });
}
```

No commit yet.

---

## Task 17: Migrate `testCode`

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Replace the function**

```ts
export async function testCode(input: TestInput): Promise<TestResult> {
  const { runId, worktreePath, implementation, ticket } = input;

  const task = `
Verify ticket ${ticket.id}: ${ticket.title}

Files changed: ${implementation.filesChanged.join(', ') || '(none)'}

Acceptance criteria:
${ticket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Write tests covering each acceptance criterion (you may create or extend test files using the Write tool — but DO NOT modify existing source files; that's the developer's job). Run the test suite using the Bash tool. Capture the result.

Write your final answer as JSON to .atelier/output/tester.json using the Write tool.
Schema: { "allPassed": boolean, "failures": ["criterion that failed: short reason", ...] }
- "allPassed" is true only if every criterion has a passing test.
- "failures" is empty when allPassed; otherwise lists criteria that failed (one per line).
Do not write any other files besides tests and tester.json. Do not print the JSON to chat.
`.trim();

  await runOpencodeAgent({ runId, persona: 'tester', task });

  return readStructuredOutputOrFallback<TestResult>(worktreePath, 'tester', {
    allPassed: false,
    failures: ['Tester output could not be parsed; failing by default'],
  });
}
```

No commit yet.

---

## Task 18: Migrate `pushChanges`

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Replace the function**

```ts
export async function pushChanges(input: PushInput): Promise<PushResult> {
  const { runId, worktreePath, tickets } = input;
  const branch = `atelier/autopilot/${Date.now()}`;

  const task = `
You are inside the worktree at the current working directory. Tickets completed in this run:
${tickets.map(t => `- ${t.id}: ${t.title}`).join('\n')}

Steps (use the Bash tool):
1. Create branch: git checkout -b ${branch}
2. Stage and commit ALL changes with a meaningful, multi-line message summarizing the tickets above.
3. Push to remote: git push -u origin ${branch}
4. Capture the pushed commit SHA: git rev-parse HEAD

Write your final answer as JSON to .atelier/output/pusher.json using the Write tool.
Schema: { "branch": "${branch}", "commitSha": "string-from-git-rev-parse", "prUrl": "optional URL string if 'git push' output included one" }
Do not write any other files besides pusher.json. Do not print the JSON to chat.
`.trim();

  await runOpencodeAgent({ runId, persona: 'pusher', task });

  return readStructuredOutputOrFallback<PushResult>(worktreePath, 'pusher', {
    branch,
    commitSha: 'unknown',
  });
}
```

No commit yet.

---

## Task 19: Update workflows to pass `runId` and `worktreePath`; remove `implementation.code`

**Files:**
- Modify: `worker/src/workflows/autopilot.workflow.ts`
- Modify: `worker/src/workflows/greenfield.workflow.ts`

- [ ] **Step 1: Update `autopilot.workflow.ts`**

Replace the body of `autopilotWorkflow` (keeping the surrounding `proxyActivities` and exports) with the version below. The two material differences from the existing code: every activity call gains `runId` and `worktreePath` where required, and the `implementation.code = ...` re-assignment lines are removed (the developer session itself remembers prior attempts).

```ts
export async function autopilotWorkflow(input: AutopilotInput): Promise<AutopilotOutput> {
  const { projectPath, projectSlug, runId, userContext = {}, suggestedFeatures = [] } = input;
  const home = process.env.HOME ?? '/root';
  const worktreePath = `${home}/.atelier/worktrees/${projectSlug}/${runId}`;

  try {
    await notifyAgentStart({ agentId: 'researcher', agentName: 'Research Agent', terminalType: 'terminal' });
    const repoAnalysis = await researchRepo({ runId, projectPath, userContext });
    await notifyAgentComplete({ agentId: 'researcher', status: 'completed' });

    const { approvedFeatures } = await debateFeatures({
      runId, worktreePath, repoAnalysis, suggestedFeatures,
    });

    await notifyAgentStart({ agentId: 'ticket-bot', agentName: 'Ticket Bot', terminalType: 'terminal' });
    const tickets = await generateTickets({ runId, worktreePath, approvedFeatures });
    await notifyAgentComplete({ agentId: 'ticket-bot', status: 'completed' });

    await notifyAgentStart({ agentId: 'architect', agentName: 'Architect', terminalType: 'terminal' });
    const scopedTickets = (await scopeArchitecture({ runId, tickets, projectPath, worktreePath })).scopedTickets;
    await notifyAgentComplete({ agentId: 'architect', status: 'completed' });

    let prBranch: string | undefined;
    for (const ticket of scopedTickets) {
      await notifyAgentStart({ agentId: 'developer', agentName: 'Developer', terminalType: 'terminal' });
      let implementation = await implementCode({ runId, ticket, worktreePath, projectPath });
      await notifyAgentComplete({ agentId: 'developer', status: 'completed' });

      let reviewApproved = false;
      for (let i = 0; i < 3 && !reviewApproved; i++) {
        await notifyAgentStart({ agentId: 'code-reviewer', agentName: 'Code Reviewer', terminalType: 'terminal' });
        const reviewResult = await reviewCode({ runId, worktreePath, implementation, ticket });
        await notifyAgentComplete({ agentId: 'code-reviewer', status: 'completed' });
        if (reviewResult.approved) {
          reviewApproved = true;
        } else {
          implementation = await implementCode({
            runId, ticket, worktreePath, projectPath, feedback: reviewResult.comments,
          });
        }
      }
      if (!reviewApproved) {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, error: `Review loop exceeded for ${ticket.id}` };
      }

      let testsPassed = false;
      for (let i = 0; i < 3 && !testsPassed; i++) {
        await notifyAgentStart({ agentId: 'tester', agentName: 'Tester', terminalType: 'terminal' });
        const testResult = await testCode({ runId, worktreePath, implementation, ticket });
        await notifyAgentComplete({ agentId: 'tester', status: 'completed' });
        if (testResult.allPassed) {
          testsPassed = true;
        } else {
          implementation = await implementCode({
            runId, ticket, worktreePath, projectPath, testFeedback: testResult.failures,
          });
        }
      }
      if (!testsPassed) {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, error: `Test loop exceeded for ${ticket.id}` };
      }
    }

    await notifyAgentStart({ agentId: 'pusher', agentName: 'Pusher', terminalType: 'terminal' });
    const pushResult = await pushChanges({ runId, worktreePath, projectPath, tickets: scopedTickets });
    await notifyAgentComplete({ agentId: 'pusher', status: 'completed' });

    return { status: 'completed', ticketsCreated: scopedTickets.length, prBranch: pushResult.branch };
  } catch (e) {
    return { status: 'failed', ticketsCreated: 0, error: String(e) };
  }
}
```

Note: agent IDs `reviewer` → `code-reviewer` and the `terminalType: 'direct-llm'` indicators are unified to `'terminal'` because every agent now runs in a terminal.

- [ ] **Step 2: Update `greenfield.workflow.ts` similarly**

Apply the same kind of edits to `worker/src/workflows/greenfield.workflow.ts`:

```ts
export async function greenfieldWorkflow(input: GreenfieldInput): Promise<any> {
  const { projectPath, projectSlug, runId, userRequest } = input;
  const worktreePath = `${process.env.HOME ?? '/root'}/.atelier/worktrees/${projectSlug}/${runId}`;

  await notifyAgentStart({ agentId: 'validator', agentName: 'Request Validator', terminalType: 'terminal' });
  const { tickets } = await generateTickets({
    runId, worktreePath,
    approvedFeatures: [{ name: userRequest, rationale: 'User requested directly', priority: 'high' }],
  });
  await notifyAgentComplete({ agentId: 'validator', status: 'completed' });

  await notifyAgentStart({ agentId: 'architect', agentName: 'Architect', terminalType: 'terminal' });
  const { scopedTickets } = await scopeArchitecture({ runId, tickets, projectPath, worktreePath });
  await notifyAgentComplete({ agentId: 'architect', status: 'completed' });

  for (const ticket of scopedTickets) {
    await notifyAgentStart({ agentId: 'developer', agentName: 'Developer', terminalType: 'terminal' });
    let implementation = await implementCode({ runId, ticket, worktreePath, projectPath });
    await notifyAgentComplete({ agentId: 'developer', status: 'completed' });

    let reviewApproved = false;
    for (let i = 0; i < 3 && !reviewApproved; i++) {
      await notifyAgentStart({ agentId: 'code-reviewer', agentName: 'Code Reviewer', terminalType: 'terminal' });
      const result = await reviewCode({ runId, worktreePath, implementation, ticket });
      await notifyAgentComplete({ agentId: 'code-reviewer', status: 'completed' });
      if (result.approved) reviewApproved = true;
      else implementation = await implementCode({ runId, ticket, worktreePath, projectPath, feedback: result.comments });
    }
    if (!reviewApproved) return { status: 'stalled', error: `Review loop exceeded for ${ticket.id}` };

    let testsPassed = false;
    for (let i = 0; i < 3 && !testsPassed; i++) {
      await notifyAgentStart({ agentId: 'tester', agentName: 'Tester', terminalType: 'terminal' });
      const result = await testCode({ runId, worktreePath, implementation, ticket });
      await notifyAgentComplete({ agentId: 'tester', status: 'completed' });
      if (result.allPassed) testsPassed = true;
      else implementation = await implementCode({ runId, ticket, worktreePath, projectPath, testFeedback: result.failures });
    }
    if (!testsPassed) return { status: 'stalled', error: `Test loop exceeded for ${ticket.id}` };
  }

  await notifyAgentStart({ agentId: 'pusher', agentName: 'Pusher', terminalType: 'terminal' });
  const pushResult = await pushChanges({ runId, worktreePath, projectPath, tickets: scopedTickets });
  await notifyAgentComplete({ agentId: 'pusher', status: 'completed' });

  return { status: 'completed', ticketsCreated: scopedTickets.length, prBranch: pushResult.branch };
}
```

- [ ] **Step 3: Verify worker compiles**

Run: `cd worker && bun build src/worker.ts --outdir /tmp/check && rm -rf /tmp/check`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 4: Commit Tasks 10–18 together**

```bash
git add worker/src/activities.ts worker/src/workflows/autopilot.workflow.ts worker/src/workflows/greenfield.workflow.ts
git commit -m "feat(worker): route all activities through opencode sessions"
```

---

## Task 20: Wire run-start: bootstrap + start opencode server when a run is created

**Files:**
- Modify: `backend/src/ipc-handlers.ts`

- [ ] **Step 1: Update `autopilot.start` handler**

In `backend/src/ipc-handlers.ts`, replace the `autopilot.start` handler with:

```ts
register('autopilot.start', async (opts: {
  projectPath: string; projectSlug: string; suggestedFeatures?: string[];
}) => {
  const runId = `autopilot-${Date.now()}`;
  const worktree = await createWorktree(opts.projectPath, opts.projectSlug, runId);

  const apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey('minimax', 'apiKey'));
  if (!apiKey) throw new Error('MiniMax API key not configured. Add it in Settings.');

  await bootstrapWorktree({ worktreePath: worktree.path, miniMaxApiKey: apiKey });
  await startOpencodeServer(runId, worktree.path);

  const connection = await Connection.connect({ address: '127.0.0.1:7466' });
  const client = new Client({ connection });
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

  return { runId, workflowId: handle.workflowId, worktreePath: worktree.path };
});
```

- [ ] **Step 2: Update `greenfield.start` similarly**

```ts
register('greenfield.start', async (opts: {
  projectPath: string; projectSlug: string; userRequest: string;
}) => {
  const runId = `greenfield-${Date.now()}`;
  const worktree = await createWorktree(opts.projectPath, opts.projectSlug, runId);

  const apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey('minimax', 'apiKey'));
  if (!apiKey) throw new Error('MiniMax API key not configured. Add it in Settings.');

  await bootstrapWorktree({ worktreePath: worktree.path, miniMaxApiKey: apiKey });
  await startOpencodeServer(runId, worktree.path);

  const connection = await Connection.connect({ address: '127.0.0.1:7466' });
  const client = new Client({ connection });
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

  return { runId, workflowId: handle.workflowId, worktreePath: worktree.path };
});
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && bun build src/index.ts --outdir /tmp/check && rm -rf /tmp/check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/src/ipc-handlers.ts
git commit -m "feat(backend): bootstrap and start opencode server on run creation"
```

---

## Task 21: Stop the opencode server when a run ends

**Files:**
- Modify: `worker/src/workflows/autopilot.workflow.ts`
- Modify: `worker/src/workflows/greenfield.workflow.ts`

The workflow runs in the worker, which can't directly call `stopOpencodeServer` (different process). It must call the backend HTTP endpoint added in Task 8.

- [ ] **Step 1: Add a stop helper to `worker/src/opencode-client.ts`**

Append to the file:

```ts
export async function stopOpencodeServer(runId: string): Promise<void> {
  await fetch(`${BACKEND_URL}/api/opencode/server/${runId}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Wrap each workflow body in try/finally**

In `worker/src/workflows/autopilot.workflow.ts`, change the function from:

```ts
export async function autopilotWorkflow(input: AutopilotInput): Promise<AutopilotOutput> {
  // ... existing body ...
  try {
    // existing try block
  } catch (e) {
    return { status: 'failed', ticketsCreated: 0, error: String(e) };
  }
}
```

to:

```ts
import { stopOpencodeServer } from '../opencode-client.js';

export async function autopilotWorkflow(input: AutopilotInput): Promise<AutopilotOutput> {
  const { projectPath, projectSlug, runId, userContext = {}, suggestedFeatures = [] } = input;
  const home = process.env.HOME ?? '/root';
  const worktreePath = `${home}/.atelier/worktrees/${projectSlug}/${runId}`;

  try {
    // ... existing happy-path body ...
  } catch (e) {
    return { status: 'failed', ticketsCreated: 0, error: String(e) };
  } finally {
    try { await stopOpencodeServer(runId); } catch { /* best-effort */ }
  }
}
```

- [ ] **Step 3: Apply the same try/finally to `greenfield.workflow.ts`**

```ts
import { stopOpencodeServer } from '../opencode-client.js';

export async function greenfieldWorkflow(input: GreenfieldInput): Promise<any> {
  const { projectPath, projectSlug, runId, userRequest } = input;
  const worktreePath = `${process.env.HOME ?? '/root'}/.atelier/worktrees/${projectSlug}/${runId}`;

  try {
    // ... existing body ...
  } finally {
    try { await stopOpencodeServer(runId); } catch { /* best-effort */ }
  }
}
```

(The greenfield workflow currently has no top-level try/catch. Wrap the entire body in `try { ... } finally { ... }` — it returns from inside the try.)

- [ ] **Step 4: Verify worker compiles**

Run: `cd worker && bun build src/worker.ts --outdir /tmp/check && rm -rf /tmp/check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/src/opencode-client.ts worker/src/workflows/autopilot.workflow.ts worker/src/workflows/greenfield.workflow.ts
git commit -m "feat(worker): stop per-run opencode server in workflow finally-block"
```

---

## Task 22: Remove dead code

**Files:**
- Modify: `backend/src/ipc-handlers.ts`
- Modify: `backend/src/index.ts`
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Remove `pty.spawnAgent` IPC handler**

In `backend/src/ipc-handlers.ts`, delete the `register('pty.spawnAgent', ...)` block.

- [ ] **Step 2: Remove `POST /api/pty/spawn` and `GET /api/agent/:agentId/status` from `backend/src/index.ts`**

Delete both blocks. Also remove the now-unused `loadProjectContext`/`fs.readFileSync(personaPath, ...)` references introduced for `/api/pty/spawn`.

- [ ] **Step 3: Remove `callMiniMax`, `loadPersona`, `spawnAgent`, `runTerminalAgentViaPty` from `worker/src/activities.ts`**

Delete each of these top-level functions. Also remove the now-unused `BACKEND_URL` constant if no other function uses it (check first).

- [ ] **Step 4: Verify both packages build clean**

Run in parallel:
```bash
cd backend && bun build src/index.ts --outdir /tmp/check-be && rm -rf /tmp/check-be
cd worker  && bun build src/worker.ts --outdir /tmp/check-wo && rm -rf /tmp/check-wo
```
Expected: both exit 0.

- [ ] **Step 5: Run all unit tests**

Run:
```bash
cd backend && bun test
cd worker  && bun test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/ipc-handlers.ts backend/src/index.ts worker/src/activities.ts
git commit -m "chore: remove callMiniMax, loadPersona, spawnAgent, pty.spawnAgent (replaced by opencode)"
```

---

## Task 23: Manual smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Configure MiniMax key in Settings**

Start the app (`make backend & make worker & make frontend` or `bun run dev` from the root). Open Settings → Model Config → MiniMax, paste a valid key, save.

- [ ] **Step 2: Open a small fixture repo and click Autopilot**

Use a small project (e.g. an empty Bun starter) so the run completes quickly. Click the Autopilot button.

- [ ] **Step 3: Verify visible behavior**

Confirm in order:
- TerminalGrid lights up the `researcher` terminal first; you see opencode-formatted tool calls (Read, etc.) streaming in xterm.
- After researcher exits, `debate-signal` and `debate-noise` PTYs run in parallel (two terminals active simultaneously).
- `arbiter` terminal runs after the two debate sessions finish.
- `ticket-bot`, `architect` follow.
- `developer` terminal shows file edits via Edit/Write tool calls.
- `code-reviewer` terminal shows Read tool calls and writes the verdict.
- `tester` terminal runs the test suite via Bash.
- `pusher` terminal runs `git checkout -b ...`, `git commit`, `git push`.

- [ ] **Step 4: Verify worktree and outputs**

Open `~/.atelier/worktrees/<slug>/<runId>/`:
- `opencode.json` exists with the MiniMax key.
- `.opencode/agent/` contains 10 persona files with frontmatter.
- `.atelier/output/` contains JSON files for every planning persona that ran.
- `git log` shows the developer's commits and the pusher's final commit on the new branch.

- [ ] **Step 5: Verify cleanup**

After the run completes (or after cancelling it), run:
```bash
pgrep -af "opencode serve"
```
Expected: no `opencode serve` processes for that runId remain. (`ps -p <pid>` for the recorded pid should also fail.)

- [ ] **Step 6: Cancel-mid-run check**

Start a fresh Autopilot run, then cancel it before it completes (kill the workflow via the Temporal UI at http://localhost:8466, or Ctrl-C the worker). Verify `pgrep -af "opencode serve"` returns nothing for that runId.

- [ ] **Step 7: Document the smoke test pass in the spec**

If anything failed in Steps 3–6, file follow-up issues. Otherwise no commit needed; the smoke test is a verification gate.

---

## Self-review notes

**Spec coverage:**
- ✅ All 9 (now 10, with arbiter) personas through opencode → Tasks 7, 11–18.
- ✅ Per-run `opencode serve` lifecycle → Tasks 5, 20, 21.
- ✅ Bypass permissions → Task 5 config + `--dangerously-skip-permissions` flag in Tasks 8 (both IPC and HTTP variants).
- ✅ MiniMax via opencode provider → Tasks 3, 8 (Step 1), 20.
- ✅ Personas as opencode agents with frontmatter → Tasks 2, 3, 7.
- ✅ PTY runs `opencode run --attach …` → Task 8.
- ✅ Hybrid output capture (JSON file + worktree mutation) → Tasks 11–18.
- ✅ One session per persona per run → Tasks 4, 6, 8.
- ✅ Debate parallelism via two sessions → Task 12.
- ✅ Retry loops reuse the same persona session → Task 19 (note: same persona name → same `ensureSession` cache hit → same opencode session id).
- ✅ Single-PR migration with no fallback → Task 22 deletes the old code.

**Type consistency:** `runId: string` added uniformly across all activity inputs (Task 10), and every workflow call passes it (Task 19). `Implementation.code` removed in Task 10 and all `implementation.code = ...` assignments removed in Task 19. The `Persona` type is duplicated in `backend/src/opencode/personas.ts` and `worker/src/opencode-client.ts` — intentional (no shared package), but the strings must match. Verified by eye.

**Open verification points** flagged inline:
- Task 5 Step 2 — verify the actual stdout format of `opencode serve`'s startup line (the `PORT_REGEX` may need adjustment).
- The opencode HTTP endpoints used (`POST /session`, `GET /app` for health) are based on `opencode 1.14.x`'s headless server contract; if the version on the user's machine differs, adjust paths in Tasks 5 and 6.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-opencode-agent-terminal-routing.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
