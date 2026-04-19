# Atelier Multi-Agent Workflow MVP — Design Specification

**Date:** 2026-04-19
**Author:** Cary Beam
**Status:** Approved for implementation
**Type:** Feature design

---

## 1. Overview

Implement a fully working multi-agent orchestration pipeline in Atelier. Users can trigger a workflow from the UI, watch parallel researcher agents debate a topic, see synthesis, approve at milestones, and watch an architect and code writer produce a result.

**Core pattern:** Child workflows per agent, parallel researchers with synthesis, milestone gates between phases, MiniMax API for all LLM calls.

---

## 2. Architecture

### 2.1 Workflow Structure

```
Parent Workflow: feature-pipeline
├── Phase 1: Parallel Research (no milestone)
│   ├── Researcher A (child workflow) — MiniMax
│   └── Researcher B (child workflow) — MiniMax
├── Phase 2: Synthesis (no milestone)
│   └── Synthesizer (child workflow) — MiniMax
├── Phase 3: Milestone — "Review Synthesis"
│   └── User approves or rejects
├── Phase 4: Architecture (milestone)
│   └── Architect (child workflow) — MiniMax
├── Phase 5: Milestone — "Approve Design"
├── Phase 6: Implementation
│   └── Code Writer (child workflow) — MiniMax
└── Phase 7: Milestone — "Review Implementation"
```

### 2.2 Child Workflow Pattern

Each agent runs as a `ChildWorkflow` with the following generic interface:

```typescript
interface AgentChildInput {
  agentName: string;      // e.g., "Researcher A"
  personaPath: string;    // e.g., ".atelier/agents/researcher-a.md"
  task: string;           // The user's original prompt
  context?: {             // Outputs from prior agents
    [key: string]: string;
  };
}
```

The parent workflow passes context from prior agents as input to subsequent ones.

### 2.3 Component Map

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `ParentWorkflow` | `worker/src/workflows/feature-pipeline.ts` | Orchestration, milestone management |
| `AgentChildWorkflow` | `worker/src/workflows/agent-child.ts` | Generic agent execution wrapper |
| `activities.ts` | `worker/src/activities.ts` | PTY spawning, LLM calls |
| `agent-persona/*.md` | `.atelier/agents/` | Agent personas |
| `MilestoneService` | `backend/src/milestone-service.ts` | Create/resolve milestones via IPC |
| `MilestoneInbox` | `frontend/src/components/MilestoneInbox.tsx` | Frontend milestone UI |

---

## 3. Workflow Definition

### 3.1 Parent Workflow (`feature-pipeline.ts`)

```typescript
import { proxyActivities, workflowID } from '@temporalio/workflow';
import type * as activities from '../activities';

const { spawnAgent, createMilestone, resolveMilestone } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
});

export const featurePipeline = {
  name: 'feature-pipeline',
  input: { signal: '' },

  run: async (ctx, input: { signal: string }) => {
    // Phase 1: Parallel Research
    const [researchA, researchB] = await Promise.all([
      spawnAgent({ agentName: 'Researcher A', persona: 'researcher-a', task: input.signal }),
      spawnAgent({ agentName: 'Researcher B', persona: 'researcher-b', task: input.signal }),
    ]);

    // Phase 2: Synthesis
    const synthesis = await spawnAgent({
      agentName: 'Synthesizer',
      persona: 'synthesizer',
      task: input.signal,
      context: { 'Researcher A': researchA, 'Researcher B': researchB },
    });

    // Phase 3: Milestone
    const decision1 = await createMilestone('Review Synthesis', { synthesis });
    if (decision1.verdict !== 'Approved') return { status: 'rejected', phase: 'synthesis' };

    // Phase 4: Architecture
    const design = await spawnAgent({
      agentName: 'Architect',
      persona: 'architect',
      task: input.signal,
      context: { synthesis },
    });

    // Phase 5: Milestone
    const decision2 = await createMilestone('Approve Design', { design });
    if (decision2.verdict !== 'Approved') return { status: 'rejected', phase: 'design' };

    // Phase 6: Implementation
    const code = await spawnAgent({
      agentName: 'Code Writer',
      persona: 'code-writer',
      task: input.signal,
      context: { design },
    });

    // Phase 7: Milestone
    const decision3 = await createMilestone('Review Implementation', { code });
    if (decision3.verdict !== 'Approved') return { status: 'rejected', phase: 'implementation' };

    return { status: 'completed', code };
  },
};
```

