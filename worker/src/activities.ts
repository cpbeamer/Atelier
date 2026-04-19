// worker/src/activities.ts
export async function spawnAgent(prompt: string): Promise<string> {
  console.log(`Activity: spawnAgent called with prompt: ${prompt}`);
  return `Agent spawned for prompt: ${prompt}`;
}

export async function callAgent(agentName: string, input: unknown): Promise<{ output: string; agentName: string }> {
  return { output: `Agent ${agentName} response`, agentName };
}

export async function createMilestone(name: string, payload: unknown): Promise<string> {
  const id = crypto.randomUUID();
  return id;
}

export async function resolveMilestone(milestoneId: string, decision: { verdict: string; reason?: string; decidedBy: string }): Promise<void> {
  console.log('resolveMilestone', milestoneId, decision);
}
