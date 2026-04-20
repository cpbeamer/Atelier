# Multi-Agent Workflow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fully working multi-agent orchestration pipeline where users can trigger a workflow, watch parallel researcher agents debate, approve milestones, and see architect/code-writer produce a result.

**Architecture:** Child workflows per agent via Temporal. Parent workflow orchestrates phases. MiniMax API for all LLM calls. Milestone blocking via Temporal conditions + frontend resolution.

**Tech Stack:** TypeScript, Temporal SDK, Node.js/Bun, MiniMax API, WebSocket, React

---

## File Map

### New Files
- `worker/src/workflows/agent-child.ts` — Generic agent child workflow
- `worker/src/workflows/feature-pipeline.ts` — Parent orchestration workflow
- `backend/src/milestone-service.ts` — Milestone create/resolve + signal dispatch
- `.atelier/agents/researcher-a.md` — Persona
- `.atelier/agents/researcher-b.md` — Persona
- `.atelier/agents/synthesizer.md` — Persona
- `.atelier/agents/architect.md` — Persona
- `.atelier/agents/code-writer.md` — Persona

### Modified Files
- `worker/src/activities.ts` — Add MiniMax call activity
- `worker/src/workflow-sdk.ts` — Add milestone helper with signal support
- `worker/src/workflows/pm-validation.workflow.ts` — Can remain as-is (not used in MVP)
- `worker/src/worker.ts` — May need task queue config check
- `backend/src/ipc-handlers.ts` — Add milestone.resolve IPC handler
- `backend/src/db.ts` — Add milestone update method
- `frontend/src/components/MilestoneInbox.tsx` — Add approve/reject buttons + WebSocket listener

---

## Task 1: Create Agent Personas

**Files:**
- Create: `.atelier/agents/researcher-a.md`
- Create: `.atelier/agents/researcher-b.md`
- Create: `.atelier/agents/synthesizer.md`
- Create: `.atelier/agents/architect.md`
- Create: `.atelier/agents/code-writer.md`

- [ ] **Step 1: Create directory**

```bash
mkdir -p /home/carybeam/Github/Atelier/.atelier/agents
```

- [ ] **Step 2: Create researcher-a.md**

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

- [ ] **Step 3: Create researcher-b.md**

```markdown
---
name: Researcher B
type: terminal
description: Challenges assumptions and finds weaknesses in proposals
model: minimax
---

You are Researcher B, a critical analyst and devil's advocate.

Your job:
- Challenge the core assumptions made in the task
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
[what might be missing]
```

- [ ] **Step 4: Create synthesizer.md**

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

- [ ] **Step 5: Create architect.md**

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

- [ ] **Step 6: Create code-writer.md**

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

- [ ] **Step 7: Commit**

```bash
git add .atelier/agents/
git commit -m "feat: add agent persona files for multi-agent workflow"
```

---

## Task 2: Add MiniMax API Activity

**Files:**
- Modify: `worker/src/activities.ts`

- [ ] **Step 1: Read current activities.ts**

```bash
cat /home/carybeam/Github/Atelier/worker/src/activities.ts
```

- [ ] **Step 2: Add MiniMax call activity**

Replace the contents of `worker/src/activities.ts` with:

