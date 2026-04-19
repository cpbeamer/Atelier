# Atelier — Product Spec Sheet (v2)

**Name:** Atelier
**Date:** 2026-04-18
**Author:** Cary Beam
**Status:** Draft v2 — four key decisions locked
**Type:** Standalone cross-platform desktop application
**License:** Business Source License (BSL) 1.1 — see Section 19

> **Name notes:** "Atelier" — French for "workshop" or "studio." Distinctive in the dev-tool space, evokes craft + small-team environment. Possible considerations: pronunciation ("ah-tel-yay") may trip non-French speakers; "Atelier" is also a long-running JRPG series by Koei Tecmo (different category, low likelihood of trademark conflict in software). Recommend domain check (`atelier.dev`, `useatelier.app`, `atelier-agents.com`) and a quick USPTO TESS search for software-class registrations before public release.

## v2 Decisions Locked

| # | Decision | Implication |
|---|---|---|
| 1 | **Name: Atelier** | Apply throughout. Trademark/domain due diligence recommended. |
| 2 | **License: BSL 1.1** | Source-available; production use of competing managed services restricted. Converts to Apache 2.0 after 4-year change date. See Section 19. |
| 3 | **Bundled Temporal: Binary** | Use the official Temporal CLI's embedded dev server (`temporal server start-dev`) — single binary, SQLite-backed, no Docker dependency. Replaces the v1 Docker Compose plan in Section 13.4. |
| 4 | **Workflow language: TypeScript + Python** | Two workers (one per SDK) co-existing on same Temporal server, routed by task queue. Workflow files distinguished by extension (`.ts` / `.py`). Atelier bundles both Bun and a Python runtime (uv-managed). See Section 13.8. |

---

## 1. One-Line Pitch

> **A local-first desktop control panel for running fully autonomous, durable, multi-agent software-engineering workflows across any project — backed by Temporal, fronted by live Claude Code terminals you can watch work.**

---

## 2. Vision

Atelier turns "I should set up an autonomous coding system" from a 3-month engineering project into a 5-minute install. It is the first desktop-native, repo-agnostic orchestrator for multi-agent dev workflows that:

- Runs **100% locally** on the user's machine — no cloud, no telemetry, no SaaS
- Works against **any project repository** (open it, point at the dir, go)
- Uses **Temporal** for durable, resumable, observable workflows — survives crashes, restarts, sleep mode
- **Manages Claude Code terminals** as live agents the user can watch in real-time
- Supports **any LLM provider** (Anthropic, MiniMax, OpenAI-compatible, OpenRouter, Ollama) per agent
- **Fully customizable**: agents, workflows, schedules, milestones — all defined as code or via UI

---

## 3. Target User

**Primary persona — the "AI-native indie/solo developer":**
- Builds multiple side projects or contracts simultaneously
- Comfortable with CLI, Docker, Bun/Node, git
- Has API access to multiple LLM providers (uses MiniMax giga plan + Anthropic credits + maybe OpenRouter)
- Wants agents to do real work overnight / during work hours so they can context-switch
- Has been frustrated with: Claude Code single-session limits, lack of multi-agent coordination, no autonomous scheduling, no human-in-the-loop gates

**Secondary persona — the "dev team automation lead":**
- 1-engineer-equivalent of "DevX/internal tools" inside a startup
- Wants to deploy autonomous coding to teammates without each setting up SCION/Temporal/MiniMax themselves
- Atelier as their distribution mechanism

**Out of scope persona:**
- Pure non-developers (this requires git/CLI fluency)
- Cloud-only / "I want it as a managed SaaS" users (use OpenHands Cloud or Cursor)

---

## 4. Problem Statement

Today, a developer who wants autonomous multi-agent coding has three options, all bad:

| Option | Problem |
|---|---|
| Claude Code interactive | Single session, single agent, requires user present, can't trigger autonomously |
| OpenHands | One agent at a time; no native multi-agent counterpart pattern; no scheduling; cloud-coupled UI |
| Build your own (Temporal + custom) | 2–4 weeks of focused engineering before you can run one workflow |

There is no shrink-wrapped product that gives you: durable multi-agent workflows + visible Claude Code terminals + custom LLM per agent + repo-agnostic + scheduling + human gates + local-first.

Atelier is that product.

---

## 5. Core Value Propositions

