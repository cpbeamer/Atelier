// worker/src/workflows/greenfield.workflow.ts
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities.js';
import type { Implementation } from '../activities.js';

const {
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

export interface GreenfieldInput {
  projectPath: string;
  projectSlug: string;
  runId: string;
  userRequest: string;
}

export async function greenfieldWorkflow(input: GreenfieldInput): Promise<any> {
  const { projectPath, projectSlug, runId, userRequest } = input;
  const worktreePath = `${process.env.HOME ?? '/root'}/.atelier/worktrees/${projectSlug}/${runId}`;

  // Validate and create initial tickets from user's NLP request
  await notifyAgentStart({ agentId: 'validator', agentName: 'Request Validator', terminalType: 'direct-llm' });
  const { tickets } = await generateTickets({
    approvedFeatures: [{ name: userRequest, rationale: 'User requested directly', priority: 'high' }],
    agentId: 'validator',
  });
  await notifyAgentComplete({ agentId: 'validator', status: 'completed' });

  // Scope tickets
  await notifyAgentStart({ agentId: 'architect', agentName: 'Architect', terminalType: 'terminal' });
  const scopeResult = await scopeArchitecture({ tickets, projectPath, worktreePath, agentId: 'architect' });
  const scopedTickets = scopeResult.scopedTickets;
  await notifyAgentComplete({ agentId: 'architect', status: 'completed' });

  // Implement → Review (3x) → Test (3x) per ticket
  for (const ticket of scopedTickets) {
    await notifyAgentStart({ agentId: 'developer', agentName: 'Developer', terminalType: 'terminal' });
    const implResult = await implementCode({ ticket, worktreePath, projectPath, agentId: 'developer' });
    await notifyAgentComplete({ agentId: 'developer', status: 'completed' });

    const implementation: Implementation = {
      ticketId: ticket.id,
      code: implResult.code,
      filesChanged: implResult.filesChanged,
    };

    // Review loop
    let reviewApproved = false;
    for (let i = 0; i < 3 && !reviewApproved; i++) {
      await notifyAgentStart({ agentId: 'reviewer', agentName: 'Code Reviewer', terminalType: 'terminal' });
      const result = await reviewCode({ implementation, ticket, agentId: 'reviewer', runId });
      await notifyAgentComplete({ agentId: 'reviewer', status: 'completed' });
      if (result.approved) {
        reviewApproved = true;
      } else {
        const revised = await implementCode({ ticket, worktreePath, projectPath, feedback: result.comments, agentId: 'developer' });
        implementation.code = revised.code;
        implementation.filesChanged = revised.filesChanged;
      }
    }
    if (!reviewApproved) return { status: 'stalled', error: `Review loop exceeded for ${ticket.id}` };

    // Test loop
    let testsPassed = false;
    for (let i = 0; i < 3 && !testsPassed; i++) {
      await notifyAgentStart({ agentId: 'tester', agentName: 'Tester', terminalType: 'terminal' });
      const result = await testCode({ implementation, ticket });
      await notifyAgentComplete({ agentId: 'tester', status: 'completed' });
      if (result.allPassed) {
        testsPassed = true;
      } else {
        const fixed = await implementCode({ ticket, worktreePath, projectPath, testFeedback: result.failures, agentId: 'developer' });
        implementation.code = fixed.code;
        implementation.filesChanged = fixed.filesChanged;
      }
    }
    if (!testsPassed) return { status: 'stalled', error: `Test loop exceeded for ${ticket.id}` };
  }

  // Push
  await notifyAgentStart({ agentId: 'pusher', agentName: 'Pusher', terminalType: 'direct-llm' });
  const pushResult = await pushChanges({ worktreePath, projectPath, tickets: scopedTickets });
  await notifyAgentComplete({ agentId: 'pusher', status: 'completed' });

  return { status: 'completed', ticketsCreated: scopedTickets.length, prBranch: pushResult.branch };
}
