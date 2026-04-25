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
  reviewCode,
  testCode,
  pushChanges,
  notifyAgentStart,
  notifyAgentComplete,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: { maximumAttempts: 1 },
});

export interface AutopilotInput {
  projectPath: string;
  projectSlug: string;
  runId: string;
  userContext?: Record<string, string>;
  suggestedFeatures?: string[];
}

export interface AutopilotOutput {
  status: 'completed' | 'failed' | 'stalled';
  ticketsCreated: number;
  prBranch?: string;
  error?: string;
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

  try {
    // Phase 0: Create git worktree for isolated work
    const { worktreePath } = await setupWorkspace({ projectPath, projectSlug, runId });

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

    // Phase 5-8: Implement → Review → Test → Push (per ticket, with loops)
    for (const ticket of scopedTickets) {
      await notifyAgentStart({ agentId: 'developer', agentName: 'Developer', terminalType: 'terminal' });
      const implOutput = await implementCode({ ticket, worktreePath, projectPath, agentId: 'developer', runId });
      const implementation = { ticketId: ticket.id, code: implOutput.code, filesChanged: implOutput.filesChanged };
      await notifyAgentComplete({
        agentId: 'developer',
        status: 'completed',
        output: `ticket ${ticket.id}\nchanged: ${implementation.filesChanged.join(', ') || '(none)'}`,
      });

      let reviewApproved = false;
      for (let reviewLoop = 0; reviewLoop < 3 && !reviewApproved; reviewLoop++) {
        await notifyAgentStart({ agentId: 'reviewer', agentName: 'Code Reviewer', terminalType: 'terminal' });
        const reviewResult = await reviewCode({ implementation, ticket, worktreePath, agentId: 'reviewer', runId });
        await notifyAgentComplete({
          agentId: 'reviewer',
          status: 'completed',
          output: `approved: ${reviewResult.approved}\n${reviewResult.comments.join('\n')}`,
        });
        if (reviewResult.approved) {
          reviewApproved = true;
        } else {
          const revised = await implementCode({ ticket, worktreePath, projectPath, feedback: reviewResult.comments, agentId: 'developer', runId });
          implementation.code = revised.code;
          implementation.filesChanged = revised.filesChanged;
        }
      }
      if (!reviewApproved) {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, error: `Review loop exceeded for ticket ${ticket.id}` };
      }

      let testsPassed = false;
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
          const fixed = await implementCode({ ticket, worktreePath, projectPath, testFeedback: testResult.failures, agentId: 'developer', runId });
          implementation.code = fixed.code;
          implementation.filesChanged = fixed.filesChanged;
        }
      }
      if (!testsPassed) {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, error: `Test loop exceeded for ticket ${ticket.id}` };
      }
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
  } catch (e) {
    return { status: 'failed', ticketsCreated: 0, error: String(e) };
  }
}
