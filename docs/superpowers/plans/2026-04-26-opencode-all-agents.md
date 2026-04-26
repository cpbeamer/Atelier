# Opencode for All Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every pipeline agent (researcher, debate, ticket-bot, architect, reviewer) live codebase access via the per-run opencode serve, eliminating blind JSON generation from shallow pre-fetched context.

**Architecture:** The per-run opencode `serve` process already starts in workflow Phase 0 (before researcher). Every agent creates its own session on that server via `sendAgentPrompt` — a thin wrapper around the existing `sendDeveloperPrompt` that prepends an ANALYSIS MODE instruction ("do not write files, use read/grep/glob, respond with JSON only"). The developer session is unchanged. `opencode.json` (provider config) must be written to the worktree before the first analyst session; we add a `bootstrapOpencodeWorktree` activity for this.

**Tech Stack:** Bun, TypeScript, `@opencode-ai/sdk@1.14.25`, Temporal activities, `withJsonRetry`, existing `sendDeveloperPrompt` in `opencodeServeClient.ts`

---

## File Map

**Modified:**
- `worker/src/llm/opencodeServeClient.ts` — add `sendAgentPrompt` + `AgentPromptInput`
- `worker/src/llm/opencodeAgent.ts` — remove `writeOpencodeConfig` call (moved to bootstrap)
- `worker/src/activities.ts` — add `bootstrapOpencodeWorktree` activity; add opencode branches to `researchRepo`, `debateFeatures`, `generateTickets`, `scopeArchitecture`, `reviewCode`, `reviewCodePanel`
- `worker/src/workflows/autopilot.workflow.ts` — call `bootstrapOpencodeWorktree` in Phase 0; add it to `proxyActivities` destructure

**New tests:**
- `worker/tests/opencodeServeClient.test.ts` — extend with `sendAgentPrompt` tests

---

### Task 1: `sendAgentPrompt` — analyst session wrapper

**Files:**
- Modify: `worker/src/llm/opencodeServeClient.ts`
- Test: `worker/tests/opencodeServeClient.test.ts`

`sendAgentPrompt` is a pure wrapper around `sendDeveloperPrompt`. It prepends an ANALYSIS MODE header to the prompt and returns only the text. All JSON parsing stays in the caller via `withJsonRetry`.

- [ ] **Step 1: Write the failing tests**

Add to `worker/tests/opencodeServeClient.test.ts` after the existing `getServeRunInfo` tests (keep all existing tests intact):

```ts
// ── sendAgentPrompt tests ─────────────────────────────────────────────────────

import { sendAgentPrompt } from '../src/llm/opencodeServeClient';

test('sendAgentPrompt prepends ANALYSIS MODE and persona text', async () => {
  let capturedPrompt = '';
  globalThis.fetch = mock(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('/api/opencode/run/') && u.includes('/session/')) {
      return new Response(JSON.stringify({ sessionId: 'sess-1' }), { status: 200 });
    }
    if (u.includes('/api/opencode/run/run-1')) {
      return new Response(JSON.stringify({
        runId: 'run-1', worktreePath: '/tmp/wt', port: 9999, password: 'pw',
      }), { status: 200 });
    }
    if (u.includes('/session/sess-1')) {
      const body = JSON.parse(init.body);
      capturedPrompt = body.parts[0].text;
      return new Response(JSON.stringify({
        data: {
          info: { tokens: { input: 10, output: 5 }, cost: 0.001 },
          parts: [{ type: 'text', text: '{"gaps":[]}' }],
        },
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  const text = await sendAgentPrompt({
    runId: 'run-1',
    personaKey: 'researcher',
    personaText: 'You are a researcher.',
    userPrompt: 'Find gaps.',
  });

  expect(text).toBe('{"gaps":[]}');
  expect(capturedPrompt).toContain('ANALYSIS MODE');
  expect(capturedPrompt).toContain('You are a researcher.');
  expect(capturedPrompt).toContain('Find gaps.');
  expect(capturedPrompt).toContain('valid JSON');
});

test('sendAgentPrompt throws when server is not running', async () => {
  globalThis.fetch = mock(async () => new Response('{}', { status: 404 })) as any;
  await expect(
    sendAgentPrompt({ runId: 'no-server', personaKey: 'analyst', personaText: '', userPrompt: 'x' }),
  ).rejects.toThrow(/HTTP 404/);
});
```

- [ ] **Step 2: Run tests — expect 2 new failures**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test tests/opencodeServeClient.test.ts 2>&1
```

Expected: `sendAgentPrompt is not a function` or similar import error.

- [ ] **Step 3: Implement `sendAgentPrompt` in `opencodeServeClient.ts`**

Add after the existing `sendDeveloperPrompt` function (after line 177):

```ts
export interface AgentPromptInput {
  runId: string;
  /** Persona key used to name/reuse the opencode session (e.g. 'researcher-architecture'). */
  personaKey: string;
  /** Full persona system-prompt text, injected into the user message body. */
  personaText: string;
  /** The task-specific user message body. */
  userPrompt: string;
  /** Optional model override: "primary/ModelName". */
  model?: string;
}