### 3.2 Agent Child Workflow (`agent-child.ts`)

Generic wrapper that:
1. Loads the persona markdown file
2. Calls `callMiniMax` activity with system prompt (persona) + user prompt (task + context)
3. Returns the LLM output

```typescript
export async function agentChild(input: AgentChildInput): Promise<string> {
  const persona = await loadPersona(input.personaPath);
  const fullPrompt = buildPrompt(persona, input.task, input.context);
  const response = await callMiniMax(persona.systemPrompt, fullPrompt);
  return response;
}
```

---

## 4. Activities

### 4.1 `activities.ts`

```typescript
export async function spawnAgent(input: AgentChildInput): Promise<string> {
  // 1. Load persona from .atelier/agents/{persona}.md
  // 2. Build prompt with context
  // 3. Call MiniMax API
  // 4. Return response
}

export async function callMiniMax(system: string, user: string): Promise<string> {
  // HTTP call to MiniMax API
  // Uses API key from OS keychain (node-keytar)
  // Returns response text
}

export async function createMilestone(name: string, payload: unknown): Promise<MilestoneDecision> {
  // Insert into DB
  // Send WebSocket event to frontend
  // Return promise that resolves when frontend calls resolveMilestone
}

export async function resolveMilestone(id: string, decision: MilestoneDecision): Promise<void> {
  // Update DB
  // Resume parent workflow via Temporal signal
}
```

### 4.2 Milestone Blocking

The `createMilestone` activity uses a Temporal `condition` with a 7-day timeout. The workflow blocks until the frontend resolves via IPC.

```typescript
// In workflow-sdk.ts
export async function milestone(ctx: WorkflowContext, name: string, payload: unknown) {
  const id = await activities.createMilestone(name, payload);
  // Wait for resolution via signal
  await condition(() => ctx.signals.hasMilestoneDecision(id), '7d');
  return ctx.signals.getMilestoneDecision(id);
}
```

---

## 5. Persona Files

Location: `.atelier/agents/` (project-local) or `~/.atelier/agents/` (global)

### 5.1 `researcher-a.md`

```markdown
---
name: Researcher A
type: terminal
description: Explores the problem space thoroughly, identifies opportunities
model: minimax
---

You are Researcher A, a thorough market and technical researcher.

Your job:
- Explore the problem space from multiple angles
- Identify 3-5 potential approaches
- Research market precedents and similar solutions
- Provide a structured analysis with pros and cons

Output format:
## Research Findings
### Problem Understanding
[your analysis]
### Potential Approaches
1. [approach] - pros/cons
2. [approach] - pros/cons
### Market Precedents
[what exists and how it relates]
```

### 5.2 `researcher-b.md`

```markdown
---
name: Researcher B
type: terminal
description: Challenges assumptions and finds weaknesses in proposals
model: minimax
---

You are Researcher B, a critical analyst and devil's advocate.

Your job:
- Challenge the core assumptions Researcher A made
- Identify potential failure modes and risks
- Find weaknesses in proposed approaches
- Poke holes in the reasoning

Output format:
## Critical Analysis
### Challenged Assumptions
[what you dispute]
### Risk Assessment
[what could go wrong]
### Alternative Viewpoints
[what the researcher missed]
```

### 5.3 `synthesizer.md`

```markdown
---
name: Synthesizer
type: terminal
description: Combines conflicting research into a coherent recommendation
model: minimax
---

You are Synthesizer, an expert at combining conflicting viewpoints.

You have received research from two analysts who explored the same problem
from different angles. Your job is to:
- Find the truth in both positions
- Reconcile contradictions
- Produce a single coherent recommendation

Context from prior agents will be provided. Synthesize it into:
## Synthesis
### Common Ground
[where both researchers agree]
### Key Tensions
[where they disagree and why]
### Recommended Path Forward
[your synthesis]
```

### 5.4 `architect.md`

```markdown
---
name: Architect
type: terminal
description: Produces detailed technical designs from requirements
model: minimax
---

You are Architect, a senior technical leader.

Given a synthesized recommendation and original task, produce a detailed
technical design document.

Output format:
## Technical Design
### Overview
### Architecture Decisions
### Data Model
### API Design
### File Structure
### Implementation Notes
```

