// worker/src/workflows/agent-child.ts
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities.js';

const { spawnAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
});

export interface AgentChildInput {
  agentName: string;
  persona: string;  // persona key e.g., 'researcher-a'
  task: string;
  context?: Record<string, string>;
}

export async function agentChild(input: AgentChildInput): Promise<string> {
  console.log(`Agent child started: ${input.agentName}`);

  const result = await spawnAgent(
    input.agentName,
    input.persona,
    input.task,
    input.context
  );

  console.log(`Agent child completed: ${input.agentName}`);
  return result;
}