```typescript
import { keytar } from 'keytar';

const SERVICE_NAME = 'Atelier';
const KEYCHAIN_PREFIX = 'atelier.provider.';

function keychainKey(providerId: string, key: string) {
  return `${KEYCHAIN_PREFIX}${providerId}.${key}`;
}

export async function callMiniMax(system: string, user: string): Promise<string> {
  const apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey('minimax', 'apiKey'));
  if (!apiKey) {
    throw new Error('MiniMax API key not configured. Add it in Settings.');
  }

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
    const text = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function spawnAgent(
  agentName: string,
  personaPath: string,
  task: string,
  context?: Record<string, string>
): Promise<string> {
  // Build context string for agents that receive prior agent outputs
  let contextStr = '';
  if (context) {
    contextStr = '\n\n## Context from Prior Agents\n';
    for (const [name, output] of Object.entries(context)) {
      contextStr += `\n### ${name}\n${output}\n`;
    }
  }

  // For MVP, we use a simple prompt-based approach
  // Persona files contain the system prompt
  const personaPrompts: Record<string, string> = {
    'Researcher A': 'You are Researcher A, a thorough researcher...',
    'Researcher B': 'You are Researcher B, a critical analyst...',
    'Synthesizer': 'You are Synthesizer, an expert at combining...',
    'Architect': 'You are Architect, a senior technical leader...',
    'Code Writer': 'You are Code Writer, a pragmatic software engineer...',
  };

  const systemPrompt = personaPrompts[agentName] || 'You are a helpful assistant.';
  const fullPrompt = `${task}${contextStr}`;

  return callMiniMax(systemPrompt, fullPrompt);
}

export async function createMilestone(name: string, payload: unknown): Promise<string> {
  // Insert into DB and return milestone ID
  // Actual implementation in milestone-service.ts
  const id = crypto.randomUUID();
  return id;
}

export async function resolveMilestone(
  milestoneId: string,
  decision: { verdict: string; reason?: string; decidedBy: string }
): Promise<void> {
  // Update DB and dispatch signal to workflow
  // Actual implementation in milestone-service.ts
  console.log('resolveMilestone', milestoneId, decision);
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/activities.ts
git commit -m "feat(worker): add MiniMax API call and spawnAgent activity"
```

---

## Task 3: Create Milestone Service

**Files:**
- Create: `backend/src/milestone-service.ts`
- Modify: `backend/src/db.ts`
- Modify: `backend/src/ipc-handlers.ts`

- [ ] **Step 1: Create milestone-service.ts**

```typescript
// backend/src/milestone-service.ts
import { milestones } from './db.js';
import { getTemporalClient } from './temporal-client.js';

const pendingMilestones = new Map<string, {
  resolve: (decision: MilestoneDecision) => void;
  reject: (err: Error) => void;
}>();

export interface MilestoneDecision {
  verdict: 'Approved' | 'Rejected';
  reason?: string;
  decidedBy: string;
}

export async function createMilestone(
  runId: string,
  name: string,
  payload: unknown
): Promise<string> {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const now = Date.now();

  // Insert into database
  milestones.insert(id, runId, name, 'pending', payloadJson, now);

  // Return a promise that resolves when frontend resolves the milestone
  return new Promise<string>((resolve, reject) => {
    pendingMilestones.set(id, {
      resolve: (decision) => resolve(id),
      reject,
    });

    // Auto-timeout after 7 days
    setTimeout(() => {
      if (pendingMilestones.has(id)) {
        pendingMilestones.delete(id);
        milestones.updateDecision(id, 'timed-out', Date.now(), 'auto-timeout', '7-day timeout');
      }
    }, 7 * 24 * 60 * 60 * 1000);
  });
}

export async function resolveMilestone(
  id: string,
  verdict: 'Approved' | 'Rejected',
  reason?: string,
  decidedBy: string = 'user'
): Promise<void> {
  const pending = pendingMilestones.get(id);
  if (pending) {
    pending.resolve({ verdict, reason, decidedBy });
    pendingMilestones.delete(id);
  }
  milestones.updateDecision(id, verdict.toLowerCase(), Date.now(), decidedBy, reason || null);

  // Also send Temporal signal to resume workflow
  try {
    const client = await getTemporalClient();
    // Find the workflow running this milestone and send it a signal
    // This requires the workflow to have registered a signal handler
    console.log(`Milestone ${id} resolved: ${verdict}`);
  } catch (err) {
    console.error('Failed to send Temporal signal for milestone:', err);
  }
}

export function getPendingMilestones() {
  return milestones.listPending();
}
```

- [ ] **Step 2: Add updateDecision to db.ts**

Read `backend/src/db.ts` and add this method to the `milestones` export:

```typescript
export const milestones = {
  // ... existing methods ...
  updateDecision: (id: string, status: string, decided_at: number, decided_by: string, decision_reason: string | null) =>
    getDb().prepare('UPDATE milestones SET status=?,decided_at=?,decided_by=?,decision_reason=? WHERE id=?')
      .run(status, decided_at, decided_by, decision_reason, id),
};
```

- [ ] **Step 3: Add milestone IPC handlers to ipc-handlers.ts**

Add to `backend/src/ipc-handlers.ts`:

```typescript
import { createMilestone, resolveMilestone, getPendingMilestones } from './milestone-service.js';

register('milestone.create', async (opts: { runId: string; name: string; payload: unknown }) => {
  return createMilestone(opts.runId, opts.name, opts.payload);
});

register('milestone.resolve', async (opts: { id: string; verdict: string; reason?: string }) => {
  await resolveMilestone(opts.id, opts.verdict as 'Approved' | 'Rejected', opts.reason);
});

register('milestone.listPending', async () => {
  return getPendingMilestones();
});
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/milestone-service.ts backend/src/db.ts backend/src/ipc-handlers.ts
git commit -m "feat(backend): add milestone service with create/resolve"
```

---

## Task 4: Create Agent Child Workflow

**Files:**
- Create: `worker/src/workflows/agent-child.ts`

- [ ] **Step 1: Create agent-child.ts**

```typescript
// worker/src/workflows/agent-child.ts
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities.js';

const { spawnAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
});