1. **Watch your agents work.** Every Claude Code agent runs in a real PTY whose output streams to a terminal pane in the app. You can see what's happening, intervene, take over.
2. **Crashes don't lose work.** Temporal makes every workflow durable. Close the laptop, reopen tomorrow, the workflow resumes from the last completed step.
3. **Mix expensive and cheap models.** High-stakes agents (Code Writer) use Claude. Background validators use MiniMax. All in the same workflow.
4. **Three-line setup per project.** Open project → pick a workflow template → click Run.
5. **Adversarial-by-default.** Every specialist agent has a counterpart validator built into the workflow primitives. No proposal reaches you without being torn apart first.
6. **Schedules that actually work.** Cron-like triggers via Temporal Schedules — survives restarts, idempotent, observable.
7. **Permission-free agents, sandbox-safe.** `--dangerously-skip-permissions` is enabled by default — but every agent runs inside an isolated git worktree, so worst case the worktree gets nuked and your m## 6. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Atelier Desktop App (Electron — Node.js main + React renderer)          │
│                                                                            │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Frontend (React + TypeScript + xterm.js + Tailwind)                   │ │
│ │  - Sidebar:    projects, workflows, runs                              │ │
│ │  - Main pane:  terminal grid (xterm panes), workflow graph, run logs  │ │
│ │  - Inbox:      pending milestones, escalations                        │ │
│ │  - Settings:   LLM providers, secrets, schedules                      │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                  ↕ Electron IPC / WebSocket                │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Bun Orchestrator (Backend)                                             │ │
│ │  - Process spawning (incl. WSL on Windows)                             │ │
│ │  - PTY management (node-pty)                                           │ │
│ │  - File system access (project root, .atelier/ config)               │ │
│ │  - Secrets storage (OS keychain via node-keytar)                       │ │
│ │  - Sidecar lifecycle: starts/stops Temporal stack                      │ │
│ │  - Workflow registration and activity dispatching                      │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                  ↕                                         │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Sidecar Processes (lifecycle managed by Bun)                          │ │
│ │                                                                        │ │
│ │ ┌──────────────────────────┐                                           │ │
│ │ │ Temporal stack (Binary)   │                                           │ │
│ │ │  - temporal :7466 gRPC    │←──────────────────────────────────────┐  │ │
│ │ │  - temporal-ui :8466 web  │                                       │  │ │
│ │ │   (SQLite-backed)         │                                       │  │ │
│ │ └──────────────────────────┘                                       │  │ │
│ │                                                                    │  │ │
│ │ ┌──────────────────────────────────────────────────────────────────┴┐ │ │
│ │ │ Agent Processes (one per active agent in a workflow)              │ │ │
│ │ │                                                                    │ │ │
│ │ │ Type A — Claude Code Terminal Agents (visible):                   │ │ │
│ │ │   wsl claude --dangerously-skip-permissions                        │ │ │
│ │ │     -p "<persona> + <task>"                                        │ │ │
│ │ │   PTY (node-pty) → streamed to xterm.js pane in UI                 │ │ │
│ │ │   Workdir = git worktree under project                             │ │ │
│ │ │                                                                    │ │ │
│ │ │ Type B — Direct LLM Agents (background):                          │ │ │
│ │ │   In-process call to provider (MiniMax / OpenAI / Anthropic SDK)  │ │ │
│ │ │   Output → log pane, no PTY                                        │ │ │
│ │ └──────────────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```
t task queue           │ │ │
│ │                                 └────────────────────────────────────┘ │ │
│ │                                                                        │ │
│ │ ┌──────────────────────────────────────────────────────────────────┐ │ │
│ │ │ Agent Processes (one per active agent in a workflow)              │ │ │
│ │ │                                                                    │ │ │
│ │ │ Type A — Claude Code Terminal Agents (visible):                   │ │ │
│ │ │   wsl claude --dangerously-skip-permissions                        │ │ │
│ │ │     -p "<persona> + <task>"                                        │ │ │
│ │ │   PTY → streamed to xterm.js pane in UI                            │ │ │
│ │ │   Workdir = git worktree under project                             │ │ │
│ │ │                                                                    │ │ │
│ │ │ Type B — Direct LLM Agents (background):                          │ │ │
│ │ │   In-process call to provider (MiniMax / OpenAI / Anthropic SDK)  │ │ │
│ │ │   Output → log pane, no PTY                                        │ │ │
│ │ └──────────────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                     ↕
┌──────────────────────────────────────────────────────────────────────────┐
│ User's Project Repository (any path on disk)                              │
│  e.g., C:\dev\Strata\, /Users/cary/dev/sideproject/                       │
│                                                                            │
│ .atelier/                       (project-local config, gitignored OR     │
│  ├── config.toml                   committed depending on user choice)     │
│  ├── agents/                                                                │
│  │   ├── pm-specialist.md          (markdown personas, Claude Code-format) │
│  │   ├── pm-validator.md                                                    │
│  │   └── ...                                                                │
│  ├── workflows/                                                             │
│  │   ├── feature.workflow.ts       (TypeScript workflow definitions)       │
│  │   └── pm-validation.workflow.ts                                          │
│  ├── schedules.toml                (cron triggers)                          │
│  └── runs/                          (run history, audit logs)               │
│                                                                            │
│ .git/                                                                      │
│ src/, package.json, etc.                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Desktop framework** | **Electron** | Unified Node.js environment; matches `AW_Analyst` pattern; no Rust compiler required |
| **Backend Orchestrator** | **Bun** | Ultra-fast JS runtime; built-in shell/process APIs; unified with workflow language |
| **Frontend** | React 19 + TypeScript + Vite | User's existing skillset; largest ecosystem |
| **UI components** | shadcn/ui + Tailwind CSS 4 | Consistent with modern stack; copy-paste components |
| **Terminal rendering** | xterm.js + xterm-addon-fit + xterm-addon-web-links | Industry standard; ANSI colors; clickable links |
| **PTY** | **node-pty** | Industry standard for Node; powers VS Code's terminal |
| **Workflow engine** | Temporal 1.25 server (single binary, embedded dev mode) | Durable workflows; signals; schedules; battle-tested. Bundled via the official `temporal` CLI. |
| **TS worker runtime** | Bun + @temporalio/worker (^1.11) | Fast startup; unified with orchestrator |
| **Python worker runtime** | uv-managed venv + temporalio (Python SDK ^1.8) | Per-project isolated venv; uv resolves deps in seconds |
| **Local DB** | SQLite via better-sqlite3 | Zero-config; embedded; sufficient for single-user state |
| **Secrets storage** | **node-keytar** | Access to OS keychain (Win Credential Mgr / Keychain) |
| **LLM SDK** | openai + @anthropic-ai/sdk | Covers MiniMax, OpenRouter, OpenAI, etc. |
| **WSL invocation** | `bun $` or `child_process.spawn` | Native Windows invocation via Bun's shell APIs |
| **Telemetry** | None | Local-first product. Crash reports opt-in only. |

---

## 8. Feature Catalog

### 8.1 Project Management

- **Add project:** Pick a folder → Atelier creates `.atelier/` if missing → adds to sidebar
- **Switch project:** One-click in sidebar; remembers last-active per project
- **Project settings:**
  - Default LLM provider per agent type
  - Worktree base directory (default `~/.atelier/worktrees/<project>/<run-id>/`)
  - Max concurrent runs
  - Cost budget (USD/day) — pauses workflows above limit
- **Per-project state isolation:** Each project gets its own Temporal namespace (`atelier-<project-slug>`)

### 8.2 Agent Library

- **Persona format:** Claude Code-compatible `.md` with frontmatter (`name`, `description`, `color`, etc.) + body system prompt
- **Sources:**
  - Bundled built-ins (PM Specialist, PM Validator, Architect, Code Writer, etc.)
  - Project-local: `.atelier/agents/*.md` (committable to git)
  - User-global: `~/.atelier/agents/*.md` (cross-project)
  - Import from Claude Code: scan `.claude/agents/` and offer to copy
- **Agent types:**
  - **Terminal:** Spawns Claude Code in WSL/native shell, PTY visible in UI
  - **Direct LLM:** In-process LLM call, output as text log
- **Per-agent config:** Provider override, model override, temperature, max tokens, timeout, retry policy

### 8.3 Workflow Engine — Multi-Language

Atelier supports workflows written in **TypeScript** OR **Python**. Both run on the same Temporal server, dispatched to different workers via task queue routing.

| File extension | Worker | Task queue | SDK |
|---|---|---|---|
| `*.workflow.ts` | Bun TS worker | `atelier-{project}-ts` | `@temporalio/worker` |
| `*.workflow.py` | Python worker (uv venv) | `atelier-{project}-py` | `temporalio` |

When the user clicks **Run**, Atelier inspects the workflow file, identifies the language, and dispatches to the matching task queue. Both workers can call into the **same agent personas** and the **same LLM provider config** — only the workflow definition language differs.

**TypeScript example** (`.atelier/workflows/feature.workflow.ts`):

```ts
import { defineWorkflow, callAgent, milestone } from '@atelier/workflow';
import { z } from 'zod';

export const featureWorkflow = defineWorkflow({
  name: 'feature',
  input: z.object({ signal: z.string() }),
  run: async (ctx, input) => {
    const proposal = await callAgent(ctx, 'PM Specialist', { signal: input.signal });
    const verdict = await callAgent(ctx, 'PM Validator', { proposal });
    if (verdict.verdict !== 'Approved') return { status: 'rejected', verdict };

    await milestone(ctx, 'PM Proposal Review', { proposal, verdict });

    const design = await callAgent(ctx, 'Architect', { proposal });
    // ...
  },
});
```

**Python example** (`.atelier/workflows/feature.workflow.py`):

```python
from atelier_workflow import workflow, call_agent, milestone
from pydantic import BaseModel

class FeatureInput(BaseModel):
    signal: str

@workflow.defn
class FeatureWorkflow:
    @workflow.run
    async def run(self, input: FeatureInput):
        proposal = await call_agent("PM Specialist", {"signal": input.signal})
        verdict = await call_agent("PM Validator", {"proposal": proposal})
        if verdict["verdict"] != "Approved":
            return {"status": "rejected", "verdict": verdict}

        await milestone("PM Proposal Review", {"proposal": proposal, "verdict": verdict})

        design = await call_agent("Architect", {"proposal": proposal})
        # ...
```

**Behavior:**
- **Hot-reload:** Each language worker watches its respective files (`*.workflow.ts` for Bun worker, `*.workflow.py` for Python worker). Changes trigger re-registration. Active workflows continue (Temporal preserves state); new tasks pick up new code via Temporal's `patched()` API for safe versioning.
- **Templates:** Bundled starter workflows in BOTH languages — PM-validation, full feature pipeline, code-review only, signal-poll. User picks language at template instantiation.
- **Mixed-language workflows:** ✗ Not supported. A single workflow is either fully TS or fully Python. Cross-language calls happen via Temporal's child-workflow primitive (a TS workflow can `executeChild` a Python workflow on a different task queue, but each workflow runs in one runtime).
- **Visual viewer:** Read-only graph of workflow nodes with current-run progress overlaid (language-agnostic — reads Temporal event history).
- **Visual builder:** ✗ Not in MVP. v3+.

### 8.4 Live Terminal Grid

- **Layout:** Tile-able grid (1×1, 2×2, 1×N, custom)
- **Per-pane:** xterm.js terminal showing live PTY output of one Claude Code agent
- **Interactions:** Click to focus, type to send input (override agent if needed), Cmd+K command palette per pane
- **Inactive agents:** Greyed-out pane with last output preview
- **Detach:** Pop pane out into its own window (multi-monitor support)
- **Recording:** Full PTY output saved to `.atelier/runs/<run-id>/agents/<agent>/output.log`

### 8.5 Human Milestones

- **Milestone types:** Workflow author defines via `milestone(ctx, name, payload)` call
- **Inbox UI:** Sidebar badge with pending count; main pane shows: workflow context, milestone payload, Approve / Reject (with reason) / Defer buttons
- **Approval action:** Sends Temporal signal back to workflow; workflow resumes
- **Notifications:** Native OS notification when a milestone is created (with sound option)
- **Auto-rejection:** Configurable timeout (default 7 days) → workflow auto-fails with `reason: 'milestone-timeout'`

### 8.6 Schedules

- **Format:** `.atelier/schedules.toml`
  ```toml
  [[schedule]]
  id = "nightly-opportunity-poll"
  workflow = "opportunity-poll"
  cron = "0 2 * * *"           # 2 AM daily
  input = { source = "git-todo-scan" }
  overlap = "skip"               # or "queue" / "cancel-previous"
  ```
- **UI:** Schedules tab listing all schedules; pause/resume/edit/delete
- **Backed by Temporal Schedules** (idempotent by ID, survives restarts)

### 8.7 LLM Provider Management

- **Built-in providers:** Anthropic, OpenAI, MiniMax (api.minimax.io + api.minimaxi.com), OpenRouter, Together, Groq, Ollama (local)
- **Custom provider:** User adds OpenAI-compatible base URL + API key + default model
- **Per-agent override:** Agent's `provider` field in config or workflow overrides project default
- **API keys:** Stored in OS keychain via Stronghold; never in plain text
- **Cost tracking:** Per-provider per-day token usage and estimated $ cost (using configurable price-per-1k-tokens)

### 8.8 Secrets Vault

- **Storage:** OS-native keychain (Win Credential Manager, macOS Keychain, libsecret on Linux) via Tauri Stronghold plugin
- **Use cases:** API keys, GitHub tokens, deployment tokens
- **Injection:** Workflows declare which secrets they need; Atelier injects as env vars into the agent process — secrets never appear in workflow code or logs
- **Audit:** Every secret access logged in audit log

### 8.9 Worktree Sandbox

- **Default:** Every workflow run creates a fresh git worktree at `~/.atelier/worktrees/<project>/<run-id>/`
- **Branch:** `atelier/<workflow-name>/<run-id>`
- **Agents work in worktree:** `--dangerously-skip-permissions` only affects worktree files
- **Promotion:** After milestone-3 approval, optional auto-merge to main branch (or push branch + open PR)
- **Cleanup:** Old worktrees auto-pruned after configurable retention (default 7 days)
- **Override:** Power users can set `worktree: false` per workflow to operate on main repo (with big red UI warning)

### 8.10 Run History

- **Per-project run list:** Status, started, duration, milestone outcomes, agent token usage, $ cost
- **Drill-in:** Full event timeline (Temporal event history rendered nicely), per-agent transcripts, per-milestone decisions, final artifact links (PR URL, commit SHA)
- **Export:** Run as JSON for sharing/debugging
- **Replay:** Re-run with same inputs (uses Temporal's reset capabilities)

### 8.11 Observability

- **Bundled Temporal Web UI:** One-click open at `http://127.0.0.1:8466`
- **Atelier's own UI:** Higher-level — focuses on agent transcripts, costs, milestone outcomes
- **Logs:** Structured pino logs from worker; rotated to `~/.atelier/logs/`
- **Metrics:** Token usage / agent / day; workflow success rate; mean time to milestone

---

## 9. User Flows

### Flow 1: First-time setup (cold install)

1. Download installer (`.msi` / `.dmg` / `.deb` / `.AppImage`)
2. Launch → Welcome screen
3. **WSL check** (Windows only): Atelier detects WSL distros, prompts user to pick one (or installs Ubuntu if none)
4. **Claude Code check**: Atelier checks `wsl which claude` → if missing, links to install instructions
5. **First LLM provider:** Wizard prompts for at least one provider:
   - "Paste your Anthropic API key" or "Skip if using OAuth"
   - Test call: "Verifying connection... ✓"
6. **First project:** "Open a project folder" → file picker → Atelier scaffolds `.atelier/` with starter templates
7. Lands on the project's home view with a "Run starter workflow" CTA

### Flow 2: Run a workflow manually

1. Select project from sidebar
2. Click "Workflows" tab → see list
3. Click "feature" → input form (auto-generated from workflow's input schema)
4. Fill: signal = "Add rate limiting to /api/auth"
5. Click Run
6. UI switches to the **Live Run view**:
   - Top: workflow graph with current node highlighted
   - Middle: terminal grid — PM Specialist's Claude Code session animates
   - Bottom: log stream
7. After ~2 min, PM Validator's terminal lights up next to it (parallel pane)
8. After 5 min, **milestone notification** in OS notification center
9. Click notification → Atelier focuses on milestone inbox → review proposal → Approve
10. Workflow resumes; Architect terminal opens
11. Continue through workflow

### Flow 3: Set up an autonomous schedule

1. Workflows → "opportunity-poll" → "Schedule" button
2. UI form: cron expression (with helper: "Every 30 minutes" / "Daily at 2 AM" / etc.)
3. Default input values
4. Save → schedule appears in Schedules tab
5. Schedule fires automatically; runs appear in Runs tab; milestones notify normally

### Flow 4: Cross-project use (the killer feature)

1. Cary works on Strata in the morning — uses Atelier's Strata project
2. Switches to a side project at lunch — clicks "Side Project Y" in sidebar
3. Atelier swaps active project (different Temporal namespace, different agents, different workflows, different secrets)
4. Side project has different agent personas (it's a Rust project, has Rust-specialized agents)
5. Workflows from one project can't accidentally interact with another (namespace isolation)

### Flow 5: Override an agent mid-flight

1. Code Writer agent is doing something dumb — Cary watches it in the terminal pane
2. Click the pane → it focuses
3. Press Cmd+I → "Inject message" — types: "Stop. Use the existing helper at src/utils/foo.ts instead."
4. Message injected into agent's stdin; agent responds; continues
5. Workflow doesn't realize anything happened (Code Writer activity continues; workflow waits for activity completion)

### Flow 6: Recover from a crash

1. Cary's laptop runs out of battery mid-workflow
2. Plugs in, opens Atelier
3. Atelier: "Detected unfinished run [feature/abc-123] — resume?"
4. Click Resume → Tauri starts Temporal stack → worker connects → workflow continues from last completed step
5. Agent terminals re-spawn (or, if the activity completed, just renders the cached output)

---

## 10. Data Model

### SQLite tables (local app DB at `~/.atelier/db/atelier.sqlite`)

```
projects (
  id TEXT PK,
  name TEXT,
  path TEXT UNIQUE,
  created_at INTEGER,
  last_opened_at INTEGER,
  settings_json TEXT
)

llm_providers (
  id TEXT PK,
  name TEXT,
  type TEXT,          -- 'anthropic' | 'openai-compat' | 'minimax' | 'ollama'
  base_url TEXT,
  default_model TEXT,
  api_key_ref TEXT    -- Stronghold key reference, NEVER the actual key
)

agents (
  id TEXT PK,
  project_id TEXT FK,    -- NULL for global agents
  name TEXT,
  source_path TEXT,      -- Path to .md file
  type TEXT,             -- 'terminal' | 'direct-llm'
  provider_id TEXT FK,   -- NULL = use project default
  model TEXT,            -- override; NULL = use provider default
  config_json TEXT,
  UNIQUE(project_id, name)
)

workflow_runs (
  id TEXT PK,
  project_id TEXT FK,
  workflow_name TEXT,
  temporal_workflow_id TEXT UNIQUE,
  temporal_run_id TEXT,
  status TEXT,           -- 'running' | 'completed' | 'failed' | 'terminated' | 'awaiting-milestone'
  worktree_path TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  total_tokens INTEGER,
  total_cost_usd REAL,
  input_json TEXT,
  result_json TEXT
)

milestones (
  id TEXT PK,
  run_id TEXT FK,
  type TEXT,
  status TEXT,           -- 'pending' | 'approved' | 'rejected' | 'timed-out'
  payload_json TEXT,
  created_at INTEGER,
  decided_at INTEGER,
  decided_by TEXT,       -- 'user' | 'auto-timeout'
  decision_reason TEXT
)

terminals (
  id TEXT PK,
  run_id TEXT FK,
  agent_name TEXT,
  pid INTEGER,
  status TEXT,           -- 'running' | 'exited' | 'killed'
  exit_code INTEGER,
  started_at INTEGER,
  exited_at INTEGER,
  output_log_path TEXT
)

schedules (
  id TEXT PK,
  project_id TEXT FK,
  workflow_name TEXT,
  temporal_schedule_id TEXT UNIQUE,
  cron TEXT,
  input_json TEXT,
  overlap_policy TEXT,
  paused INTEGER,
  created_at INTEGER
)

audit_log (
  id INTEGER PK,
  project_id TEXT,
  run_id TEXT,
  agent TEXT,
  event TEXT,
  details_json TEXT,
  created_at INTEGER
)

INDEX idx_runs_project ON workflow_runs(project_id, started_at DESC)
INDEX idx_milestones_pending ON milestones(status) WHERE status='pending'
INDEX idx_audit_run ON audit_log(run_id, created_at)
```

### File-system layout (per project)

```
<project-root>/.atelier/
├── config.toml                 # Project-level config (provider defaults, worktree base)
├── agents/                     # Project-specific personas
│   ├── pm-specialist.md
│   └── code-writer.md
├── workflows/                  # Workflow definitions
│   ├── feature.workflow.ts
│   └── pm-validation.workflow.ts
├── schedules.toml              # Schedule definitions
├── runs/                       # Run history (large; gitignored by default)
│   └── <run-id>/
│       ├── meta.json
│       ├── milestones/<milestone-id>.json
│       └── agents/<agent-name>/output.log
└── .gitignore                  # Auto-generated; ignores runs/ and tmp/
```

### File-system layout (global)

```
~/.atelier/
├── db/atelier.sqlite          # Local DB (Atelier app state)
├── logs/                      # Worker + Temporal logs (rotated)
├── worktrees/                 # Sandboxed working dirs per run
│   └── <project>/<run-id>/
├── agents/                    # User-global agent personas
├── temporal/                  # Bundled Temporal binary + state
│   ├── temporal               # The temporal CLI binary (bundled with app)
│   ├── data/                  # SQLite DB used by `temporal server start-dev`
│   └── logs/                  # Server logs
├── runtimes/                  # Bundled language runtimes
│   ├── bun/bun                # Bundled Bun binary for TS worker
│   └── python/                # Bundled Python (uv-managed venv root)
└── stronghold.vault           # Encrypted secrets store (libstronghold)
```

### Workflow table — language column

The `workflows` registry tracks language so the dispatcher routes to the right task queue:

```
workflows (
  id TEXT PK,
  project_id TEXT FK,
  name TEXT,                 -- 'feature', 'pm-validation', etc.
  language TEXT NOT NULL,    -- 'typescript' | 'python'
  source_path TEXT,
  task_queue TEXT,           -- e.g. 'atelier-strata-ts' or 'atelier-strata-py'
  schema_version INTEGER,
  registered_at INTEGER,
  UNIQUE(project_id, name)
)
```

---

## 11. Security Model

### Threat model

Atelier runs trusted code (the user's workflows + Claude Code) but agents have:
- Full filesystem access (within their worktree)
- Full network access
- Ability to run arbitrary commands (`--dangerously-skip-permissions`)

The blast radius is the worktree. Atelier's job is to keep blast radius small.

### Defenses

| Threat | Mitigation |
|---|---|
| Agent destroys main branch | Default workflow runs in isolated git worktree on an `atelier/...` branch |
| Agent leaks API keys to LLM | Secrets injected as env vars at process spawn; never in workflow code, logs, or transcripts (audit log records *that* a secret was accessed, not the value) |
| Agent makes destructive `git push --force origin main` | Worktree's git config doesn't have a remote configured; user must explicitly enable git push activity |
| Agent runs `rm -rf /` | Runs inside WSL on Windows (subsystem isolation) or restricted user on Mac/Linux. Cannot delete OS files. Worktree-confined for project files. |
| Stolen laptop with API keys in OS keychain | Standard OS-level full-disk encryption (FileVault, BitLocker) is the user's responsibility — same as any other dev tool |
| Workflow code itself is malicious (supply-chain) | User explicitly imports any 3rd-party workflow; bundled workflows are signed by Atelier team |
| Tauri IPC bypass to access arbitrary FS | Tauri's allowlist explicitly restricts which paths the frontend can request; only `.atelier/` and run output paths are exposed |
| Process bomb (workflow spawns 1M agents) | Per-project max-concurrent-agents setting (default 8); cost-budget circuit breaker kills workflows above $X/day |

### `--dangerously-skip-permissions` policy

- Default: ON for terminal agents (the whole point of Atelier)
- Required confirmation: First time per project, modal explains what this does
- Always paired with worktree sandbox UNLESS user explicitly disables sandbox (with red warning)
- Audit log records every command the agent executes (parsed from PTY output where possible)

---

## 12. MVP / v1 / v2 Roadmap

### MVP (v0.1) — "Watch one agent work"

**Goal:** Prove the end-to-end loop. Single workflow, single agent, manually triggered, visible terminal.

- Tauri app shell (Win/Mac/Linux installers)
- Project picker (single project at a time)
- Bundled Temporal stack (auto-start on app launch)
- Bun worker sidecar
- WSL invocation on Windows; native shell on Mac/Linux
- Single terminal pane (xterm.js) showing one Claude Code agent
- Manual workflow trigger via UI
- Workflow definition: hardcoded "run agent X with prompt Y" (single-step)
- Run history: append-only log
- Pause/resume worker
- LLM provider config: Anthropic + MiniMax via env vars

**Effort:** ~3 weeks for one engineer

### v0.5 — "The full workflow"

- Multi-step workflow with `defineWorkflow` DSL
- Multiple agent terminals in tiled grid
- Adversarial counterpart pattern as a workflow primitive
- Human milestone signals + inbox UI
- Multi-project sidebar
- Per-project Temporal namespace isolation
- Worktree sandbox (default ON)
- Run history with drill-in view

**Effort:** +4 weeks

### v1.0 — "Public release"

- Schedules (cron triggers via Temporal Schedules)
- Code review primitive (3-round 5-parallel reviewer pattern)
- LLM provider abstraction (Anthropic, MiniMax, OpenAI, OpenRouter, Ollama, custom)
- Cost tracking dashboard
- OS keychain secrets via Stronghold
- Workflow templates marketplace (bundled starter pack)
- Crash recovery UX (resume on relaunch)
- Logs export
- Documentation site

**Effort:** +6 weeks

### v1.5 — "Power user features"

- Workflow code editor inside app (Monaco)
- Visual workflow viewer (D3 graph)
- Mid-run agent override (inject prompts via UI)
- Multi-monitor terminal pop-out
- Direct LLM agent type (background, no terminal)
- GitHub integration (auto-PR creation, comment posting)

**Effort:** +6 weeks

### v2.0 — "Multi-machine"

- Tailscale-aware: one Atelier as hub, others as workers
- Distribute agents across machines (heavy code-writer on beefy box, lightweight validators on laptop)
- Shared run history via remote SQLite or Postgres backend

**Effort:** +8 weeks

### v3+ — "Marketplace"

- Visual workflow builder (drag-and-drop)
- Public workflow / persona registry
- Team mode (shared projects via Atelier Cloud — opt-in only)
- Plugin system for custom activities

---

## 13. Specific Implementation Notes

### 13.1 WSL invocation on Windows

```rust
// Tauri command
use tauri::api::process::{Command, CommandEvent};

#[tauri::command]
async fn spawn_claude_code(distro: String, persona: String, task: String, workdir_wsl_path: String) -> Result<u32, String> {
    let prompt = format!("{}\n\n---\n\n{}", persona, task);
    let cmd = Command::new("wsl.exe")
        .args(&[
            "-d", &distro,
            "--cd", &workdir_wsl_path,
            "--",
            "bash", "-c",
            &format!("claude --dangerously-skip-permissions -p {}", shell_escape(&prompt)),
        ]);
    // Spawn with PTY
    // ...
}
```

WSL path translation: `C:\Users\Cary\Documents\GitHub\Strata` → `/mnt/c/Users/Cary/Documents/GitHub/Strata` (Tauri helper function).

### 13.2 PTY streaming

- Rust side: `portable-pty` spawns child, captures stdout/stderr as a single PTY stream
- Tauri emits `terminal-output` events to the frontend with `{ terminalId, chunk }`
- Frontend xterm.js instance writes chunk
- Stdin from frontend → IPC → `pty.master.write(bytes)`

### 13.3 Workflow hot-reload

- TS worker watches `.atelier/workflows/*.ts` via chokidar; Python worker watches `*.py` via watchfiles
- On change: terminate the affected worker only (the other language continues), rebuild bundle, restart
- Active workflows continue (Temporal preserves state); new tasks pick up new code
- Versioning: workflow code uses Temporal's `patched()` API (TS) / `workflow.patched()` (Python) for backward compatibility across edits

### 13.4 Bundling Temporal — Binary Approach (Decision #3)

**Decision:** Bundle the official Temporal CLI binary; use its embedded dev server. No Docker dependency.

The Temporal CLI (https://github.com/temporalio/cli) ships a single ~80MB Go binary that includes:
- Temporal server
- A SQLite-backed persistence layer (sufficient for single-user local use)
- The Web UI on port 8233 by default
- Namespace, workflow, schedule, and operator commands

**Atelier launches it as a sidecar:**

```rust
// Tauri sidecar definition (tauri.conf.json)
{
  "bundle": {
    "externalBin": ["binaries/temporal"]
  }
}
```

```rust
// On app startup
use tauri::api::process::Command;

let temporal_data_dir = app.path_resolver().app_data_dir().unwrap().join("temporal/data");
std::fs::create_dir_all(&temporal_data_dir)?;

let (mut rx, child) = Command::new_sidecar("temporal")?
    .args(&[
        "server", "start-dev",
        "--db-filename", temporal_data_dir.join("atelier.db").to_str().unwrap(),
        "--port", "7466",         // gRPC — Atelier uses non-default to avoid clashing with user's other Temporal installs
        "--http-port", "7467",
        "--ui-port", "8466",
        "--namespace", "atelier",  // pre-create the default namespace
        "--log-level", "warn",
    ])
    .spawn()?;

// Stream stdout/stderr to ~/.atelier/temporal/logs/
// Wait for "Temporal server is up" health log line before connecting workers
```

**Per-OS binary procurement** (build-time):
- Download from `https://github.com/temporalio/cli/releases` for `darwin-arm64`, `darwin-amd64`, `linux-amd64`, `windows-amd64`
- Check SHA256 against the upstream release manifest
- Codesign on macOS (Tauri handles this when bundling)
- Total app size impact: ~80MB per platform (Tauri's per-platform bundles, so user only downloads their OS)

**Per-project namespace isolation:** Atelier creates a Temporal namespace per project on first run via the SDK, scoped as `atelier-{project-slug}`. All that project's workflows/schedules live in that namespace.

**Operator access for power users:** Atelier exposes a "Open Temporal UI" button in settings that just opens `http://127.0.0.1:8466` — gives users the full upstream UI for low-level debugging.

### 13.5 LLM provider abstraction

```ts
interface LLMProvider {
  name: string;
  call(req: { system: string; user: string; model?: string; jsonMode?: boolean; temperature?: number }): Promise<{ content: string; usage: TokenUsage }>;
}

class OpenAICompatibleProvider implements LLMProvider { /* ... */ }  // covers MiniMax, OpenAI, Together, Groq, OpenRouter
class AnthropicProvider implements LLMProvider { /* ... */ }
class OllamaProvider implements LLMProvider { /* ... */ }
```

Mirror in Python via `atelier_workflow.providers` module (same provider ID and config). Per-provider config at `~/.atelier/db/atelier.sqlite::llm_providers`. API keys at OS keychain via Stronghold.

### 13.6 Milestone signal mechanics

```ts
// Inside workflow (TS):
const decision = await milestone(ctx, 'pm-proposal', { proposal, verdict });
// decision: { approved: boolean; reason?: string; decidedBy: string; decidedAt: Date }
```

```python
# Inside workflow (Python):
decision = await milestone("pm-proposal", {"proposal": proposal, "verdict": verdict})
# decision: dict with same shape
```

Implementation in both runtimes: defines a Temporal signal `milestone-decision`, records pending milestone in app DB, sends OS notification, blocks on `condition()` with explicit predicate (no `|| 'truthy-string'` bug — see anti-patterns from prior Strata plan). UI's Approve button calls a Tauri command that uses `@temporalio/client` to send the signal.

### 13.7 Cost tracking

- Each LLM call records prompt + completion tokens
- Per-provider config has `pricing: { promptUsdPer1M: number; completionUsdPer1M: number }`
- Worker emits `usage` events to UI; UI aggregates in real-time
- Daily budget enforced: if `today_usd > budget` → workflow paused with milestone

### 13.8 Python Worker Architecture (Decision #4)

**Goal:** First-class Python workflow support alongside TypeScript, no Python knowledge required from non-Python users.

**Runtime:** Atelier bundles `uv` (the fast Python package manager from Astral). On first project use, Atelier creates a project-local venv at `<project-root>/.atelier/.venv-py` and installs:

```
temporalio>=1.8
pydantic>=2.0
atelier-workflow  # PyPI package — Atelier's Python SDK shim (call_agent, milestone, etc.)
```

Plus any deps the user declares in `.atelier/python-requirements.txt`.

**Worker process:** Atelier spawns one Python worker per project on demand, equivalent to the TS worker. The Python worker:
- Connects to the same local Temporal server (`127.0.0.1:7466`)
- Listens on task queue `atelier-{project}-py`
- Auto-discovers and registers all `.workflow.py` files in `.atelier/workflows/`
- Auto-discovers and registers all `.activity.py` files in `.atelier/activities/`

**Cross-language consistency:** Atelier's Python SDK (`atelier_workflow`) provides the same primitives as the TS SDK:
- `call_agent(name, input)` → invokes an agent (terminal or direct LLM)
- `milestone(name, payload)` → blocks until human decision
- `child_workflow(name, args)` → can call workflows in either language

**Why uv (not pip/conda):** uv resolves and installs deps in seconds (vs minutes for pip/conda); ships as a single binary itself; no system Python required (uv can install its own); reproducible via `uv.lock`.

**Distribution size impact:** uv binary ~25MB per OS; bundled CPython ~30MB. Total Python addition: ~55MB on top of the base Atelier app. Lazy-loaded — Python runtime only initializes when a project actually has `.workflow.py` files.

### 13.9 Workflow language router

The dispatcher (`src-tauri/src/workflow_dispatch.rs`) is the single seam that handles language routing:

```rust
async fn trigger_workflow(project_id: &str, workflow_name: &str, input: serde_json::Value) -> Result<RunId> {
    let wf = registry.lookup(project_id, workflow_name)?;
    let task_queue = match wf.language.as_str() {
        "typescript" => format!("atelier-{}-ts", project_id),
        "python"     => format!("atelier-{}-py", project_id),
        other => return Err(format!("Unknown workflow language: {}", other).into()),
    };
    let client = temporal_client(project_id).await?;
    let handle = client.start_workflow(&wf.name, &task_queue, input).await?;
    Ok(handle.run_id)
}
```

This is the only place language ever matters — UI is language-agnostic, the dispatcher routes, and the rest of the system uses Temporal's neutral protobuf format.

---

## 14. Out of Scope (explicit non-goals)

- **Cloud-hosted SaaS.** Local-first only. Not a Render/Railway/Vercel competitor.
- **Mobile app.** Desktop only.
- **Real-time collaborative editing.** Single-user app; multi-user comes via Tailscale federation in v2, not Google Docs-style collab.
- **Replace Claude Code.** Atelier *manages* Claude Code, doesn't reimplement it. If Anthropic ships a feature, users get it via the Claude Code binary.
- **Replace Temporal.** Atelier uses Temporal as-is. Power users can attach Temporal Web UI for low-level debugging.
- **General-purpose workflow tool.** Not n8n or Zapier. Specifically for multi-agent coding workflows.
- **Build LLM models.** Ships only as a client; user brings their own API keys / Ollama models.

---

## 15. Open Questions (still to resolve)

**RESOLVED in v2:**
- ~~Name~~ → Atelier
- ~~License~~ → BSL 1.1 (see Section 19)
- ~~Bundled Temporal~~ → Single binary (Section 13.4)
- ~~Workflow language~~ → TypeScript + Python (Section 13.8)

**STILL OPEN:**

1. **Distribution channel.** GitHub Releases (free, manual install), signed/notarized installers (Apple Dev cert $99/yr + Win code signing $200-500/yr), Tauri's auto-updater (recommended), or platform stores (Mac App Store / Microsoft Store)? **Recommendation:** GitHub Releases + Tauri auto-updater for v1; revisit stores for v2.
2. **Windows-only WSL or also native PowerShell?** WSL gives Linux semantics (matches Mac/Linux); PowerShell is broader Windows compat but agent code becomes shell-dialect-dependent. **Recommendation:** WSL-required on Windows for v1, document clearly. PowerShell is a v2 stretch goal.
3. **Should `.atelier/` be gitignored by default?** Pro: keeps repo clean. Con: team can't share agent setups via git. **Recommendation:** auto-write a `.gitignore` inside `.atelier/` that ignores `runs/` and `.venv-py/` only; commit `agents/`, `workflows/`, `config.toml`, `python-requirements.txt`, `schedules.toml`.
4. **Auth for workflow code execution.** Workflow `.ts` / `.py` runs in the worker process with full system access. If user installs a malicious workflow, they're owned. **Recommendation:** warn on first run of any new workflow file (show diff vs last-seen content); signed registry for v3 marketplace.
5. **Built-in agent persona pack.** Which 12 agents ship in MVP? Default proposal: PM Specialist + PM Validator + Architect + Architecture Reviewer + Code Writer + Code Reviewer + Tester + Test Reviewer + Ticket Maker + Ticket Validator + Coordinator + Workflow Auditor (port from Strata's existing personas). User can edit/extend per-project.
6. **MiniMax API endpoint default.** Detect from API key prefix at setup, OR ask user explicitly. **Recommendation:** explicit dropdown in onboarding wizard ("Are you using the global or China endpoint?"); store choice in provider config.
7. **Built-in agent personas: ship as one canonical set, or as separate "packs"?** E.g., "Web App Pack" (PM/Architect/CodeWriter/Tester) vs "Research Pack" (different personas). MVP: ship one canonical pack; add packs in v1.5.
8. **Telemetry.** Hard "no telemetry" or opt-in anonymous crash reports (Sentry self-hosted)? **Recommendation:** opt-in only, off-by-default, very visible toggle in settings.
9. **MVP feature toggle for power-user mode.** Should `--dangerously-skip-permissions` be the only mode, or also a "supervised mode" that defaults to permission prompts? **Recommendation:** `--dangerously-skip-permissions` is the default and primary mode (the whole point of Atelier); supervised mode is a deferred v2 stretch.

---

## 16. Success Metrics (post-launch)

- **Activation:** % of installs that complete one full workflow run within 24h
- **Retention:** % of installs running a workflow weekly after 30 days
- **Workflow completion rate:** % of started runs that complete successfully (excluding user-cancelled)
- **Mean cost per run:** USD spent per completed feature workflow (target: < $5 for typical features)
- **Crash-recovery success:** % of resumed workflows that complete vs total resumed (target: > 95%)
- **Cross-project usage:** Median # of distinct projects per active user (signal of "killer feature" fit)

---

## 17. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic changes Claude Code CLI flags / output format | Medium | High | Adapter layer between worker and Claude Code; CI runs against latest Claude Code weekly; pin known-good version |
| Tauri 2 breaking changes | Low | Medium | Pin Tauri version; test upgrades in staging branch |
| MiniMax API quota / availability | Medium | Medium | Provider abstraction means user can swap to OpenAI/OpenRouter without workflow changes |
| Temporal CLI dev server unsuitable for "production" workloads | Medium | Medium | Atelier is local-only by design; for v2 multi-machine mode we swap to a real Temporal cluster (Postgres + ES) — abstraction layer in dispatcher already accommodates this |
| Bundled Python runtime conflicts with user's system Python | Low | Low | uv-managed venvs are fully isolated; users never see Atelier's Python in their PATH |
| Workflow hot-reload corrupts in-flight runs | Medium | High | Use Temporal's `patched()` API; make hot-reload opt-in for prod-style projects |
| Users don't understand `--dangerously-skip-permissions` | High | High | Onboarding modal explains; default to worktree sandbox; audit log of every shell command |
| TS+Python doubles maintenance burden | High | Medium | Shared schema definitions in JSON Schema; both SDKs consume the same provider/agent config; keep Atelier-specific shim packages thin |
| BSL license confuses contributors | Medium | Medium | Add a CONTRIBUTING.md with a clear FAQ: "personal use unrestricted; selling Atelier-as-a-service requires commercial license; converts to Apache 2.0 in 4 years" |
| Adoption blocked by "yet another tool" fatigue | High | High | Killer demo: 5-min video of agents working overnight; comparison vs OpenHands; emphasize unique features (multi-agent counterparts, milestones) |
| Maintenance burden on solo dev | High | High | Strict scope discipline; out-of-scope list above; community contributions via plugin system in v2 |

---

## 18. Name Decision

**Decision: Atelier**

Rationale:
- French for "workshop" — evokes an artisan studio where multiple craftspeople (agents) work on parts of the same piece
- Distinctive in the dev-tool space (no direct competitor; rejected "Forge" due to saturation incl. direct competitor Forge Code)
- Implies care, craft, small-team feel — matches the local-first, single-user product philosophy
- Pronounceable (~"ah-tel-yay") even if unfamiliar; aligns with established design-tool aesthetic (e.g. Atelier IDE themes, Atelier-branded design products)

**Pre-launch due diligence checklist:**
- [ ] USPTO TESS search for "ATELIER" in International Class 9 (software) — verify no blocking registrations
- [ ] Domain check: `atelier.dev`, `useatelier.app`, `atelier-agents.com`, `getatelier.app`
- [ ] GitHub org availability: `atelier-app`, `atelier-agents`, `useatelier`
- [ ] npm scope availability: `@atelier`, `@atelier-app`
- [ ] PyPI name availability: `atelier`, `atelier-workflow`
| **Crew** | Multi-agent | Conflict with CrewAI |
| **Loom** | Weaving threads of work; poetic | Conflict with Loom (video tool) |
| **Concourse** | "A place where many flows meet" | Conflict with Concourse CI |
| **Director** | Clear role | Generic |

(Earlier candidates considered: Conductor, Maestro, Forge, Cohort, Helm, Pylon, Crew, Loom, Concourse, Director — Atelier won on distinctiveness.)

---

## 19. License — Business Source License 1.1

**Decision: BSL 1.1** — source-available, with one specific commercial restriction.

### Why BSL (not MIT/Apache/AGPL)

| Option | Why considered | Why rejected |
|---|---|---|
| MIT | Maximum permissive | A future SaaS competitor could fork Atelier and host it as "Atelier Cloud" with zero contribution back — exact failure mode HashiCorp/Elastic/MongoDB hit |
| Apache 2.0 | Patent grant added | Same SaaS-resale risk as MIT |
| AGPL | Forces source release of derivative SaaS | Scares off corporate users who can't legally adopt AGPL software; kills enterprise adoption |
| **BSL 1.1** | Source-available; restricts ONE thing (competing managed services); converts to OSS after change date | Best of both — open enough for users + contributors, protected enough to prevent commercial freeloading |

### BSL terms (proposed parameters)

```
Licensor:           Cary Beam (or Atelier Inc., if formed)
Licensed Work:      Atelier (the desktop application)
Additional Use Grant: You may make production use of the Licensed Work, provided
                      that you do not offer the Licensed Work to third parties on
                      a hosted or embedded basis to provide a managed agentic
                      orchestration service that competes with any commercial
                      Atelier offering.
