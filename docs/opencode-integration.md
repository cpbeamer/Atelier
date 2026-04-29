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

The autopilot workflow now starts a per-run `opencode serve` subprocess at the top of each run when the toggle is on (managed by `backend/src/opencode/lifecycle.ts`), and the developer activity sends prompts to the run's session via `@opencode-ai/sdk`. The serve subprocess is stopped in the workflow's `finally` block on every exit path.

## Enable

Open Settings (gear icon in the sidebar) and choose `opencode` under "Agent CLI runtime". The setting persists across restarts.

For headless / standalone-worker development, set `ATELIER_USE_OPENCODE=1` in the worker's environment as a fallback. The worker resolves the flag from the backend first; if the backend is unreachable, it consults the env var.

> **Migration note:** the old `useOpencode` setting is migrated automatically. `true` becomes `agentRuntime=opencode`; `false` becomes `agentRuntime=direct-llm`. For standalone worker development, `ATELIER_AGENT_RUNTIME=opencode` is preferred, while `ATELIER_USE_OPENCODE=1` remains supported as a fallback.

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

- **Telemetry now forwards developer usage.** When the developer runs through the per-run `opencode serve`, the SDK returns input/output token counts on each turn. Those rows land in `agent_calls` with `kind = 'opencode'` and the `developer` agent id, so the cost-by-agent panel reflects developer spend. The SDK's `costUsd` is recorded as-is when present; when it's zero (some providers don't report cost), the run will show `total_cost_usd = 0` for the developer rows but `total_tokens` is still accurate.

- **AGENTS.md collision.** opencode reads `AGENTS.md` at the project root for system instructions. `writeAgentsRules` only writes ours if the worktree doesn't already have one — if the user's project ships its own `AGENTS.md`, theirs wins, since their instructions are more authoritative than our scoped persona. The trade is that custom developer personas living in `worker/src/.atelier/agents/developer.md` are silently ignored on those projects; that's the right call but worth knowing when debugging "why isn't my persona being applied?"

- **Best-of-N is disabled under opencode.** `implementCodeBestOfN` short-circuits to a single `implementCode` call when the flag is on. Spawning N parallel candidates needs per-ticket sub-worktrees to avoid racing on the shared git index — deferred until single-pass quality is shown to be insufficient.

- **Self-critique was removed.** Not specific to opencode — see commit `e020848`. The reviewer panel + verifier loop replaces what self-critique was hedging against, and opencode's internal iteration covers it directly on the new path.