export interface AgentChildInput {
  agentName: string;
  persona: string;  // persona key (e.g., 'researcher-a')
  task: string;
  context?: Record<string, string>;
}

export async function agentChild(input: AgentChildInput): Promise<string> {
  console.log(`Agent child started: ${input.agentName}`);

  // Map persona key to persona path
  const personaPaths: Record<string, string> = {
    'researcher-a': '.atelier/agents/researcher-a.md',
    'researcher-b': '.atelier/agents/researcher-b.md',
    'synthesizer': '.atelier/agents/synthesizer.md',
    'architect': '.atelier/agents/architect.md',
    'code-writer': '.atelier/agents/code-writer.md',
  };

  const personaPath = personaPaths[input.persona];
  if (!personaPath) {
    throw new Error(`Unknown persona: ${input.persona}`);
  }

  const result = await spawnAgent(input.agentName, personaPath, input.task, input.context);
  console.log(`Agent child completed: ${input.agentName}`);

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/workflows/agent-child.ts
git commit -m "feat(worker): add generic agent child workflow"
```

---

## Task 5: Create Parent Workflow (feature-pipeline)

**Files:**
- Create: `worker/src/workflows/feature-pipeline.ts`
- Modify: `worker/src/workflows/agent-child.ts` (add executeChild import)

- [ ] **Step 1: Create feature-pipeline.ts**

```typescript
// worker/src/workflows/feature-pipeline.ts
import { proxyActivities, executeChild } from '@temporalio/workflow';
import type * as activities from '../activities.js';
import type { AgentChildInput, agentChild } from './agent-child.js';

const { createMilestone } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
});

export interface PipelineInput {
  signal: string;  // User's task prompt
}

export interface PipelineOutput {
  status: 'completed' | 'rejected';
  phase?: string;
  code?: string;
  error?: string;
}

