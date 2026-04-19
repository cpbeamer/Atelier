import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities.js';

const { spawnAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
});

export async function mvpWorkflow(prompt: string): Promise<string> {
  console.log(`Starting MVP Workflow with prompt: ${prompt}`);
  // In the real app, this activity would call the Tauri backend to spawn the PTY
  // For MVP, we just trigger it and return.
  const result = await spawnAgent(prompt);
  return result;
}
