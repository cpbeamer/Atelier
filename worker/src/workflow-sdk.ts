// worker/src/workflow-sdk.ts
import { proxyActivities } from '@temporalio/workflow';

const activityDefaults = { startToCloseTimeout: '10 minutes' };

const { spawnAgent, createMilestone: activityCreateMilestone } = proxyActivities<{
  spawnAgent: (agentName: string, persona: string, task: string, context?: Record<string, string>) => Promise<string>;
  createMilestone: (name: string, payload: unknown) => Promise<{ verdict: string; reason?: string; decidedBy: string }>;
}>(activityDefaults);

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
  // Create milestone in backend - this returns the decision when resolved
  // For MVP, we poll the backend. Future impl uses Temporal signals.
  const result = await activityCreateMilestone(name, payload);
  return result as { verdict: 'Approved' | 'Rejected'; reason?: string; decidedBy: string };
}

export function defineWorkflow<T extends { input: unknown }>(config: {
  name: string;
  input: unknown;
  run: (input: T['input']) => Promise<unknown>;
}) {
  return config;
}