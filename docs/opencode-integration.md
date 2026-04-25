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

A settings-UI toggle is planned (Task 9 of the transition plan); until then, configure via env var.

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
- `openai` → `@ai-sdk/openai`

## Tradeoffs

- **Telemetry**: opencode runs don't currently report token usage to `/api/agent/call`, so the `agent_calls` table is missing implementer rows when opencode is on. Cost-by-agent panels under-report by the implementer's share. (Future work — see Task 10 + Open Decisions in the transition plan.)
- **AGENTS.md**: opencode reads `AGENTS.md` at the project root for system instructions. We write the developer persona there per-run *only if no existing `AGENTS.md` is present* — the user's project instructions always win.