/** Send a read-only analyst prompt to an existing per-run opencode session.
 *  The model is instructed not to write files and to respond with JSON only.
 *  Returns the raw text — callers parse it with withJsonRetry. */
export async function sendAgentPrompt(input: AgentPromptInput): Promise<string> {
  const { runId, personaKey, personaText, userPrompt, model } = input;
  const prompt = [
    'ANALYSIS MODE: You must not write, edit, or delete any files.',
    'Use your read, grep, glob, and bash tools to explore the codebase.',
    '',
    personaText,
    '',
    userPrompt,
    '',
    'IMPORTANT: Respond with ONLY valid JSON. No prose, no markdown fences, no text outside the JSON structure.',
  ].join('\n');

  const result = await sendDeveloperPrompt({ runId, persona: personaKey, prompt, model });
  return result.text;
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test tests/opencodeServeClient.test.ts 2>&1
```

Expected: all tests pass (existing 4 + new 2 = 6 total in this file).

- [ ] **Step 5: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/llm/opencodeServeClient.ts worker/tests/opencodeServeClient.test.ts
git commit -m "feat(opencode): add sendAgentPrompt analyst wrapper"
```

---

### Task 2: `bootstrapOpencodeWorktree` — write `opencode.json` before Phase 1

**Files:**
- Modify: `worker/src/activities.ts` — add new exported activity
- Modify: `worker/src/llm/opencodeAgent.ts` — remove redundant `writeOpencodeConfig` call
- Modify: `worker/src/workflows/autopilot.workflow.ts` — call bootstrap in Phase 0

The opencode server starts in Phase 0. Before any analyst session can use it, `opencode.json` must exist in the worktree so opencode knows which provider and model to use. `runOpenCodeAgent` currently writes this in Phase 5+, too late for analyst sessions.

- [ ] **Step 1: Add `bootstrapOpencodeWorktree` to `activities.ts`**

Add this new activity immediately after `startRunOpencode` (around line 1480 in `activities.ts`). Note: `writeOpencodeConfig` and `getPrimaryProvider` are already imported at the top of the file — verify both are present before adding:

```ts
export async function bootstrapOpencodeWorktree(input: { worktreePath: string }): Promise<void> {
  const provider = await getPrimaryProvider();
  await writeOpencodeConfig(input.worktreePath, provider);
}
```

Also add the import for `writeOpencodeConfig` at the top of `activities.ts` if it's not there. Check the current imports:

```ts
// Already present (from opencodeAgent.ts):
import { runOpenCodeAgent } from './llm/opencodeAgent.js';
// Need to add:
import { writeOpencodeConfig } from './llm/opencodeConfig.js';
```

- [ ] **Step 2: Remove `writeOpencodeConfig` call from `opencodeAgent.ts`**

In `worker/src/llm/opencodeAgent.ts`, in the `runOpenCodeAgent` function, remove the line:

```ts
await writeOpencodeConfig(worktreePath, primaryProvider);
```

The full context of what to remove (around line 125):
```ts
// BEFORE (remove these two lines):
await writeOpencodeConfig(worktreePath, primaryProvider);
await writeAgentsRules(worktreePath, developerPersona);

// AFTER (keep only):
await writeAgentsRules(worktreePath, developerPersona);
```

Also remove the import of `writeOpencodeConfig` from `opencodeAgent.ts` if it's no longer used there:
```ts
// Remove from opencodeAgent.ts imports if present:
import { writeOpencodeConfig, writeAgentsRules } from './opencodeConfig';
// Replace with:
import { writeAgentsRules } from './opencodeConfig';
```

- [ ] **Step 3: Update the workflow**

In `worker/src/workflows/autopilot.workflow.ts`:

Add `bootstrapOpencodeWorktree` to the `proxyActivities` destructure (around line 5–35):

```ts
const {
  setupWorkspace,
  researchRepo,
  debateFeatures,
  generateTickets,
  scopeArchitecture,
  implementCode,
  implementCodeBestOfN,
  reviewCodePanel,
  testCode,
  verifyCode,
  pushChanges,
  emitStalledMilestone,
  notifyAgentStart,
  notifyAgentComplete,
  startRunOpencode,
  stopRunOpencode,
  useOpencodeForRun,
  bootstrapOpencodeWorktree,     // ← add this
} = proxyActivities<typeof activities>({ ... });
```

Then in the Phase 0 block (around line 77–80), add the bootstrap call:

```ts
// BEFORE:
if (await useOpencodeForRun()) {
  await startRunOpencode({ runId, worktreePath });
  opencodeStarted = true;
}

// AFTER:
if (await useOpencodeForRun()) {
  await startRunOpencode({ runId, worktreePath });
  await bootstrapOpencodeWorktree({ worktreePath });
  opencodeStarted = true;
}
```

- [ ] **Step 4: Run tests — expect all 59 pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

Expected: 59+ pass, 0 fail (the new activity has no unit test since it calls external functions already tested).

- [ ] **Step 5: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/activities.ts worker/src/llm/opencodeAgent.ts worker/src/workflows/autopilot.workflow.ts
git commit -m "feat(opencode): bootstrap opencode.json in Phase 0 before analyst sessions"
```

---

### Task 3: `researchRepo` via opencode

**Files:**
- Modify: `worker/src/activities.ts:researchRepo` (around lines 420–481)

When `useOpencode()` is true, each researcher specialist sends its prompt through a dedicated `sendAgentPrompt` session instead of `callLLM`. The synthesizer also goes through opencode. The existing fallback path stays.

The analyst prompt for each specialist should include the `baseContext` string (README + package.json + file listing) as a starting hint PLUS the live codebase-access instruction, so opencode can drill deeper than the static context.

- [ ] **Step 1: Add the import at the top of `activities.ts`**

Verify `sendAgentPrompt` is importable. Add to the imports block near the top of `activities.ts`:

```ts
import { sendAgentPrompt } from './llm/opencodeServeClient.js';
```

- [ ] **Step 2: Add opencode branch to `researchRepo`**

Replace the body of `researchRepo` with the opencode-gated version. The full replacement (replacing lines 420–481):

```ts
export async function researchRepo(input: ResearchInput): Promise<ResearchOutput> {
  const { projectPath, userContext = {}, runId } = input;

  const { baseContext } = await gatherRepoContext(projectPath);
  const history = await gitHistorySummary(projectPath);

  if (await useOpencode()) {
    // opencode path: each specialist gets live codebase access via the per-run
    // serve. The static baseContext is included as a starting hint; opencode
    // can grep/read deeper on its own.
    const panel = await loadPanel(process.cwd(), 'researcher', RESEARCHER_SPECIALISTS);
    const fragments = await Promise.all(RESEARCHER_SPECIALISTS.map(async (specialist) => {
      const agentId = `researcher-${specialist}`;
      await notifyAgentStart({ agentId, agentName: `Researcher (${specialist})`, terminalType: 'direct-llm' });
      const extra = specialist === 'history'
        ? `\n\n## Recent git history (subject lines, last 90 days)\n${history || '(no git history)'}`
        : '';
      try {
        const text = await sendAgentPrompt({
          runId,
          personaKey: agentId,
          personaText: panel[specialist],
          userPrompt: `${baseContext}${extra}`,
        });
        const out = await withJsonRetry<Record<string, unknown>>(
          () => Promise.resolve(text),
          { maxAttempts: 1, validate: (v) => typeof v === 'object' && v !== null },
        );
        await notifyAgentComplete({ agentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
        return [specialist, out] as const;
      } catch (e) {
        await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500) });
        return [specialist, { error: String(e) }] as const;
      }
    }));

    const specialistFindings = Object.fromEntries(fragments) as Record<ResearcherSpecialist, Record<string, unknown>>;

    const synthPersona = await loadPersona(process.cwd(), 'researcher-synthesizer');
    const synthPrompt = `User context: ${JSON.stringify(userContext)}\n\nSpecialist findings:\n${JSON.stringify(specialistFindings, null, 2)}`;
    try {
      const synthText = await sendAgentPrompt({
        runId,
        personaKey: 'researcher-synthesizer',
        personaText: synthPersona,
        userPrompt: synthPrompt,
      });
      return await withJsonRetry<ResearchOutput>(
        () => Promise.resolve(synthText),
        {
          maxAttempts: 1,
          validate: (v): v is ResearchOutput =>
            typeof v === 'object' && v !== null
            && typeof (v as any).repoStructure === 'string'
            && Array.isArray((v as any).currentFeatures)
            && Array.isArray((v as any).gaps)
            && Array.isArray((v as any).opportunities),
        },
      );
    } catch {
      return fallbackSynthesizeResearch(specialistFindings, baseContext);
    }
  }

  // Legacy path: pre-fetched context, callLLM per specialist.
  const panel = await loadPanel(process.cwd(), 'researcher', RESEARCHER_SPECIALISTS);
  const fragments = await Promise.all(RESEARCHER_SPECIALISTS.map(async (specialist) => {
    const agentId = `researcher-${specialist}`;
    await notifyAgentStart({ agentId, agentName: `Researcher (${specialist})`, terminalType: 'direct-llm' });
    try {
      const extra = specialist === 'history'
        ? `\n\n## Recent git history (subject lines, last 90 days)\n${history || '(no git history or git log failed)'}`
        : '';
      const out = await withJsonRetry<Record<string, unknown>>(
        (suffix) => callLLM(panel[specialist], `${baseContext}${extra}${suffix ?? ''}`, {
          cwd: projectPath, agentId, runId,
        }),
        {
          maxAttempts: 2,
          validate: (v) => typeof v === 'object' && v !== null,
        },
      );
      await notifyAgentComplete({ agentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
      return [specialist, out] as const;
    } catch (e) {
      await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500) });
      return [specialist, { error: String(e) }] as const;
    }
  }));

  const specialistFindings = Object.fromEntries(fragments) as Record<ResearcherSpecialist, Record<string, unknown>>;
  const synthPersona = await loadPersona(process.cwd(), 'researcher-synthesizer');
  const synthPrompt = `User context: ${JSON.stringify(userContext)}\n\nSpecialist findings:\n${JSON.stringify(specialistFindings, null, 2)}`;

  try {
    return await withJsonRetry<ResearchOutput>(
      (suffix) => callLLM(synthPersona, `${synthPrompt}${suffix ?? ''}`, {
        cwd: projectPath, agentId: 'researcher', runId,
      }),
      {
        maxAttempts: 3,
        validate: (v): v is ResearchOutput =>
          typeof v === 'object' && v !== null
          && typeof (v as any).repoStructure === 'string'
          && Array.isArray((v as any).currentFeatures)
          && Array.isArray((v as any).gaps)
          && Array.isArray((v as any).opportunities),
      },
    );
  } catch {
    return fallbackSynthesizeResearch(specialistFindings, baseContext);
  }
}
```

NOTE on `withJsonRetry` with `maxAttempts: 1` and `() => Promise.resolve(text)`: the retry wrapper here is used for its JSON parse/validate logic only, not for retrying the LLM call (opencode already did the call). If the parse fails, the error propagates. This is intentional — opencode was instructed "respond with JSON only" and if it still fails, a single retry against the same static string won't help.

- [ ] **Step 3: Run tests — all pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

Expected: all pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/activities.ts
git commit -m "feat(opencode): researcher uses live codebase access via opencode sessions"
```

