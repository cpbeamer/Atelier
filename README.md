# Atelier

A local-first multi-agent orchestration desktop app. Open any codebase, kick off Autopilot, and watch AI agents research, debate, plan, build, review, test, and push changes — fully autonomously.

## Features

### Autopilot Mode
Open an existing project and hit **Autopilot** to run a fully automated pipeline:

1. **Research Agent** — Analyzes repo structure, README, dependencies, gaps, and opportunities
2. **Debate Agents (A + B)** — Adversarial signal/noise filtering; A argues value, B challenges noise
3. **Ticket Bot** — Generates structured tickets with acceptance criteria and estimates
4. **Architect** — Scopes tickets into technical plans with file-level precision
5. **Developer** — Implements code in an isolated worktree
6. **Code Reviewer** — Reviews with up to 3 feedback loops
7. **Tester** — Verifies acceptance criteria with up to 3 retry loops
8. **Pusher** — Creates a branch and pushes changes

### Greenfield Mode
Describe what you want to build in plain language. Same pipeline as Autopilot, starting from your intent rather than existing repo analysis.

### Terminal Grid
All 9 agent terminals are visible simultaneously, streaming live output. Agents show as running/pending/done with real-time status.

### Project Context
Project context persists across sessions. Research Agent reads prior context to avoid re-asking known information. Edit via **Settings → Project Context**.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron UI                          │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐            │
│  │ Sidebar │  │Terminal  │  │Milestone    │            │
│  │         │  │Grid      │  │Inbox        │            │
│  └─────────┘  └──────────┘  └─────────────┘            │
└────────────────────┬────────────────────────────────────┘
                     │ IPC (WebSocket)
┌────────────────────▼────────────────────────────────────┐
│              Bun Backend (port 3000/3001)               │
│  ┌──────────────┐  ┌────────────┐  ┌───────────────┐   │
│  │ IPC Handlers │  │ PTY Manager│  │Project Context│   │
│  │              │  │(node-pty)  │  │   Storage     │   │
│  └──────────────┘  └────────────┘  └───────────────┘   │
│  ┌──────────────┐  ┌──────────────────────────────┐    │
│  │ Milestone    │  │ Temporal Sidecar Lifecycle   │    │
│  │ Service      │  │ (port 7466/7467)            │    │
│  └──────────────┘  └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Temporal Worker (Bun)                     │
│  ┌──────────────────────────────────────────────────┐  │
│  │          Autopilot Workflow (9-phase)            │  │
│  │  researchRepo → debateFeatures → generateTickets │  │
│  │  → scopeArchitecture → implementCode → review   │  │
│  │  → testCode → pushChanges                        │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Activities (9 agent implementations)  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Running Locally

```bash
# Install dependencies
make install

# Start backend + frontend (worker runs separately)
make backend   # Terminal 1: Bun API server on :3000, Milestone API on :3001, Temporal on :7466/:7467
make worker    # Terminal 2: Bun Temporal worker on atelier-default-ts
make frontend  # Terminal 3: Vite dev server on :5173

# Or run Electron directly
./node_modules/.bin/electron .
```

## Requirements

- [Bun](https://bun.sh) runtime
- [MiniMax API key](https://platform.minimax.chat) — configure in Settings

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Electron 34 |
| Frontend | React 18 + TypeScript + Vite |
| Backend | Bun + better-sqlite3 |
| Orchestration | Temporal (Go server + Bun worker) |
| Agents | Claude Code CLI + MiniMax API |
| Terminals | node-pty + xterm.js |
| IPC | WebSocket bridge |
