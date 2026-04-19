// worker/src/workflow-sdk.ts
import { proxyActivities, condition, setHandler } from '@temporalio/workflow';
import type * as activities from '../activities.js';

const activityDefaults = { startToCloseTimeout: '10 minutes' };

const { spawnAgent, createMilestone: activityCreateMilestone } = proxyActivities<{
  spawnAgent: (agentName: string, persona: string, task: string, context?: Record<string, string>) => Promise<string>;
  createMilestone: (name: string, payload: unknown) => Promise<{ verdict: string; reason?: string; decidedBy: string }>;
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
    {} as any, // Simplified for MVP - real impl would be Temporal signal
    (d: typeof decision) => {
      decision = d;
    }
  );

  // Create milestone in backend
  const result = await activityCreateMilestone(name, payload);

  // Wait for decision via polling (simplified for MVP)
  // Real impl uses condition() with signal predicate
  while (!decision) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Check if resolved
    if (decision) break;
  }

  return decision as { verdict: 'Approved' | 'Rejected'; reason?: string; decidedBy: string };
}

export function defineWorkflow<T extends { input: unknown }>(config: {
  name: string;
  input: unknown;
  run: (input: T['input']) => Promise<unknown>;
}) {
  return config;
}