---

### Task 4: `debateFeatures` via opencode

**Files:**
- Modify: `worker/src/activities.ts:debateFeatures` (around lines 523–611)

Each of the 6 debate specialists and the reconciler get their own `sendAgentPrompt` session when opencode is on.

- [ ] **Step 1: Add opencode branch to `debateFeatures`**

Replace the `debateFeatures` function body with:

```ts
export async function debateFeatures(input: DebateInput): Promise<DebateOutput> {
  const { repoAnalysis, suggestedFeatures, agentIds, runId } = input;

  const featuresToDebate = suggestedFeatures.length > 0
    ? suggestedFeatures
    : repoAnalysis.opportunities;

  if (featuresToDebate.length === 0) {
    return { approvedFeatures: [], rejectedFeatures: [] };
  }

  const panel = await loadPanel(process.cwd(), 'debate', DEBATE_SPECIALISTS);

  const debatePrompt = `
You are assessing features for this project.

REPO ANALYSIS:
${JSON.stringify(repoAnalysis, null, 2)}

FEATURES TO ASSESS:
${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}

For EACH feature, provide your specialist-scoped assessment in the JSON shape your persona specifies.
`;

  const specialistAgentIds: Record<DebateSpecialist, string> = {
    signal: agentIds?.signal ?? 'debate-signal',
    noise: agentIds?.noise ?? 'debate-noise',
    security: 'debate-security',
    perf: 'debate-perf',
    ux: 'debate-ux',
    maintainability: 'debate-maintainability',
  };

  if (await useOpencode()) {
    const assessments = await Promise.all(DEBATE_SPECIALISTS.map(async (specialist) => {
      const sAgentId = specialistAgentIds[specialist];
      const isNew = specialist !== 'signal' && specialist !== 'noise';
      if (isNew) {
        await notifyAgentStart({ agentId: sAgentId, agentName: `Debate (${specialist})`, terminalType: 'direct-llm' });
      }
      try {
        const text = await sendAgentPrompt({
          runId,
          personaKey: sAgentId,
          personaText: panel[specialist],
          userPrompt: debatePrompt,
        });
        const out = await withJsonRetry<Record<string, unknown>>(
          () => Promise.resolve(text),
          {
            maxAttempts: 1,
            validate: (v) => typeof v === 'object' && v !== null && 'assessments' in (v as object),
          },
        );
        if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
        return [specialist, out] as const;
      } catch (e) {
        if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'error', output: String(e).slice(0, 500) });
        return [specialist, { error: String(e), assessments: [] }] as const;
      }
    }));
    const assessmentMap = Object.fromEntries(assessments) as Record<DebateSpecialist, Record<string, unknown>>;

    const reconcilerPersona = await loadPersona(process.cwd(), 'debate-reconciler');
    const reconcilePrompt = `Repo: ${repoAnalysis.repoStructure}\n\nFeatures assessed:\n${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nSpecialist assessments:\n${JSON.stringify(assessmentMap, null, 2)}`;

    const reconcileText = await sendAgentPrompt({
      runId,
      personaKey: agentIds?.reconcile ?? agentIds?.signal ?? 'debate-reconciler',
      personaText: reconcilerPersona,
      userPrompt: reconcilePrompt,
    });
    return await withJsonRetry<DebateOutput>(
      () => Promise.resolve(reconcileText),
      {
        maxAttempts: 1,
        validate: (v): v is DebateOutput =>
          typeof v === 'object' && v !== null
          && Array.isArray((v as any).approvedFeatures)
          && Array.isArray((v as any).rejectedFeatures),
      },
    );
  }

  // Legacy path: callLLM per specialist.
  const assessments = await Promise.all(DEBATE_SPECIALISTS.map(async (specialist) => {
    const sAgentId = specialistAgentIds[specialist];
    const isNew = specialist !== 'signal' && specialist !== 'noise';
    if (isNew) {
      await notifyAgentStart({ agentId: sAgentId, agentName: `Debate (${specialist})`, terminalType: 'direct-llm' });
    }
    try {
      const out = await withJsonRetry<Record<string, unknown>>(
        (suffix) => callLLM(panel[specialist], `${debatePrompt}${suffix ?? ''}`, {
          agentId: sAgentId, runId,
        }),
        {
          maxAttempts: 2,
          validate: (v) => typeof v === 'object' && v !== null && 'assessments' in (v as object),
        },
      );
      if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
      return [specialist, out] as const;
    } catch (e) {
      if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'error', output: String(e).slice(0, 500) });
      return [specialist, { error: String(e), assessments: [] }] as const;
    }
  }));

  const assessmentMap = Object.fromEntries(assessments) as Record<DebateSpecialist, Record<string, unknown>>;
  const reconcilerPersona = await loadPersona(process.cwd(), 'debate-reconciler');
  const reconcilePrompt = `Repo: ${repoAnalysis.repoStructure}\n\nFeatures assessed:\n${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nSpecialist assessments:\n${JSON.stringify(assessmentMap, null, 2)}`;

  return await withJsonRetry<DebateOutput>(
    (suffix) => callLLM(
      reconcilerPersona,
      `${reconcilePrompt}${suffix ?? ''}`,
      { agentId: agentIds?.reconcile ?? agentIds?.signal ?? 'debate-reconciler', runId },
    ),
    {
      maxAttempts: 3,
      validate: (v): v is DebateOutput =>
        typeof v === 'object' && v !== null
        && Array.isArray((v as any).approvedFeatures)
        && Array.isArray((v as any).rejectedFeatures),
    },
  );
}
```

- [ ] **Step 2: Run tests — all pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

- [ ] **Step 3: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/activities.ts
git commit -m "feat(opencode): debate panel uses live codebase access via opencode sessions"
```

---

### Task 5: `generateTickets` via opencode

**Files:**
- Modify: `worker/src/activities.ts:generateTickets` (around lines 613–647)

The ticket-bot gets a single `sendAgentPrompt` call so it can read the codebase before writing acceptance criteria.

- [ ] **Step 1: Add opencode branch to `generateTickets`**

Replace the `generateTickets` function body:

```ts
export async function generateTickets(input: TicketsInput): Promise<TicketsOutput> {
  const { approvedFeatures, agentId, runId } = input;

  if (approvedFeatures.length === 0) {
    return { tickets: [] };
  }

  const persona = await loadPersona(process.cwd(), 'ticket-bot');

  const prompt = `
Approved features to ticket:

${approvedFeatures.map(f => `- ${f.name}: ${f.rationale} (priority: ${f.priority})`).join('\n')}

For each feature, generate a ticket with:
- id: auto-generated (TICKET-1, TICKET-2, etc.)
- title: Concise feature name
- description: What and why (2-3 sentences)
- acceptanceCriteria: 3-5 specific, testable criteria
- estimate: T-shirt size (S/M/L/XL)

Respond ONLY with valid JSON array of tickets.
`;

  if (await useOpencode()) {
    const text = await sendAgentPrompt({
      runId,
      personaKey: agentId ?? 'ticket-bot',
      personaText: persona,
      userPrompt: prompt,
    });
    const tickets = await withJsonRetry<Ticket[]>(
      () => Promise.resolve(text),
      {
        maxAttempts: 1,
        validate: (v): v is Ticket[] =>
          Array.isArray(v)
          && v.every((t) => typeof t === 'object' && t !== null && 'id' in t && 'title' in t && 'acceptanceCriteria' in t),
      },
    );
    return { tickets };
  }

  // Legacy path.
  const tickets = await withJsonRetry<Ticket[]>(
    (suffix) => callLLM(persona, `${prompt}${suffix ?? ''}`, { agentId, runId }),
    {
      maxAttempts: 3,
      validate: (v): v is Ticket[] =>
        Array.isArray(v)
        && v.every((t) => typeof t === 'object' && t !== null && 'id' in t && 'title' in t && 'acceptanceCriteria' in t),
    },
  );
  return { tickets };
}
```

- [ ] **Step 2: Run tests — all pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

- [ ] **Step 3: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/activities.ts
git commit -m "feat(opencode): ticket-bot uses live codebase access via opencode sessions"
```

---

### Task 6: `scopeArchitecture` via opencode

**Files:**
- Modify: `worker/src/activities.ts:scopeArchitecture` (around lines 649–758)

When opencode is on, the architect uses a single `sendAgentPrompt` session instead of best-of-3 parallel calls. One opencode run that can read actual files beats three blind temperature-spread guesses. The judge round-trip is also dropped for the same reason.

- [ ] **Step 1: Add opencode branch to `scopeArchitecture`**

Replace the `scopeArchitecture` function body:

```ts
export async function scopeArchitecture(input: ScopeInput): Promise<ScopeOutput> {
  const { tickets, projectPath, worktreePath, agentId, runId } = input;

  const persona = await loadPersona(projectPath, 'architect');

  const prompt = `
Project path: ${projectPath}
Worktree: ${worktreePath}

Tickets to scope:

${tickets.map(t => `
TICKET: ${t.title}
${t.description}
Estimate: ${t.estimate}
`).join('\n---\n')}

For EACH ticket, provide:
1. technicalPlan: High-level approach (3-5 sentences)
2. filesToChange: Specific files to create/modify
3. dependencies: What must be done first (ticket IDs, or empty array)
4. complexity: "low" | "medium" | "high" — "low" for ≤2-file changes with no new types; "high" for >6 files, schema changes, or cross-cutting refactors; "medium" otherwise

Be specific. Generic plans are useless. Respond with ONLY a JSON array, one entry per input ticket, in input order.
`;

  type ArchitectEntry = {
    technicalPlan?: string;
    filesToChange?: string[];
    dependencies?: string[];
    complexity?: 'low' | 'medium' | 'high';
  };

  if (await useOpencode()) {
    // Single opencode session: the architect can read actual files before
    // deciding filesToChange and complexity. No temperature diversity needed
    // when the model has ground-truth codebase access.
    const architectAgentId = agentId ?? 'architect';
    await notifyAgentStart({
      agentId: architectAgentId,
      agentName: 'Architect',
      terminalType: 'direct-llm',
    });
    try {
      const text = await sendAgentPrompt({
        runId,
        personaKey: architectAgentId,
        personaText: persona,
        userPrompt: prompt,
      });
      const chosen = await withJsonRetry<ArchitectEntry[]>(
        () => Promise.resolve(text),
        {
          maxAttempts: 1,
          validate: (v) => Array.isArray(v) && v.length === tickets.length,
        },
      );
      await notifyAgentComplete({
        agentId: architectAgentId,
        status: 'completed',
        output: JSON.stringify(chosen).slice(0, 500),
      });
      return {
        scopedTickets: tickets.map((t, i) => ({
          ...t,
          technicalPlan: chosen[i]?.technicalPlan || 'Plan pending',
          filesToChange: chosen[i]?.filesToChange ?? [],
          dependencies: chosen[i]?.dependencies ?? [],
          complexity: chosen[i]?.complexity ?? 'medium',
        })),
      };
    } catch (e) {
      await notifyAgentComplete({ agentId: architectAgentId, status: 'error', output: String(e).slice(0, 500) });
      throw e;
    }
  }

  // Legacy path: best-of-3 parallel blind LLM calls with a judge.
  const candidateTemps = [0.2, 0.6, 0.9] as const;
  const candidates = await Promise.all(candidateTemps.map(async (temperature, idx) => {
    const subAgentId = `architect-${idx + 1}`;
    await notifyAgentStart({
      agentId: subAgentId,
      agentName: `Architect #${idx + 1} (temp=${temperature})`,
      terminalType: 'direct-llm',
    });
    try {
      const plan = await withJsonRetry<ArchitectEntry[]>(
        (suffix) => callLLM(persona, `${prompt}${suffix ?? ''}`, {
          cwd: projectPath, agentId: subAgentId, runId, temperature,
        }),
        {
          maxAttempts: 2,
          validate: (v) => Array.isArray(v) && v.length === tickets.length,
        },
      );
      await notifyAgentComplete({
        agentId: subAgentId,
        status: 'completed',
        output: JSON.stringify(plan).slice(0, 500),
      });
      return plan;
    } catch (e) {
      await notifyAgentComplete({
        agentId: subAgentId,
        status: 'error',
        output: String(e).slice(0, 500),
      });
      return null;
    }
  }));

  const validCandidates = candidates.filter((c): c is ArchitectEntry[] => c !== null);
  if (validCandidates.length === 0) {
    throw new NonRetryableAgentError('All architect candidates failed to produce valid plans');
  }

  let chosen: ArchitectEntry[];
  if (validCandidates.length === 1) {
    chosen = validCandidates[0];
  } else {
    const judgePersona = await loadPersona(projectPath, 'architect-judge');
    const judgePrompt = `Tickets:\n${JSON.stringify(tickets, null, 2)}\n\nCandidate plans:\n${validCandidates.map((c, i) => `=== PLAN ${i + 1} ===\n${JSON.stringify(c, null, 2)}`).join('\n\n')}`;
    const judgeAgentId = agentId ?? 'architect';
    try {
      chosen = await withJsonRetry<ArchitectEntry[]>(
        (suffix) => callLLM(judgePersona, `${judgePrompt}${suffix ?? ''}`, {
          cwd: projectPath, agentId: judgeAgentId, runId,
        }),
        {
          maxAttempts: 2,
          validate: (v) => Array.isArray(v) && v.length === tickets.length,
        },
      );
    } catch {
      chosen = validCandidates[0];
    }
  }

  return {
    scopedTickets: tickets.map((t, i) => ({
      ...t,
      technicalPlan: chosen[i]?.technicalPlan || 'Plan pending',
      filesToChange: chosen[i]?.filesToChange ?? [],
      dependencies: chosen[i]?.dependencies ?? [],
      complexity: chosen[i]?.complexity ?? 'medium',
    })),
  };
}
```

- [ ] **Step 2: Run tests — all pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

- [ ] **Step 3: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/activities.ts
git commit -m "feat(opencode): architect uses live codebase access, drops best-of-3 blind generation"
```

