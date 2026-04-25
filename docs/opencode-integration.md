# opencode Integration

The autopilot's `implementCode` activity can run via [opencode](https://opencode.ai) instead of one-shot LLM dictation. opencode is a tool-using CLI agent — it can Read, Edit, Bash, and Grep against the worktree, so the implementer iterates against real repo state instead of hallucinating files.

This is the path Atelier originally took (commit `052d0ae`, "autonomous autopilot via claude CLI + real git worktree"). The transition swaps `claude` for `opencode` so we can keep MiniMax as the cheap-cost provider while regaining real tools.

## Install

```bash
npm install -g opencode-ai
```

Verify:

```bash
opencode --version
```

The worker probes `opencode --version` at boot. If it's not on PATH, the worker logs a warning and the autopilot falls back to the legacy direct-LLM path — nothing breaks.

## Enable

Set `ATELIER_USE_OPENCODE=1` in the worker's environment to route the implementer through opencode. Unset (or `=0`) to revert to the legacy `callLLM` + `BEGIN FILE / END FILE` parsing path. Both paths coexist for v1.

A settings-UI toggle is planned but not yet wired (Task 9 of the transition plan); for now, configure via env var on the worker.

## Provider configuration

`runOpenCodeAgent` writes an `opencode.json` per-worktree at run time, derived from the user's primary provider record (`backend/src/db.ts` model_config table). The shape:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "primary": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Atelier Primary (MiniMax M2.7)",
      "options": {
        "baseURL": "https://api.minimax.ai/v1",
        "apiKey": "{env:ATELIER_OPENCODE_API_KEY}"
      },
      "models": { "MiniMax-M2.7": { "name": "MiniMax-M2.7" } }
    }
  },
  "model": "primary/MiniMax-M2.7"
}
```

The API key is resolved from keytar / settings and passed to the opencode subprocess via the `ATELIER_OPENCODE_API_KEY` env var only — never written into `opencode.json`.

`kind` → npm package mapping:

- `minimax`, `openai-compatible` → `@ai-sdk/openai-compatible`
- `anthropic` → `@ai-sdk/anthropic`

`kind` is currently `minimax`, `openai-compatible`, or `anthropic` (see `worker/src/llm/callLLM.ts`). Adding a new kind is a single-line change to `NPM_PACKAGE_FOR_KIND` in `worker/src/llm/opencodeConfig.ts`; unknown kinds default to `@ai-sdk/openai-compatible`.

## Tradeoffs

- **Telemetry under-reports the implementer.** Direct `callLLM` calls (researcher panel, debate, architect, reviewer panel, judge, verifier) all flow per-call token + cost rows into the `agent_calls` table. opencode runs don't — the `runOpenCodeAgent` subprocess holds its own session DB and emits to its own `opencode stats`, so when `ATELIER_USE_OPENCODE=1` the cost-by-agent panel for the `developer` row will be empty (or stale from previous direct-LLM runs). Aggregate `workflow_runs.total_tokens` is similarly under-reported by the implementer's share.

  The right fix is to switch to `opencode serve` + `@opencode-ai/sdk` and forward usage events into `/api/agent/call` from there. That adds a long-running opencode daemon to manage; v1 lives without it.

- **AGENTS.md collision.** opencode reads `AGENTS.md` at the project root for system instructions. `writeAgentsRules` only writes ours if the worktree doesn't already have one — if the user's project ships its own `AGENTS.md`, theirs wins, since their instructions are more authoritative than our scoped persona. The trade is that custom developer personas living in `worker/src/.atelier/agents/developer.md` are silently ignored on those projects; that's the right call but worth knowing when debugging "why isn't my persona being applied?"

- **Best-of-N is disabled under opencode.** `implementCodeBestOfN` short-circuits to a single `implementCode` call when the flag is on. Spawning N parallel candidates needs per-ticket sub-worktrees to avoid racing on the shared git index — deferred until single-pass quality is shown to be insufficient.

- **Self-critique was removed.** Not specific to opencode — see commit `e020848`. The reviewer panel + verifier loop replaces what self-critique was hedging against, and opencode's internal iteration covers it directly on the new path.