### 5.5 `code-writer.md`

```markdown
---
name: Code Writer
type: terminal
description: Implements code based on technical specifications
model: minimax
---

You are Code Writer, a pragmatic software engineer.

Given a technical design and original requirements, implement the solution.
Focus on:
- Clean, working code
- Following existing patterns in the codebase
- Minimal but complete

Output the final code implementation.
```

---

## 6. MiniMax Integration

### 6.1 API Call

```typescript
export async function callMiniMax(system: string, user: string): Promise<string> {
  const apiKey = await keytar.getPassword('Atelier', 'minimax.apiKey');
  if (!apiKey) throw new Error('MiniMax API key not configured');

  const response = await fetch('https://api.minimax.chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'MiniMax/Abab6.5s-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`MiniMax API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
```

### 6.2 API Key Storage

API keys stored in OS keychain via `node-keytar`:
- Service: `Atelier`
- Account: `minimax.apiKey`

Frontend IPC calls `settings.apiKey:get` / `settings.apiKey:set` which use `node-keytar` under the hood.

---

## 7. Frontend Integration

### 7.1 Terminal Grid

Each running agent shows as a terminal pane in the grid. The frontend subscribes to PTY output via WebSocket.

```typescript
// Frontend: subscribe to agent output
invoke('pty-subscribe', { id: agentRunId });
```

### 7.2 Milestone Inbox

When `createMilestone` is called:
1. Backend inserts into `milestones` table
2. Backend sends WebSocket event `milestone:pending`
3. Frontend shows badge count on "Milestones" button
4. User clicks → `MilestoneInbox` shows pending items

User approves/rejects:
```typescript
invoke('milestone.resolve', { id, verdict: 'Approved' | 'Rejected', reason });
```

### 7.3 Workflow Progress

`WorkflowGraph` component shows current phase with status colors:
- Gray: pending
- Blue (pulsing): running
- Green: completed
- Red: failed

---

## 8. File Structure

```
atelier/
├── worker/src/
│   ├── workflows/
│   │   ├── feature-pipeline.ts      # Parent workflow
│   │   └── agent-child.ts          # Generic agent wrapper
│   ├── activities.ts                 # LLM calls, milestone ops
│   ├── workflow-sdk.ts               # defineWorkflow, milestone helpers
│   └── worker.ts                     # Worker registration
├── backend/src/
│   ├── milestone-service.ts          # Milestone create/resolve
│   └── ipc-handlers.ts               # IPC routing
├── frontend/src/
│   ├── components/
│   │   ├── MilestoneInbox.tsx        # Milestone UI
│   │   ├── WorkflowGraph.tsx         # Progress visualization
│   │   └── TerminalGrid.tsx          # Agent terminal panes
│   └── lib/ipc.ts                    # WebSocket bridge
├── .atelier/agents/                  # Agent personas (user-editable)
│   ├── researcher-a.md
│   ├── researcher-b.md
│   ├── synthesizer.md
│   ├── architect.md
│   └── code-writer.md
└── docs/superpowers/specs/
    └── 2026-04-19-multi-agent-workflow-design.md
```

---

## 9. Implementation Order

1. **MiniMax activity** — verify API calls work end-to-end
2. **Agent child workflow** — generic wrapper with persona loading
3. **Parent workflow** — orchestrate phases + milestones
4. **Persona files** — write all 5 agent personas
5. **Milestone service** — create/resolve with frontend notification
6. **Frontend inbox** — show pending milestones, approve/reject buttons
7. **Terminal integration** — show agent output in terminal panes
8. **SettingsModal** — ensure MiniMax API key config works

---

## 10. Success Criteria

- [ ] User enters a task ("Build a rate limiter for auth endpoints")
- [ ] Two researcher terminals open and run in parallel
- [ ] Both complete → Synthesizer runs
- [ ] Synthesis complete → Milestone notification appears
- [ ] User approves → Architect runs
- [ ] User approves design → Code Writer runs
- [ ] Final milestone → workflow complete
- [ ] All terminal output visible in UI
- [ ] MiniMax API key configurable in Settings
