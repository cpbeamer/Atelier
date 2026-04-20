# Multi-Agent Autopilot Workflow Design

> **Goal:** Atelier opens a project → clicks Autopilot → agents autonomously analyze, debate, scope, build, and push changes.

**Architecture:** Fully automated pipeline with no human gates. Each phase feeds into the next via Temporal durable workflows. PTY terminals show live agent work. Project context persists across sessions.

**Agents & Roles:**
| Role | Persona | Type | Task |
|---|---|---|---|
| Research Agent | `researcher.md` | Terminal (Claude Code) | Analyze repo structure, README, package.json; web search for market/competitor context |
| Debate Agent A | `debate-signal.md` | Terminal (Claude Code) | Argues FOR a feature — market value, differentiation, user need |
| Debate Agent B | `debate-noise.md` | Terminal (Claude Code) | Argues AGAINST — feature noise, vanity vs value, competitor parity trap |
| Ticket Bot | `ticket-bot.md` | Direct LLM | Consumes debate output → generates structured tickets (title, description, acceptance criteria, estimate) |
| Architect | `architect.md` | Terminal (Claude Code) | Reviews tickets → scopes into technical plan, flags dependencies |
| Developer | `developer.md` | Terminal (Claude Code) | Implements code in worktree |
| Code Reviewer | `code-reviewer.md` | Terminal (Claude Code) | Reviews PR-style diff, suggests fixes |
| Tester | `tester.md` | Terminal (Claude Code) | Writes and runs tests, verifies acceptance criteria |
| Pusher | `pusher.md` | Direct LLM | Creates PR or pushes to branch |

**Autopilot Pipeline Phases:**

```
[User clicks "Autopilot"]
       │
       ▼
Phase 1: REPOSITORY ANALYSIS (Research Agent)
  - Reads: README, package.json, src/ structure, existing features
  - Web search: market context, competitor features
  - Output: "Repo Analysis Report" — current state, gaps, opportunities
       │
       ▼
Phase 2: ROADMAP DEBATE (Debate A + Debate B, parallel → reconcile)
  - Input: Repo Analysis + user-suggested features (if any)
  - Debate A: "This feature is valuable because..."
  - Debate B: "This feature is noise because..."
  - Reconciliation: Both agree on PRIORITIZED feature list with rationale
  - Output: "Roadmap Debate Summary" — approved features, rejected features with reasons
       │
       ▼
Phase 3: TICKET GENERATION (Ticket Bot)
  - Input: Prioritized feature list
  - Output: Structured tickets with title, description, acceptance criteria, estimate (t-shirt sizes)
       │
       ▼
Phase 4: SCOPE & PLAN (Architect)
  - Input: Tickets
  - Output: Technical plan per ticket — files to change, dependencies, approach
       │
       ▼
Phase 5: IMPLEMENT (Developer)
  - Input: Scoped ticket + technical plan
  - Output: Code in worktree
       │
       ▼
Phase 6: REVIEW (Code Reviewer)
  - Input: Code diff
  - Output: Inline review comments, approves or requests changes
  - Loop: Developer addresses feedback → Reviewer re-reviews (max 3 loops)
       │
       ▼
Phase 7: TEST (Tester)
  - Input: Approved code + acceptance criteria
  - Output: Test results — pass/fail per criteria
  - Loop: Developer fixes failures → Tester re-tests (max 3 loops)
       │
       ▼
Phase 8: PUSH (Pusher)
  - Creates PR branch OR pushes to feature branch
  - Posts summary comment with what changed and why
```

**Worktree Model:**
- Every autopilot run creates a worktree at `~/.atelier/worktrees/{project}/{run-id}/`
- Branch name: `atelier/autopilot/{run-id}`
- Agents work exclusively in the worktree
- On push: user reviews the PR in GitHub, not in Atelier

**Terminal Grid Layout (Autopilot Mode):**
```
┌─────────────────────────────────────────────────────────────┐
│  [Researcher]  [Debate A]  [Debate B]  [Ticket Bot]        │  ← Phase 1-3: all visible
│     ───────────────────────────────────────────────────      │
│  [Architect]   [Developer]  [Reviewer]   [Tester]   [Pusher]│  ← Phase 4-8: all visible
└─────────────────────────────────────────────────────────────┘
```
All 9 terminals visible at once, streaming live. Completed agents show "✓ Done" and grey out.

**Human UX for Autopilot:**
- No milestones, no approval gates
- User watches terminals work in real-time
- User can inject messages into any terminal mid-flight (Cmd+click pane → inject)
- User can terminate run at any time
- If stuck in a loop (3x retries), system posts a "STALLED: [reason]" notification and waits for user input OR auto-skip after 10 minutes

**Project Context Storage:**
- Stored in `.atelier/context/{project-slug}.json`
- Includes: user preferences, previous debate outcomes, approved roadmap items, known constraints
- Research Agent reads this on startup to avoid re-asking known information
- User can edit via Settings → Project Context

**Greenfield Mode (NLP → Build):**
- Separate workflow triggered by "New Feature" button
- User types: "Build a REST API for user authentication with JWT"
- Research Agent: validates the ask, suggests alternatives
- Then flows into same Phase 3-8 pipeline (tickets → implement → push)
- Key difference: starts from user's NLP intent rather than repo analysis

**What this spec does NOT cover:**
- The NLP-to-feature mapping (greenfield scope is just the kickoff prompt)
- How agents are persona'd in detail (that's per-project .atelier/agents/ content)
- The Terminal Grid UI implementation (xterm.js panes)
- Worktree cleanup / retention policy