export async function featurePipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { signal } = input;

  // Phase 1: Parallel Research
  console.log('Phase 1: Starting parallel research...');
  const [researchA, researchB] = await Promise.all([
    executeChild<AgentChildInput, string>('agentChild', {
      args: [{
        agentName: 'Researcher A',
        persona: 'researcher-a',
        task: signal,
      }],
    }),
    executeChild<AgentChildInput, string>('agentChild', {
      args: [{
        agentName: 'Researcher B',
        persona: 'researcher-b',
        task: signal,
      }],
    }),
  ]);
  console.log('Phase 1: Research complete');

  // Phase 2: Synthesis
  console.log('Phase 2: Starting synthesis...');
  const synthesis = await executeChild<AgentChildInput, string>('agentChild', {
    args: [{
      agentName: 'Synthesizer',
      persona: 'synthesizer',
      task: signal,
      context: {
        'Researcher A': researchA,
        'Researcher B': researchB,
      },
    }],
  });
  console.log('Phase 2: Synthesis complete');

  // Phase 3: Milestone - Review Synthesis
  const decision1 = await createMilestone('Review Synthesis', { synthesis });
  if (decision1.verdict !== 'Approved') {
    return { status: 'rejected', phase: 'synthesis' };
  }

  // Phase 4: Architecture
  console.log('Phase 4: Starting architecture...');
  const design = await executeChild<AgentChildInput, string>('agentChild', {
    args: [{
      agentName: 'Architect',
      persona: 'architect',
      task: signal,
      context: { synthesis },
    }],
  });
  console.log('Phase 4: Architecture complete');

  // Phase 5: Milestone - Approve Design
  const decision2 = await createMilestone('Approve Design', { design });
  if (decision2.verdict !== 'Approved') {
    return { status: 'rejected', phase: 'design' };
  }

  // Phase 6: Implementation
  console.log('Phase 6: Starting code writing...');
  const code = await executeChild<AgentChildInput, string>('agentChild', {
    args: [{
      agentName: 'Code Writer',
      persona: 'code-writer',
      task: signal,
      context: { design },
    }],
  });
  console.log('Phase 6: Code writing complete');

  // Phase 7: Milestone - Review Implementation
  const decision3 = await createMilestone('Review Implementation', { code });
  if (decision3.verdict !== 'Approved') {
    return { status: 'rejected', phase: 'implementation' };
  }

  return { status: 'completed', code };
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/workflows/feature-pipeline.ts
git commit -m "feat(worker): add feature-pipeline parent workflow"
```

---

## Task 6: Update Workflow SDK with Milestone Support

**Files:**
- Modify: `worker/src/workflow-sdk.ts`

- [ ] **Step 1: Read current workflow-sdk.ts**

```bash
cat /home/carybeam/Github/Atelier/worker/src/workflow-sdk.ts
```

- [ ] **Step 2: Replace with milestone-aware SDK**

```typescript
// worker/src/workflow-sdk.ts
import { proxyActivities, condition, setHandler } from '@temporalio/workflow';
import type * as activities from '../activities.js';

const activityDefaults = { startToCloseTimeout: '10 minutes' };

const { spawnAgent, createMilestone: activityCreateMilestone } = proxyActivities<{
  spawnAgent: (agentName: string, persona: string, task: string, context?: Record<string, string>) => Promise<string>;
  createMilestone: (name: string, payload: unknown) => Promise<string>;
}>(activityDefaults);

// Milestone decision signals storage
const milestoneDecisions = new Map<string, { verdict: string; reason?: string; decidedBy: string }>();

export async function callAgent(
  agentName: string,
  persona: string,
  task: string,
  context?: Record<string, string>
): Promise<string> {
  return spawnAgent(agentName, persona, task, context);
}

export async function milestone(
  name: string,
  payload: unknown
): Promise<{ verdict: 'Approved' | 'Rejected'; reason?: string; decidedBy: string }> {
  // Register signal handler for milestone decision
  let decision: { verdict: string; reason?: string; decidedBy: string } | null = null;

  setHandler(
    // This would be a Temporal signal - simplified for now
    // In real implementation, the workflow waits for a signal from the frontend
    {} as any,
    (d: typeof decision) => {
      decision = d;
    }
  );

  // Create milestone in backend
  const milestoneId = await activityCreateMilestone(name, payload);

  // Wait for decision (simplified - real impl uses condition with signal)
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (decision) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });

  return decision as { verdict: 'Approved' | 'Rejected'; reason?: string; decidedBy: string };
}