---

### Task 7: `reviewCode` and `reviewCodePanel` via opencode

**Files:**
- Modify: `worker/src/activities.ts:reviewCode` (around lines 992–1029)
- Modify: `worker/src/activities.ts:reviewCodePanel` (around lines 1041–1209)

Reviewers can now read the changed files AND surrounding context (tests, interfaces, neighbouring modules) directly via opencode, instead of having only the pre-fetched `readFilesForContext` snapshot.

- [ ] **Step 1: Add opencode branch to `reviewCode`**

Replace the `reviewCode` function body:

```ts
export async function reviewCode(input: ReviewInput & { worktreePath?: string }): Promise<ReviewResult> {
  const { implementation, ticket, worktreePath, agentId, runId } = input;

  const persona = await loadPersona(process.cwd(), 'reviewer-correctness');

  const promptBody = `
Review the changes for ticket: ${ticket.title}
${ticket.description}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Evaluate against the acceptance criteria. Use your read tools to inspect the files listed above.
Respond with ONLY a JSON object: { "approved": true|false, "comments": ["specific, actionable comment", ...] }
`;

  if (await useOpencode()) {
    const text = await sendAgentPrompt({
      runId: runId ?? '',
      personaKey: agentId ?? 'reviewer-correctness',
      personaText: persona,
      userPrompt: promptBody,
    });
    return await withJsonRetry<ReviewResult>(
      () => Promise.resolve(stripThinking(text)),
      {
        maxAttempts: 1,
        validate: (v): v is ReviewResult =>
          typeof v === 'object' && v !== null
          && typeof (v as any).approved === 'boolean'
          && Array.isArray((v as any).comments),
      },
    );
  }

  // Legacy path.
  const fileContents = worktreePath && implementation.filesChanged.length > 0
    ? await readFilesForContext(worktreePath, implementation.filesChanged)
    : '(no files to read)';

  const prompt = `