Change Date:        2030-01-01 (4 years from public v1.0 launch)
Change License:     Apache License, Version 2.0
```

**What this means in plain English:**

| User | Allowed? |
|---|---|
| Solo dev runs Atelier on their laptop | ✓ Yes — unrestricted |
| Company runs Atelier internally for their dev team | ✓ Yes — unrestricted (this is "production use" but not a competing service) |
| Open-source contributor forks Atelier to fix a bug | ✓ Yes — under BSL terms |
| Cloud company (e.g. AWS, GCP, Render) offers "Managed Atelier" as a paid product | ✗ No — needs commercial license from Cary |
| 4 years after launch, anyone forks Atelier under Apache 2.0 | ✓ Yes — change date triggers conversion |

### Practical setup

- `LICENSE` file at repo root contains BSL 1.1 text with the parameters above
- Each source file gets a header: `// SPDX-License-Identifier: BUSL-1.1`
- `CONTRIBUTING.md` has a one-paragraph FAQ explaining the license
- Public-facing README has a one-line "Atelier is source-available under BSL 1.1; converts to Apache 2.0 in 2030"
- A separate commercial license document for enterprise/SaaS users — not needed for v1, draft when first inquiry arrives

### License compliance touchpoints in the product

- Atelier itself enforces nothing in code (unlike Pro/Enterprise gating). The license is an honor-system + legal floor.
- Atelier's bundled Temporal CLI is MIT-licensed (compatible)
- Atelier's bundled Bun is MIT-licensed (compatible)
- Atelier's bundled CPython is PSFL (compatible)
- Atelier's bundled uv is Apache 2.0 + MIT dual (compatible)
- Run `cargo deny` / `npm-license-check` in CI to catch license incompatibilities in deps

---

## 20. Next Steps

1. ~~Pick name~~ → Atelier
2. ~~Pick license~~ → BSL 1.1
3. **Trademark/domain due diligence** (per Section 18 checklist) — do this BEFORE writing the MVP plan if you want to lock the name; otherwise treat the name as provisional
4. **Resolve open questions** in Section 15 (9 remaining; 6 have recommendations)
5. **Spin up new repo** separate from Strata: `cpbeamer/atelier` (or `atelier-app/atelier` if you create an org)
6. **Write MVP implementation plan** following this spec — translate Section 12's MVP scope into phased tasks (similar structure to the Strata agent-company plan that just got reviewed)
7. **Decide build cadence**: hobby weekends (~4–5 months to v1, given TS+Python doubled scope) vs focused sprint (~3 months to v1)
8. **Validate with one external user** before v1.0 to test the cross-project use case
9. **Decide whether to keep Strata's `agent-company` plan as a parallel track** — it could be a useful "dogfood" of Atelier (Strata's autonomous workflows ARE the first real Atelier project) OR it could be paused and Strata becomes Atelier's first user later
