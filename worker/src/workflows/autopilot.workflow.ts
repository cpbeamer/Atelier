// worker/src/workflows/autopilot.workflow.ts
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities.js';

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
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  // Retry on transient LLM/network failures. NonRetryableAgentError (thrown from
  // activities for structural failures like "developer produced zero edits") is
  // excluded so we don't burn three attempts on something a retry can't fix.
  retry: {
    maximumAttempts: 3,
    initialInterval: '2s',
    backoffCoefficient: 2.0,
    maximumInterval: '1 minute',
    nonRetryableErrorTypes: ['NonRetryableAgentError'],
  },
});

export interface AutopilotInput {
  projectPath: string;
  projectSlug: string;
  runId: string;
  userContext?: Record<string, string>;
  suggestedFeatures?: string[];
}

export interface AutopilotOutput {
  /** 'completed' = all tickets shipped; 'stalled' = review/test loop exhausted.
   *  'failed' is no longer returned — genuine failures now throw and surface as
   *  Temporal workflow failures, where they can be inspected via the Temporal UI. */
  status: 'completed' | 'stalled';
  ticketsCreated: number;
  prBranch?: string;
  stalledReason?: string;
}

function summarize(value: unknown, maxLen = 2500): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen) + `\n… [truncated ${s.length - maxLen} chars]` : s;
  } catch {
    return String(value);
  }
}