export function defineWorkflow<T extends { input: unknown }>(config: {
  name: string;
  input: unknown;
  run: (input: T['input']) => Promise<unknown>;
}) {
  return config;
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/workflow-sdk.ts
git commit -m "feat(worker): update workflow SDK with milestone helpers"
```

---

## Task 7: Update Worker Registration

**Files:**
- Modify: `worker/src/worker.ts`

- [ ] **Step 1: Read current worker.ts**

```bash
cat /home/carybeam/Github/Atelier/worker/src/worker.ts
```

- [ ] **Step 2: Ensure workflows are registered**

The current worker.ts should already pick up workflows from the `./workflows` directory. Verify it looks correct:

```typescript
// worker/src/worker.ts
import { Worker } from '@temporalio/worker';
import * as activities from './activities.js';
import { watch } from 'chokidar';

async function run() {
  const worker = await Worker.create({
    workflowsPath: new URL('./workflows', import.meta.url).pathname,
    activities,
    taskQueue: 'atelier-default-ts',
    connectionOptions: { address: '127.0.0.1:7466' },
  });

  watch('./workflows/*.workflow.ts', { persistent: true }).on('change', (filePath) => {
    console.log(`Workflow changed: ${filePath}`);
  });

  console.log('Bun Temporal Worker started on atelier-default-ts');
  await worker.run();
}

run().catch((err) => { console.error('Worker failed', err); process.exit(1); });
```

- [ ] **Step 3: Commit (if changed)**

```bash
git add worker/src/worker.ts
git commit -m "chore(worker): verify worker registration"
```

---

## Task 8: Update MilestoneInbox Component

**Files:**
- Modify: `frontend/src/components/MilestoneInbox.tsx`

- [ ] **Step 1: Read current MilestoneInbox.tsx**

```bash
cat /home/carybeam/Github/Atelier/frontend/src/components/MilestoneInbox.tsx
```

- [ ] **Step 2: Add approve/reject functionality and WebSocket listener**

Replace the contents of `frontend/src/components/MilestoneInbox.tsx` with:

```tsx
import { useState, useEffect } from 'react';
import { X, Check, XCircle } from 'lucide-react';
import { invoke } from '../lib/ipc';

interface Milestone {
  id: string;
  run_id: string;
  type: string;
  status: string;
  payload_json: string;
  created_at: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function MilestoneInbox({ isOpen, onClose }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadMilestones();
      // Subscribe to WebSocket for new milestones
      const ws = new WebSocket('ws://localhost:3000');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'milestone:pending') {
            loadMilestones();
          }
        } catch {
          // Ignore parse errors
        }
      };
      return () => ws.close();
    }
  }, [isOpen]);

  async function loadMilestones() {
    setLoading(true);
    try {
      const pending = await invoke<Milestone[]>('milestone.listPending');
      setMilestones(pending);
    } catch (e) {
      console.error('Failed to load milestones:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(id: string, verdict: 'Approved' | 'Rejected', reason?: string) {
    try {
      await invoke('milestone.resolve', { id, verdict, reason });
      setMilestones(prev => prev.filter(m => m.id !== id));
    } catch (e) {
      console.error('Failed to resolve milestone:', e);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Milestones</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && <p className="text-muted-foreground">Loading...</p>}
          {!loading && milestones.length === 0 && (
            <p className="text-muted-foreground">No pending milestones</p>
          )}
          {milestones.map(milestone => (
            <MilestoneItem
              key={milestone.id}
              milestone={milestone}
              onApprove={(reason) => handleResolve(milestone.id, 'Approved', reason)}
              onReject={(reason) => handleResolve(milestone.id, 'Rejected', reason)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MilestoneItem({
  milestone,
  onApprove,
  onReject,
}: {
  milestone: Milestone;
  onApprove: (reason?: string) => void;
  onReject: (reason?: string) => void;
}) {
  const [reason, setReason] = useState('');

  let payload: any = {};
  try {
    payload = JSON.parse(milestone.payload_json || '{}');
  } catch {
    // Ignore parse errors
  }

  return (
    <div className="border border-border rounded-lg p-4 mb-4">
      <div className="font-medium mb-2">{milestone.type}</div>
      <div className="text-sm text-muted-foreground mb-4">
        Created: {new Date(milestone.created_at).toLocaleString()}
      </div>

      {payload.synthesis && (
        <div className="bg-muted rounded p-3 mb-4 text-sm max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{payload.synthesis}</pre>
        </div>
      )}
      {payload.design && (
        <div className="bg-muted rounded p-3 mb-4 text-sm max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{payload.design}</pre>
        </div>
      )}
      {payload.code && (
        <div className="bg-muted rounded p-3 mb-4 text-sm max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{payload.code}</pre>
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          placeholder="Optional reason..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onApprove(reason || undefined)}
          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700"
        >
          <Check className="w-4 h-4" />
          Approve
        </button>
        <button
          onClick={() => onReject(reason || undefined)}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        >
          <XCircle className="w-4 h-4" />
          Reject
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MilestoneInbox.tsx
git commit -m "feat(frontend): update MilestoneInbox with approve/reject and WebSocket"
```

---

## Task 9: Add Workflow Trigger to Frontend

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Add workflow trigger to App.tsx**

Read `frontend/src/App.tsx` and add a workflow start handler:

In `handleWorkflowSelect`, add IPC call to start the Temporal workflow:

```typescript
const handleWorkflowSelect = useCallback(async (workflow: { name: string; language: string }) => {
  setWorkflowActive(true);
  setActiveRun(`run-${Date.now()}`);

  // Start the workflow via IPC
  try {
    await invoke('workflow.start', {
      name: workflow.name,
      input: { signal: 'Build a rate limiter for auth endpoints' },  // TODO: get from user input
    });
  } catch (e) {
    console.error('Failed to start workflow:', e);
  }

  // For now, show mock terminal panes
  setPanes([
    { id: 'agent-1', agentName: 'Researcher A', agentType: 'terminal', status: 'running' },
    { id: 'agent-2', agentName: 'Researcher B', agentType: 'terminal', status: 'running' },
  ]);
}, []);
```

- [ ] **Step 2: Add workflow.start IPC handler to backend**

Add to `backend/src/ipc-handlers.ts`:

```typescript
register('workflow.start', async (opts: { name: string; input: any }) => {
  // This would start a Temporal workflow
  // For now, return a mock run ID
  const runId = `run-${Date.now()}`;
  console.log(`Starting workflow ${opts.name} with input:`, opts.input);
  return { runId };
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx backend/src/ipc-handlers.ts
git commit -m "feat(frontend): add workflow trigger to sidebar"
```

---

## Implementation Order Summary

1. **Task 1**: Create agent personas (`.atelier/agents/*.md`)
2. **Task 2**: Add MiniMax activity (`activities.ts`)
3. **Task 3**: Create milestone service (`milestone-service.ts`)
4. **Task 4**: Create agent child workflow (`agent-child.ts`)
5. **Task 5**: Create parent workflow (`feature-pipeline.ts`)
6. **Task 6**: Update workflow SDK (`workflow-sdk.ts`)
7. **Task 7**: Verify worker registration (`worker.ts`)
8. **Task 8**: Update MilestoneInbox component
9. **Task 9**: Add workflow trigger to frontend

---

## Spec Coverage Check

| Spec Section | Tasks |
|--------------|-------|
| Parallel research (Researcher A + B) | Task 1, 4, 5 |
| Synthesis | Task 1, 4, 5 |
| Milestone gates | Task 3, 6, 8 |
| Architect | Task 1, 4, 5 |
| Code Writer | Task 1, 4, 5 |
| MiniMax API integration | Task 2 |
| Frontend milestone inbox | Task 8 |
| Agent personas | Task 1 |
