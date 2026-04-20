# Atelier Architecture

## Overview

Atelier is a local-first multi-agent orchestration desktop app. It runs autonomous AI agents against user projects using Temporal durable workflows, with a full terminal grid UI for live visibility into agent activity.

## Process Model

### Backend (Bun)
Single `bun run dev` process that manages:
- **IPC Handler Registry** — WebSocket-routed request handlers for frontend communication
- **PTY Manager** — Spawns and manages pseudo-terminals for agent process execution
- **Milestone Service** — Creates/polls milestones via HTTP API for human-in-the-loop checkpoints
- **Temporal Sidecar Lifecycle** — Starts/stops the embedded Temporal dev server on ports 7466/7467
- **Project Context Storage** — SQLite-backed persistent storage for cross-session project memory
- **Worktree Management** — Git worktree creation/removal for sandboxed agent work

### Temporal Worker (Bun)
Single `bun run start` process that:
- Connects to Temporal via `Connection.connect({ address: '127.0.0.1:7466' })`
- Registers workflow implementations and activity handlers
- Polls the `atelier-default-ts` task queue and executes workflow steps

### Frontend (Electron)
- **Electron main process** — Window management, folder picker dialog, DevTools
- **React renderer** — TerminalGrid, Sidebar, MilestoneInbox, SettingsModal
- **WebSocket IPC** — Bridges frontend to backend IPC handler registry

### Data Flow

```
Frontend (React)
    │
    │ WebSocket: invoke('handler.name', args)
    ▼
Backend IPC Registry (Bun)
    │
    ├── PTY Manager ──────────────────────► node-pty ──► Claude Code (terminal agents)
    │
    ├── Milestone Service ────────────────► SQLite DB
    │
    ├── Temporal Client ─────────────────► Temporal Server (:7466) ──► Worker (Bun)
    │                                              │
    │                                              ▼
    │                                       Workflow Engine
    │                                              │
    │                                              ▼
    │                                       Activities (9 agents)
    │                                              │
    │                                              ▼
    │                                       MiniMax API / Claude Code CLI
    │
    └── Project Context ───────────────────► SQLite DB + JSON files
```

## Key Modules

### `backend/src/ipc-handlers.ts`
Maps handler names to async functions. All handlers are registered to a global map that the WebSocket server routes into.

Key handlers:
- `autopilot.start` / `greenfield.start` — Creates Temporal workflow runs
- `pty.spawnAgent` — Spawns a Claude Code agent in a PTY
- `milestone.create` / `milestone.resolve` — Human approval checkpoints
- `settings.modelConfig:get/set` — LLM provider configuration
- `worktree.create/remove` — Git worktree lifecycle

### `backend/src/pty-manager.ts`
Manages PTY processes. Frontend subscribes to PTY output via WebSocket. Supports:
- `spawn(id, command, args, cwd)` — Start a PTY
- `write(id, data)` — Send input to PTY
- `resize(id, cols, rows)` — Resize terminal
- `kill(id)` — Terminate PTY
- `isRunning(id)` — Check if PTY still alive

### `backend/src/sidecar-lifecycle.ts`
Manages the Temporal development server (a Go binary):
- `startSidecar()` — Spawns `temporal server start-dev` in background, waits for gRPC health
- `stopSidecar()` — Kills the Go process
- `getSidecarStatus()` — Returns running/stopped state

### `worker/src/workflows/autopilot.workflow.ts`
The 9-phase Temporal workflow:
1. `notifyAgentStart` → `researchRepo` → `notifyAgentComplete`
2. `notifyAgentStart` → `debateFeatures` → `notifyAgentComplete`
3. `notifyAgentStart` → `generateTickets` → `notifyAgentComplete`
4. `notifyAgentStart` → `scopeArchitecture` → `notifyAgentComplete`
5-7. Per-ticket loop: `implementCode` → (up to 3x `reviewCode` with feedback) → (up to 3x `testCode` with fixes)
8. `notifyAgentStart` → `pushChanges` → `notifyAgentComplete`

Each phase notifies the frontend via `notifyAgentStart`/`notifyAgentComplete` so the UI can show agent status.

### `worker/src/activities.ts`
All activity implementations:
- `researchRepo` — Reads README, package.json, src/ structure; calls MiniMax for analysis
- `debateFeatures` — Runs Signal and Noise debate personas in parallel, reconciles via arbiter LLM
- `generateTickets` — Generates structured tickets from approved features
- `scopeArchitecture` — High-level technical planning per ticket
- `implementCode` — Main code generation; supports `feedback` and `testFeedback` for retry loops
- `reviewCode` — Returns `{ approved: boolean, comments: string[] }`
- `testCode` — Returns `{ allPassed: boolean, failures: string[] }`
- `pushChanges` — Creates branch, commits, pushes via LLM

Persona files are loaded from `src/.atelier/agents/` (bundled) or `.atelier/agents/` (project-local).

## Workflows

### Autopilot
```
Input: projectPath, projectSlug, runId, userContext?, suggestedFeatures?
Output: { status, ticketsCreated, prBranch?, error? }

Phases: Research → Debate → Tickets → Scope → [Implement → Review (3x) → Test (3x)] → Push
```

### Greenfield
```
Input: projectPath, projectSlug, runId, userRequest
Output: { status, ticketsCreated, prBranch?, error? }

Phases: Same as Autopilot but starts from userRequest NLP instead of repo analysis
```

## Database Schema (SQLite)

**projects**: `id, name, path, created_at, last_opened_at, settings_json`

**runs**: `id, project_id, name, status, created_at, completed_at, workflow_id, settings_json`

**milestones**: `id, run_id, name, payload_json, decision_json, resolved, created_at, resolved_at`

**project_context**: `project_slug TEXT PRIMARY KEY, context_json, updated_at`

**model_config**: `id, name, base_url, enabled, models_json`

## WebSocket Protocol

Frontend connects to `ws://localhost:3000`. Messages are JSON:

```typescript
// Request (frontend → backend)
{ type: 'invoke', handler: 'handler.name', id: string, args: object }

// Response (backend → frontend)
{ type: 'response', id: string, result?: any, error?: string }

// Stream (backend → frontend)
{ type: 'stream', handler: 'pty.output', id: string, data: string }
```

PTY subscription:
```typescript
{ type: 'subscribe', channel: 'pty', id: 'agent-1' }
{ type: 'unsubscribe', channel: 'pty', id: 'agent-1' }
```

## Port Map

| Port | Service |
|---|---|
| 3000 | Bun WebSocket server (IPC) |
| 3001 | Milestone HTTP API |
| 7466 | Temporal gRPC |
| 7467 | Temporal HTTP |
| 5173 | Vite dev server |
| 9222 | Electron debug port |

## Dependencies

```
electron/          — Desktop app shell
frontend/          — React UI (Vite)
backend/           — Bun API server
worker/            — Temporal Bun worker
```