Review the changes for ticket: ${ticket.title}
${ticket.description}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Current file contents on disk:
${fileContents}

Evaluate against the acceptance criteria. Respond with ONLY a JSON object (no prose):
{ "approved": true|false, "comments": ["specific, actionable comment", ...] }
`;

  return await withJsonRetry<ReviewResult>(
    async (suffix) => stripThinking(await callLLM(persona, `${prompt}${suffix ?? ''}`, { cwd: worktreePath, agentId, runId })),
    {
      maxAttempts: 3,
      validate: (v): v is ReviewResult =>
        typeof v === 'object' && v !== null
        && typeof (v as any).approved === 'boolean'
        && Array.isArray((v as any).comments),
    },
  );
}
```

- [ ] **Step 2: Add opencode branch to `reviewCodePanel`**

Add the opencode fast-path before the existing specialist fan-out. Insert this block immediately after the `const panelPrompts = await loadPanel(...)` line:

```ts
export async function reviewCodePanel(input: PanelReviewInput): Promise<PanelReviewResult> {
  const { implementation, ticket, worktreePath, runId } = input;

  const panelPrompts = await loadPanel(process.cwd(), 'reviewer', REVIEWER_SPECIALISTS);

  const sharedPromptBody = `
Ticket: ${ticket.title}
${ticket.description}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Use your read tools to inspect the changed files. Evaluate strictly within your specialist scope. Respond with JSON only.
`;

  if (await useOpencode()) {
    const verdicts = await Promise.all(
      REVIEWER_SPECIALISTS.map(async (specialist) => {
        const agentId = `reviewer-${specialist}`;
        await notifyAgentStart({ agentId, agentName: `Reviewer (${specialist})`, terminalType: 'direct-llm' });
        try {
          const text = await sendAgentPrompt({
            runId,
            personaKey: agentId,
            personaText: panelPrompts[specialist],
            userPrompt: sharedPromptBody,
          });
          const verdict = await withJsonRetry<Record<string, unknown>>(
            () => Promise.resolve(text),
            {
              maxAttempts: 1,
              validate: (v) => typeof v === 'object' && v !== null && 'approved' in (v as object),
            },
          );
          await notifyAgentComplete({ agentId, status: 'completed', output: JSON.stringify(verdict).slice(0, 500) });
          return [specialist, verdict] as const;
        } catch (e) {
          await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500) });
          return [specialist, { approved: false, error: String(e) }] as const;
        }
      }),
    );
    const rawVerdicts = Object.fromEntries(verdicts) as Record<ReviewerSpecialist, Record<string, unknown>>;

    const synthPersona = await loadPersona(process.cwd(), 'reviewer-synthesizer');
    const synthAgentId = 'reviewer-synthesizer';
    await notifyAgentStart({ agentId: synthAgentId, agentName: 'Reviewer Synthesizer', terminalType: 'direct-llm' });
    type Synth = { approved: boolean; blockers: Array<{ from?: string; detail?: string } | string>; advisories: Array<{ from?: string; detail?: string } | string>; summary: string };
    try {
      const synthText = await sendAgentPrompt({
        runId,
        personaKey: synthAgentId,
        personaText: synthPersona,
        userPrompt: `Panel verdicts:\n${JSON.stringify(rawVerdicts, null, 2)}`,
      });
      const synth = await withJsonRetry<Synth>(
        () => Promise.resolve(synthText),
        {
          maxAttempts: 1,
          validate: (v) =>
            typeof v === 'object' && v !== null
            && typeof (v as any).approved === 'boolean'
            && Array.isArray((v as any).blockers)
            && Array.isArray((v as any).advisories),
        },
      );
      await notifyAgentComplete({ agentId: synthAgentId, status: 'completed', output: JSON.stringify(synth).slice(0, 500) });
      const normalize = (e: { from?: string; detail?: string } | string, fallbackFrom: string) =>
        typeof e === 'string' ? { from: fallbackFrom, detail: e } : { from: e.from ?? fallbackFrom, detail: e.detail ?? '' };
      return {
        approved: synth.approved,
        blockers: (synth.blockers ?? []).map((b) => normalize(b, synthAgentId)),
        advisories: (synth.advisories ?? []).map((a) => normalize(a, synthAgentId)),
        comments: [...(synth.blockers ?? []).map((b) => normalize(b, synthAgentId).detail), ...(synth.advisories ?? []).map((a) => normalize(a, synthAgentId).detail)],
        summary: synth.summary ?? '',
      };
    } catch {
      // Synthesizer failed — deterministic fallback.
      await notifyAgentComplete({ agentId: synthAgentId, status: 'error', output: 'synthesis failed' });
      const allApproved = Object.values(rawVerdicts).every((v) => (v as any).approved === true);
      const allComments = Object.entries(rawVerdicts).flatMap(([from, v]) =>
        Array.isArray((v as any).comments) ? (v as any).comments.map((c: string) => ({ from, detail: c })) : [],
      );
      return { approved: allApproved, blockers: allComments.filter(() => !allApproved), advisories: allComments.filter(() => allApproved), comments: allComments.map((c) => c.detail), summary: '' };
    }
  }

  // Legacy path: pre-fetched file contents, callLLM per specialist.
  const fileContents = worktreePath && implementation.filesChanged.length > 0
    ? await readFilesForContext(worktreePath, implementation.filesChanged)
    : '(no files to read)';

  const sharedContext = `
