# Agent CLI Runtimes

Atelier now selects an agent runtime by id instead of a single `useOpencode`
boolean. The runtime controls how implementation agents get tool access inside
the run worktree.

## Built-in runtimes

- `opencode` — default. Starts a per-run `opencode serve`, uses SDK sessions,
  writes `opencode.json`, and records token/cost telemetry when available.
- `claude-code` — runs `claude --dangerously-skip-permissions -p <prompt>` as a
  PTY in the worktree. It captures exit status and changed files, but does not
  provide structured session telemetry.
- `direct-llm` — legacy fallback. Calls the configured model directly and
  applies `BEGIN FILE` / `END FILE` edit blocks.

## Settings and compatibility

The selected runtime is stored in `app_settings.agentRuntime` as one of
`opencode`, `claude-code`, or `direct-llm`.

Older `useOpencode` settings are migrated lazily:

- `useOpencode=true` -> `agentRuntime=opencode`
- `useOpencode=false` -> `agentRuntime=direct-llm`

The old `settings.useOpencode:*` IPC handlers and `/api/settings/useOpencode`
HTTP endpoints remain as compatibility shims.

## Adding another CLI

Add a runtime id to the backend and worker runtime registries, expose its
binary in preflight, then implement a worker adapter with the same high-level
behavior as `worker/src/llm/cliAgent.ts`: build the prompt, spawn the CLI in the
worktree, poll status, and diff changed files against the starting `HEAD`.
