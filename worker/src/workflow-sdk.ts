// worker/src/workflow-sdk.ts
import { proxyActivities, condition } from '@temporalio/workflow';

const activityDefaults = { startToCloseTimeout: '10 minutes' };

const activities = proxyActivities<{
  callAgent: (agentName: string, input: unknown) => Promise<{ output: string; agentName: string }>;
  createMilestone: (name: string, payload: unknown) => Promise<string>;
  resolveMilestone: (milestoneId: string, decision: { verdict: string; reason?: string; decidedBy: string }) => Promise<void>;
}>(activityDefaults);

export async function callAgent(ctx: { runId: string; projectId: string }, agentName: string, input: unknown) {
  return activities.callAgent(agentName, input);
}

export async function milestone(ctx: { runId: string; projectId: string }, name: string, payload: unknown) {
  const milestoneId = await activities.createMilestone(name, payload);
  // Blocks until UI resolves via milestone.decision IPC
  await condition(() => false, '7d'); // placeholder — real impl uses signal
  return { verdict: 'Approved' as const, decidedBy: 'user' as const, decidedAt: new Date() };
}

export function defineWorkflow<T extends { input: unknown }>(config: {
  name: string;
  input: unknown;
  run: (ctx: { runId: string; projectId: string }, input: T['input']) => Promise<unknown>;
}) {
  return config;
}
