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

export async function autopilotWorkflow(input: AutopilotInput): Promise<AutopilotOutput> {
  const { projectPath, projectSlug, runId, userContext = {}, suggestedFeatures = [] } = input;

  try {
    // Phase 0: Create git worktree for isolated work
    const { worktreePath } = await setupWorkspace({ projectPath, projectSlug, runId });

    // Phase 1: Repository Analysis
    await notifyAgentStart({ agentId: 'researcher', agentName: 'Research Agent', terminalType: 'terminal' });
    const repoAnalysis = await researchRepo({ projectPath, userContext });
    await notifyAgentComplete({ agentId: 'researcher', status: 'completed' });

    // Phase 2: Roadmap Debate
    // debateFeatures activity internally runs Debate A and Debate B in parallel
    const { approvedFeatures } = await debateFeatures({
      repoAnalysis,
      suggestedFeatures,
    });

    // Phase 3: Ticket Generation
    await notifyAgentStart({ agentId: 'ticket-bot', agentName: 'Ticket Bot', terminalType: 'direct-llm' });
    const { tickets } = await generateTickets({ approvedFeatures });
    await notifyAgentComplete({ agentId: 'ticket-bot', status: 'completed' });

    // Phase 4: Scope & Plan
    await notifyAgentStart({ agentId: 'architect', agentName: 'Architect', terminalType: 'terminal' });
    const { scopedTickets } = await scopeArchitecture({ tickets, projectPath, worktreePath });
    await notifyAgentComplete({ agentId: 'architect', status: 'completed' });

    // Phase 5-8: Implement → Review → Test → Push (per ticket, with loops)
    for (const ticket of scopedTickets) {
      // Implement
      await notifyAgentStart({ agentId: 'developer', agentName: 'Developer', terminalType: 'terminal' });
      const implOutput = await implementCode({ ticket, worktreePath, projectPath });
      const implementation = { ticketId: ticket.id, code: implOutput.code, filesChanged: implOutput.filesChanged };
      await notifyAgentComplete({ agentId: 'developer', status: 'completed' });

      // Review (max 3 loops)
      let reviewApproved = false;
      for (let reviewLoop = 0; reviewLoop < 3 && !reviewApproved; reviewLoop++) {
        await notifyAgentStart({ agentId: 'reviewer', agentName: 'Code Reviewer', terminalType: 'terminal' });
        const reviewResult = await reviewCode({ implementation, ticket, worktreePath });
        await notifyAgentComplete({ agentId: 'reviewer', status: 'completed' });
        if (reviewResult.approved) {
          reviewApproved = true;
        } else {
          // Developer addresses feedback
          const revised = await implementCode({ ticket, worktreePath, projectPath, feedback: reviewResult.comments });
          implementation.code = revised.code;
          implementation.filesChanged = revised.filesChanged;
        }
      }
      if (!reviewApproved) {
        return { status: 'stalled', ticketsCreated: scopedTickets.length, error: `Review loop exceeded for ticket ${ticket.id}` };
      }

      // Test (max 3 loops)
      let testsPassed = false;
      for (let testLoop = 0; testLoop < 3 && !testsPassed; testLoop++) {
        await notifyAgentStart({ agentId: 'tester', agentName: 'Tester', terminalType: 'terminal' });
        const testResult = await testCode({ implementation, ticket, worktreePath });
        await notifyAgentComplete({ agentId: 'tester', status: 'completed' });
        if (testResult.allPassed) {
          testsPassed = true;
        } else {
          // Developer fixes test failures
          const fixed = await implementCode({ ticket, worktreePath, projectPath, testFeedback: testResult.failures });
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
    await notifyAgentComplete({ agentId: 'pusher', status: 'completed' });

    return {
      status: 'completed',
      ticketsCreated: scopedTickets.length,
      prBranch: pushResult.branch,
    };
  } catch (e) {
    return { status: 'failed', ticketsCreated: 0, error: String(e) };
  }
}
