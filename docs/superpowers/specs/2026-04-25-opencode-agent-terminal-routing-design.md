# Routing Atelier Agents Through opencode

**Status:** Draft
**Date:** 2026-04-25
**Author:** Brainstormed with Claude

## Problem

Today every Atelier "agent" is one of two things:

1. A direct HTTP call to `api.minimax.chat` (`callMiniMax` in `worker/src/activities.ts`) — pure text in, text out, no tool use, no file access.
2. A `claude --dangerously-skip-permissions -p "<prompt>"` one-shot spawned in a node-pty PTY (`pty.spawnAgent` in `backend/src/ipc-handlers.ts`) — has tool access, but the path is dormant; no activity actually wires through it.

The result: planning agents can't read the real repo, code-writing agents can't actually write code, and the Terminal Grid is mostly a UI for empty terminals. We want every agent to live inside an opencode session so they get structured tool use (file read/edit, bash, web fetch) with per-persona scoping, and the grid renders what each agent is doing in real time.

## Goals

- All nine agent personas execute through opencode, not direct LLM HTTP.
- Each agent has the right tools and only the right tools (researcher reads, developer edits, reviewer can't write, etc.).
- The existing TerminalGrid + xterm + WebSocket pipeline keeps working with minimal change.
- The existing per-run worktree isolation extends naturally to the new opencode server.
- Permission prompts are bypassed (Atelier is autonomous; the human gate is the milestone system, not interactive opencode prompts).

## Non-goals

- Replacing MiniMax with a different provider (we keep MiniMax; opencode is the transport, not a provider switch).
- Replacing xterm with a custom event-stream renderer.
- Per-ticket session forking (deferred — see "Future work").
- Migrating away from the existing milestone HTTP API.

## Decisions (with assumptions called out)

| # | Decision | Notes |
|---|----------|-------|
| 1 | Scope: **all 9 agents** routed through opencode | Assumed — user said "the terminals the agents are using"; flip to "code-touching agents only" if planning agents shouldn't use tools. |
| 2 | Transport: **per-run `opencode serve`**, agents are HTTP/session clients | One server per Autopilot/Greenfield run, scoped to the worktree. |
| 3 | Permissions: **bypass mode** | `--dangerously-skip-permissions` on `opencode run`; `permission: { edit, bash, webfetch: "allow" }` in `opencode.json` for serve. |
| 4 | Provider: **keep MiniMax**, configured via opencode's MiniMax provider with the existing keychain key | Existing Settings UI keeps working; per-agent model selection is a follow-up. |
| 5 | Personas: **convert to opencode agents** with frontmatter, materialized in `<worktree>/.opencode/agent/*.md` at run start | Per-persona tool restrictions live in agent frontmatter. |
| 6 | Rendering: PTY runs **`opencode run --attach <serve-url> --session <id> -p "<task>"`** | Existing PTY → WebSocket → xterm pipeline unchanged; opencode formats the rich output. |
| 7 | Output capture: **hybrid** — planning agents write JSON to `<worktree>/.atelier/output/<persona>.json`, code-touching agents touch the worktree directly | Kills the awkward `Implementation.code` string in `ImplementOutput`. |
| 8 | Session topology: **one session per persona per run** | Retry loops reuse the same persona session, so the developer "remembers" reviewer feedback as conversation history. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bun Backend                                                        │
│  ┌────────────────┐   ┌────────────────────┐   ┌─────────────────┐  │
│  │ IPC Handlers   │   │ OpencodeLifecycle  │   │ PTY Manager     │  │
│  │ opencode.*     │──▶│ (per-run serve)    │   │ (unchanged)     │  │
│  └────────────────┘   └─────────┬──────────┘   └────────┬────────┘  │
│                                 │                       │           │
└─────────────────────────────────┼───────────────────────┼───────────┘
                                  │                       │
                                  ▼                       │
                       ┌──────────────────────┐           │
                       │  opencode serve      │           │
                       │  --cwd <worktree>    │           │
                       │  port <random>       │           │
                       │  HTTP API + /event   │           │
                       └────────┬─────────────┘           │
                                │                         │
                  ┌─────────────┴────────────┐            │
                  │ session registry         │            │
                  │ runId → {port, password, │            │
                  │   sessions: persona→id}  │            │
                  └──────────────────────────┘            │
                                                          ▼
                                              ┌─────────────────────┐
                                              │ Worker activity     │
                                              │ spawns one PTY:     │
                                              │ `opencode run       │
                                              │   --attach <url>    │
                                              │   --session <id>    │
                                              │   -p "<task>"`      │
                                              └─────────────────────┘
```

**New:**
- `backend/src/opencode-lifecycle.ts` — start/stop/health-check `opencode serve` per run.
- `backend/src/opencode-bootstrap.ts` — write `<worktree>/opencode.json` and materialize `<worktree>/.opencode/agent/*.md`.
- `backend/src/opencode-sessions.ts` — per-run session registry; lazy-creates one session per persona via opencode HTTP.
- `worker/src/opencode-client.ts` — thin worker-side helper that POSTs to backend and waits for PTY exit.

**Unchanged:**
- `pty-manager.ts` and the WebSocket → xterm pipeline. We just spawn a different command.
- The Temporal workflow shape and milestone system.
- The Settings UI for MiniMax key.

**Changed:**
- `worker/src/activities.ts` — every persona-driven activity replaces its `callMiniMax(...)` call with `runOpencodeAgent(runId, persona, task)`. `callMiniMax` itself is deleted; no fallback path.
- `backend/src/ipc-handlers.ts` — adds `opencode.runAgent`, `opencode.startServer`, `opencode.stopServer`, `opencode.serverStatus`. The existing `pty.spawnAgent` is removed (no longer used).
- Worktree creation flow now invokes `opencode-bootstrap` before the workflow starts.

## Components and contracts

### `opencode-lifecycle.ts`

```ts
startOpencodeServer(runId: string, worktreePath: string): Promise<{ port: number; password: string }>
stopOpencodeServer(runId: string): Promise<void>
getOpencodeServer(runId: string): { port: number; password: string } | null
```

- Spawns `opencode serve --port 0 --hostname 127.0.0.1 --cwd <worktree>` with env `OPENCODE_SERVER_PASSWORD=<random-32-bytes-hex>`.
- Parses the assigned port from stdout (opencode logs `listening on http://127.0.0.1:<port>`).
- Polls `GET /health` (or first session-list call) until 200 with a 10s timeout.
- Records `{ runId, port, password, pid }` in an in-memory map.
- `stopOpencodeServer` sends SIGTERM, waits 5s, then SIGKILL; clears the map entry.
- Mirrors the structure of `sidecar-lifecycle.ts`.

### `opencode-bootstrap.ts`

```ts
bootstrapWorktree(worktreePath: string, miniMaxApiKey: string): Promise<void>
```

Writes `<worktree>/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "minimax": { "options": { "apiKey": "<from keychain>" } }
  },
  "permission": {
    "edit": "allow",
    "bash": "allow",
    "webfetch": "allow"
  }
}
```

Materializes `<worktree>/.opencode/agent/<persona>.md` for each of the nine personas. Body comes from `worker/src/.atelier/agents/<persona>.md`. Frontmatter is generated from a single `PERSONA_TOOLS` constant in this file.

Every persona has `write: true` because every persona must write its structured output to `.atelier/output/<persona>.json` (the prompt restricts *where* they write — see "Write tool scoping" below). `edit` and `bash` are restricted per role:

```ts
const PERSONA_TOOLS: Record<Persona, AgentFrontmatter> = {
  researcher:      { tools: { read: true, write: true, edit: false, bash: false, webfetch: true  } },
  'debate-signal': { tools: { read: true, write: true, edit: false, bash: false, webfetch: true  } },
  'debate-noise':  { tools: { read: true, write: true, edit: false, bash: false, webfetch: true  } },
  arbiter:         { tools: { read: true, write: true, edit: false, bash: false, webfetch: false } },
  'ticket-bot':    { tools: { read: true, write: true, edit: false, bash: false, webfetch: false } },
  architect:       { tools: { read: true, write: true, edit: false, bash: true,  webfetch: false } },
  developer:       { tools: { read: true, write: true, edit: true,  bash: true,  webfetch: false } },
  'code-reviewer': { tools: { read: true, write: true, edit: false, bash: false, webfetch: false } },
  tester:          { tools: { read: true, write: true, edit: false, bash: true,  webfetch: false } },
  pusher:          { tools: { read: true, write: true, edit: false, bash: true,  webfetch: false } },
};
```

The meaningful axis of restriction is `edit` (mutating existing files) and `bash`. Only `developer` can edit existing source files; only `developer`, `tester`, `architect`, and `pusher` can run shell commands. `write` is universal because every persona produces an output artifact.

**Write tool scoping:** Planning personas (everyone except `developer`, `tester`, `pusher`) include in their prompt: *"You may only use the Write tool to create `.atelier/output/<persona>.json`. Do not write any other files."* This is a soft restriction — opencode's permission system isn't path-scoped at the `write` level, so the constraint lives in the persona prompt and is enforced after-the-fact by `git status` checks (the implementCode workflow already inspects the worktree state). Future work could move this to a path-scoped permission once opencode supports it.

Each generated file looks like:

```yaml
---
description: <one-line summary from persona body>
mode: subagent
model: minimax/abab6.5s-chat
tools:
  read: true
  write: false
  edit: false
  bash: false
  webfetch: true
---

<persona body verbatim>
```

Bootstrap is idempotent — safe to call again on retry.

### `opencode-sessions.ts`

```ts
ensureSession(runId: string, persona: Persona): Promise<{ sessionId: string }>
listSessions(runId: string): Array<{ persona: Persona; sessionId: string }>
clearSessions(runId: string): void
```

- `ensureSession` looks up `(runId, persona)` in an in-memory map; if absent, POSTs `/session` to the run's opencode server with `{ title: persona, agentName: persona }`, caches the returned id.
- `clearSessions` drops the in-memory map entries (sessions die with the server; no need to call DELETE).

### IPC handler `opencode.runAgent`

In `backend/src/ipc-handlers.ts`:

```ts
register('opencode.runAgent', async (opts: {
  runId: string;
  persona: Persona;
  task: string;
  ptyId: string;     // typically equals persona name; debate-signal/noise differ per call
}) => {
  const server = getOpencodeServer(opts.runId);
  if (!server) throw new Error(`No opencode server for run ${opts.runId}`);

  const { sessionId } = await ensureSession(opts.runId, opts.persona);

  ptyManager.spawn(opts.ptyId, 'opencode', [
    'run',
    '--attach', `http://127.0.0.1:${server.port}`,
    '--password', server.password,
    '--session', sessionId,
    '--agent', opts.persona,
    '--dangerously-skip-permissions',
    '-p', opts.task,
  ], getWorktreePath(opts.runId));

  return { ptyId: opts.ptyId, sessionId };
});
```

The handler returns immediately. The activity learns about completion via the existing PTY exit signal (the same pattern `runTerminalAgentViaPty` already uses for `claude -p`).

Companion handlers:
- `opencode.startServer({ runId, worktreePath })` — bootstraps then starts.
- `opencode.stopServer({ runId })` — kills server, clears sessions.
- `opencode.serverStatus({ runId })` — returns `{ running, port? }` for UI status badges.

### Worker-side helper `runOpencodeAgent`

In a new `worker/src/opencode-client.ts`:

```ts
export async function runOpencodeAgent(
  runId: string,
  persona: Persona,
  task: string,
  ptyId?: string,
): Promise<{ stdout: string; exitCode: number }> {
  const id = ptyId ?? persona;
  await fetch(`${BACKEND_URL}/api/opencode/runAgent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, persona, task, ptyId: id }),
  });
  return waitForPtyExit(id);   // existing polling pattern from runTerminalAgentViaPty
}

export async function readStructuredOutput<T>(
  worktreePath: string,
  persona: Persona,
): Promise<T> {
  const file = path.join(worktreePath, '.atelier', 'output', `${persona}.json`);
  return JSON.parse(await fs.promises.readFile(file, 'utf-8'));
}
```

## Activity migration

| Activity | Old (callMiniMax) | New | Output capture |
|---|---|---|---|
| `researchRepo` | callMiniMax(persona, prompt) | runOpencodeAgent(runId, 'researcher', prompt) | `readStructuredOutput<ResearchOutput>('researcher')` |
| `debateFeatures` | 2× callMiniMax in parallel + arbiter callMiniMax | 2× runOpencodeAgent('debate-signal' / 'debate-noise') in parallel + runOpencodeAgent('arbiter') | `readStructuredOutput<DebateOutput>('arbiter')` |
| `generateTickets` | callMiniMax | runOpencodeAgent(runId, 'ticket-bot', prompt) | `readStructuredOutput<TicketsOutput>('ticket-bot')` |
| `scopeArchitecture` | callMiniMax | runOpencodeAgent(runId, 'architect', prompt) | `readStructuredOutput<ScopeOutput>('architect')` |
| `implementCode` | callMiniMax | runOpencodeAgent(runId, 'developer', prompt) | side-effect: worktree files modified. Returns `{ filesChanged }` derived from `git status --porcelain`. `Implementation.code` field is removed. |
| `reviewCode` | callMiniMax | runOpencodeAgent(runId, 'code-reviewer', prompt) | `readStructuredOutput<ReviewResult>('code-reviewer')` |
| `testCode` | callMiniMax | runOpencodeAgent(runId, 'tester', prompt) | `readStructuredOutput<TestResult>('tester')` |
| `pushChanges` | callMiniMax | runOpencodeAgent(runId, 'pusher', prompt) | `readStructuredOutput<PushResult>('pusher')` |

For planning personas, the prompt is amended at the end with a constant `STRUCTURED_OUTPUT_INSTRUCTIONS`:

```
Write your final answer as JSON to .atelier/output/<persona>.json (use the Write tool).
Do not print the JSON to chat. The schema is:
<schema for this persona>
```

`callMiniMax` is removed. `runTerminalAgentViaPty` is removed. `pty.spawnAgent` IPC handler is removed.

## Data flow

### Run start (Autopilot/Greenfield button)

1. `worktree.create(projectPath, slug, runId)` → `worktreePath`
2. `bootstrapWorktree(worktreePath, miniMaxKey)` — writes `opencode.json` and `.opencode/agent/*.md`
3. `startOpencodeServer(runId, worktreePath)` → `{ port, password }`
4. `client.workflow.start('autopilot', { runId, worktreePath, ... })`

### Per-activity invocation

1. Activity calls `runOpencodeAgent(runId, persona, prompt)`.
2. Worker POSTs `/api/opencode/runAgent` to backend.
3. Backend lazily creates the persona session, then spawns the PTY with `opencode run --attach … -p "<task>"`.
4. xterm renders PTY bytes (rich opencode output: tool calls, file diffs, model thinking).
5. PTY exits (success: 0, failure: non-zero).
6. Worker resolves the helper promise.
7. Activity reads structured output file (planning) or trusts the worktree mutation (code-touching), returns its typed result.

### Run end (success, failure, cancel)

1. Workflow finally-block calls `notifyAgentComplete` for the last running agent.
2. `clearSessions(runId)` and `stopOpencodeServer(runId)` (SIGTERM, then SIGKILL after 5s).
3. Worktree retention is unchanged — user/cleanup policy decides when to remove.

### Debate parallelism

`debateFeatures` calls `runOpencodeAgent(runId, 'debate-signal', ...)` and `runOpencodeAgent(runId, 'debate-noise', ...)` concurrently with `Promise.all`. Two distinct sessions, two distinct PTYs visible in the grid simultaneously. The arbiter is a third opencode session (`arbiter` persona, new file).

### Retry loops

`implementCode` retry-with-feedback uses the same developer session each time — reviewer feedback is sent as the next user message in that session, so the developer sees prior round's work in conversation history rather than via re-injected `feedback` / `testFeedback` strings. `reviewCode` and `testCode` likewise reuse their own per-persona sessions across attempts.

## Error handling

| Failure | Behavior |
|---------|----------|
| `opencode serve` fails to start within 10s | `startOpencodeServer` rejects; backend rolls back worktree creation, surfaces error to UI. |
| `opencode serve` dies mid-run (crash, OOM) | Next `runOpencodeAgent` PTY exits non-zero immediately; activity throws; Temporal retry policy applies. Backend lifecycle observes the SIGCHLD and clears the registry entry so a retry can re-bootstrap. |
| `opencode run` PTY exits non-zero | Worker helper rejects with `{ exitCode, stdout }`; activity decides retry vs. fail. |
| Persona writes invalid JSON to output file | `readStructuredOutput` throws; activity returns a typed fallback as today (`debateFeatures` already does this). |
| Persona forgets to write the output file | `readStructuredOutput` throws ENOENT; activity logs and returns fallback. |
| User cancels run | Workflow's finally-block kills the opencode server, which in turn kills any in-flight `opencode run` PTYs. |
| Backend restarts mid-run | All servers are in-memory; on next startup, `getOpencodeServer(runId)` returns null and the next activity call fails. The Temporal workflow can retry from its last completed step, but the user sees a fresh terminal grid. (Persistence of the registry is a future improvement.) |

## Testing

Test surface, smallest to largest:

- **Unit:** `opencode-bootstrap` — given a worktree path and a key, writes `opencode.json` and 9 agent files with the correct frontmatter; idempotent on second call.
- **Unit:** `opencode-sessions` — `ensureSession` POSTs once per (runId, persona), caches; mock the HTTP layer.
- **Integration (backend, opencode required):** `startOpencodeServer` spawns a real `opencode serve`, returns a working port; `stopOpencodeServer` actually kills it (verify PID gone).
- **Integration (backend + worker):** `runOpencodeAgent` round-trip — spawn server, start a planning persona with a deterministic prompt that writes a known JSON file, verify file content. Skip in CI without an opencode binary; run locally and on a self-hosted runner.
- **Manual smoke:** Click Autopilot in a small fixture project, watch all 9 terminals light up in sequence, confirm the worktree has actual file edits at the end.

Existing Temporal workflow tests stub activities, so they require no change.

## Migration

Single PR (no feature flag). The cutover removes `callMiniMax`, `runTerminalAgentViaPty`, and `pty.spawnAgent` in the same change as adding the new modules. There are no external consumers; the only "users" of the old code are the activities that get rewritten in this same PR.

The Settings → Model Config UI keeps working as-is (it stores the MiniMax key the same way; `bootstrapWorktree` reads it). If the user has no MiniMax key, the existing pre-flight check still fires before any run starts.

## Future work (explicitly not in this design)

- Per-agent / per-task model selection (Question 4 option C). Add `model` to `PERSONA_TOOLS` and a `--model` flag on the spawn.
- Per-ticket session forking (Question 8 option C) for cheaper context reuse across many tickets.
- ACP transport (Question 2 option C) once the protocol is more stable.
- Persistent session registry across backend restarts.
- Replacing PTY rendering with a custom event-stream React component (Question 6 option C) if richer in-app affordances are wanted (collapsible tool calls, inline diffs, etc.).
- Surfacing opencode session URLs / share links in the UI for debugging.