export async function autopilotWorkflow(input: AutopilotInput): Promise<AutopilotOutput> {
  const { projectPath, projectSlug, runId, userContext = {}, suggestedFeatures = [] } = input;
  let opencodeStarted = false;
  try {

  // Note: no top-level try/catch here on purpose. Genuine failures propagate to
  // Temporal so the workflow history records them and operators can see what
  // went wrong. Only "stalled" (loop exhaustion) is a graceful early-return.

  // Phase 0: Create git worktree for isolated work
  const { worktreePath } = await setupWorkspace({ projectPath, projectSlug, runId });

  // If opencode is the chosen backend, start the per-run serve.
  if (await useOpencodeForRun()) {
    await startRunOpencode({ runId, worktreePath });
    opencodeStarted = true;
  }

  // Phase 1: Repository Analysis
  await notifyAgentStart({ agentId: 'researcher', agentName: 'Research Agent', terminalType: 'terminal' });
  const repoAnalysis = await researchRepo({ projectPath, userContext, agentId: 'researcher', runId });
  await notifyAgentComplete({ agentId: 'researcher', status: 'completed', output: summarize(repoAnalysis) });

  // Phase 2: Roadmap Debate (debate-a + debate-b run in parallel inside the activity)
  await notifyAgentStart({ agentId: 'debate-a', agentName: 'Debate Signal', terminalType: 'terminal' });
  await notifyAgentStart({ agentId: 'debate-b', agentName: 'Debate Noise', terminalType: 'terminal' });
  const { approvedFeatures } = await debateFeatures({
    repoAnalysis,
    suggestedFeatures,
    agentIds: { signal: 'debate-a', noise: 'debate-b', reconcile: 'debate-a' },
    runId,
  });
  await notifyAgentComplete({ agentId: 'debate-a', status: 'completed', output: summarize(approvedFeatures) });
  await notifyAgentComplete({ agentId: 'debate-b', status: 'completed', output: summarize(approvedFeatures) });

  // Phase 3: Ticket Generation
  await notifyAgentStart({ agentId: 'ticket-bot', agentName: 'Ticket Bot', terminalType: 'direct-llm' });
  const { tickets } = await generateTickets({ approvedFeatures, agentId: 'ticket-bot', runId });
  await notifyAgentComplete({ agentId: 'ticket-bot', status: 'completed', output: summarize(tickets) });

  // Phase 4: Scope & Plan
  await notifyAgentStart({ agentId: 'architect', agentName: 'Architect', terminalType: 'terminal' });
  const { scopedTickets } = await scopeArchitecture({ tickets, projectPath, worktreePath, agentId: 'architect', runId });
  await notifyAgentComplete({ agentId: 'architect', status: 'completed', output: summarize(scopedTickets) });

  // Phase 5-8: Implement → Review → Test → Push (per ticket, with loops).
  // High-complexity tickets go through best-of-N with a judge; low/medium use
  // the single-pass implementCode (faster, usually sufficient).
  for (const ticket of scopedTickets) {
    await notifyAgentStart({ agentId: 'developer', agentName: 'Developer', terminalType: 'terminal' });
    const implOutput = ticket.complexity === 'high'
      ? await implementCodeBestOfN({ ticket, worktreePath, projectPath, agentId: 'developer', runId, n: 3 })
      : await implementCode({ ticket, worktreePath, projectPath, agentId: 'developer', runId });
    const implementation = { ticketId: ticket.id, code: implOutput.code, filesChanged: implOutput.filesChanged };
    await notifyAgentComplete({
      agentId: 'developer',
      status: 'completed',
      output: `ticket ${ticket.id}\nchanged: ${implementation.filesChanged.join(', ') || '(none)'}`,
    });

    // Review loop — 4-specialist panel + synthesizer. Sub-agent notifications
    // are emitted inside reviewCodePanel; we keep this loop oblivious to the
    // fan-out shape so tightening/relaxing the panel doesn't churn the workflow.
    let reviewApproved = false;
    for (let reviewLoop = 0; reviewLoop < 3 && !reviewApproved; reviewLoop++) {
      const reviewResult = await reviewCodePanel({ implementation, ticket, worktreePath, runId });
      if (reviewResult.approved) {
        reviewApproved = true;
      } else {
        const revised = await implementCode({
          ticket, worktreePath, projectPath,
          feedback: reviewResult.comments,
          agentId: 'developer',
          runId,
        });
        implementation.code = revised.code;
        implementation.filesChanged = revised.filesChanged;
      }
    }
    if (!reviewApproved) {
      const decision = await emitStalledMilestone({
        runId,
        kind: 'review',
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        lastAttemptSummary: implementation.code.slice(0, 2000),
      });
      if (decision.decision === 'abort') {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, stalledReason: `review stalled: ${decision.reason}` };
      }
      // 'skip' — move on to the next ticket without attempting tests on this one
      continue;
    }

    let testsPassed = false;
    let lastTestFailures: string[] = [];
    for (let testLoop = 0; testLoop < 3 && !testsPassed; testLoop++) {
      await notifyAgentStart({ agentId: 'tester', agentName: 'Tester', terminalType: 'terminal' });
      const testResult = await testCode({ implementation, ticket, worktreePath, runId });
      await notifyAgentComplete({
        agentId: 'tester',
        status: 'completed',
        output: `allPassed: ${testResult.allPassed}\n${testResult.failures.join('\n')}`,
      });
      if (testResult.allPassed) {
        testsPassed = true;
      } else {
        lastTestFailures = testResult.failures;
        const fixed = await implementCode({ ticket, worktreePath, projectPath, testFeedback: testResult.failures, agentId: 'developer', runId });
        implementation.code = fixed.code;
        implementation.filesChanged = fixed.filesChanged;
      }
    }
    if (!testsPassed) {
      const decision = await emitStalledMilestone({
        runId,
        kind: 'test',
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        lastAttemptSummary: `Last test failures:\n${lastTestFailures.join('\n')}`,
      });
      if (decision.decision === 'abort') {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, stalledReason: `test stalled: ${decision.reason}` };
      }
      // 'skip' — accept the failing ticket and move on. The verifier + reviewer
      // already caught everything they could; if the user explicitly approves
      // skipping, that's an informed decision.
      continue;
    }
  }

  // Phase 7.5: Verify (typecheck + lint). One auto-fix pass against the last
  // ticket if it fails — often the most recent edit introduced the regression.
  // If still failing, stall with the verifier output so humans can intervene.
  await notifyAgentStart({ agentId: 'verifier', agentName: 'Verifier', terminalType: 'direct-llm' });
  let verifyResult = await verifyCode({ worktreePath });
  if (!verifyResult.allPassed && scopedTickets.length > 0) {
    const failures = verifyResult.results
      .filter((r) => !r.passed)
      .map((r) => `[${r.label}]\n${r.output}`);
    const lastTicket = scopedTickets[scopedTickets.length - 1];
    const implementation = { ticketId: lastTicket.id, code: '', filesChanged: [] as string[] };
    const fixed = await implementCode({ ticket: lastTicket, worktreePath, projectPath, testFeedback: failures, agentId: 'developer', runId });
    implementation.code = fixed.code;
    implementation.filesChanged = fixed.filesChanged;
    verifyResult = await verifyCode({ worktreePath });
  }
  await notifyAgentComplete({
    agentId: 'verifier',
    status: verifyResult.allPassed ? 'completed' : 'error',
    output: verifyResult.results.map((r) => `${r.label}: ${r.passed ? 'PASS' : 'FAIL'}\n${r.output}`).join('\n---\n'),
  });
  if (!verifyResult.allPassed) {
    return {
      status: 'stalled',
      ticketsCreated: scopedTickets.length,
      stalledReason: `verify failed: ${verifyResult.results.filter((r) => !r.passed).map((r) => r.label).join(', ')}`,
    };
  }

  // Phase 8: Push
  await notifyAgentStart({ agentId: 'pusher', agentName: 'Pusher', terminalType: 'direct-llm' });
  const pushResult = await pushChanges({ worktreePath, projectPath, tickets: scopedTickets });
  await notifyAgentComplete({
    agentId: 'pusher',
    status: 'completed',
    output: `branch: ${pushResult.branch}\ncommit: ${pushResult.commitSha}`,
  });

  return {
    status: 'completed',
    ticketsCreated: scopedTickets.length,
    prBranch: pushResult.branch,
  };
  } finally {
    if (opencodeStarted) {
      try {
        await stopRunOpencode({ runId });
      } catch {
        // Swallow cleanup errors so the original failure (if any) propagates
        // unmasked. A leaked subprocess is preferable to losing the real
        // failure reason in Temporal history; the backend's process tracking
        // will GC it when the run record is cleaned up.
      }
    }
  }
}