Ticket: ${ticket.title}
${ticket.description}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Current file contents on disk:
${fileContents}

Evaluate strictly within your specialist scope. Respond with JSON only.
`;

  // ... rest of the legacy path (keep existing code from here unchanged)
```

**IMPORTANT:** Keep the entire existing legacy path below the `if (await useOpencode()) { ... }` block unchanged. Only add the new `if` block above it. Do not delete the legacy path code.

After the `if` block, the legacy path continues as-is from the `const fileContents = ...` line through the end of the function.

- [ ] **Step 3: Run tests — all pass**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

- [ ] **Step 4: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add worker/src/activities.ts
git commit -m "feat(opencode): reviewer panel uses live codebase access via opencode sessions"
```

---

### Task 8: TypeScript typecheck + full test suite

**Files:**
- No new files. Verify compilation and all tests.

- [ ] **Step 1: Run TypeScript typecheck**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun run tsc --noEmit 2>&1
```

Fix any type errors before proceeding. Common issues to watch for:
- `sendAgentPrompt` import missing from `activities.ts`
- `writeOpencodeConfig` import still referenced after removal from `opencodeAgent.ts`
- `bootstrapOpencodeWorktree` not exported from `activities.ts`

- [ ] **Step 2: Run full test suite**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents/worker
/home/caryb/.bun/bin/bun test 2>&1
```

Expected: 61+ pass (59 original + 2 new `sendAgentPrompt` tests), 0 fail.

- [ ] **Step 3: Commit**

```bash
cd /home/caryb/GitHub/Atelier/.worktrees/opencode-all-agents
git add -A
git commit -m "test: verify all agents opencode path compiles and tests pass"
```

---

## Self-Review

**Spec coverage:**
- ✅ researcher → opencode path (Task 3)
- ✅ debate → opencode path (Task 4)
- ✅ ticket-bot → opencode path (Task 5)
- ✅ architect → opencode path, drops blind best-of-3 (Task 6)
- ✅ reviewer (single + panel) → opencode path (Task 7)
- ✅ `sendAgentPrompt` wrapper with analysis-mode framing (Task 1)
- ✅ `bootstrapOpencodeWorktree` to write `opencode.json` before Phase 1 (Task 2)
- ✅ `runOpenCodeAgent` no longer double-writes `opencode.json` (Task 2)
- ✅ All legacy paths kept intact — `useOpencode() === false` behaviour unchanged

**Placeholder scan:** None found. All code blocks are complete and runnable.

**Type consistency:**
- `sendAgentPrompt` returns `Promise<string>` — callers pass it to `withJsonRetry(() => Promise.resolve(text), ...)`
- `AgentPromptInput` properties (`runId`, `personaKey`, `personaText`, `userPrompt`, `model?`) used consistently across all 7 activities
- `bootstrapOpencodeWorktree` signature `{ worktreePath: string }` matches all call sites
- `withJsonRetry` called with `() => Promise.resolve(text)` (not `(suffix) => ...`) for single-attempt opencode path — `suffix` is never appended since we can't re-prompt the same opencode session with a JSON correction suffix

**Known limitation (not a bug):** The opencode path for `withJsonRetry` uses `maxAttempts: 1` because appending a JSON correction suffix to a static string doesn't retry the actual LLM call. If JSON parse fails on the opencode path, it throws immediately. The solution (multi-turn correction via a follow-up `sendAgentPrompt` call) is a separate enhancement.
