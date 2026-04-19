// backend/src/milestone-service.ts
import { milestones } from './db.js';

const pendingMilestones = new Map<string, {
  resolve: (decision: MilestoneDecision) => void;
  reject: (err: Error) => void;
}>();

export interface MilestoneDecision {
  verdict: 'Approved' | 'Rejected';
  reason?: string;
  decidedBy: string;
}

export async function createMilestone(
  runId: string,
  name: string,
  payload: unknown
): Promise<string> {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const now = Date.now();

  // Insert into database
  milestones.insert(id, runId, name, 'pending', payloadJson, now);

  // Return a promise that resolves when frontend resolves the milestone
  return new Promise<string>((resolve, reject) => {
    pendingMilestones.set(id, {
      resolve: (decision) => resolve(id),
      reject,
    });

    // Auto-timeout after 7 days
    setTimeout(() => {
      if (pendingMilestones.has(id)) {
        pendingMilestones.delete(id);
        milestones.updateDecision(id, 'timed-out', Date.now(), 'auto-timeout', '7-day timeout');
      }
    }, 7 * 24 * 60 * 60 * 1000);
  });
}

export async function resolveMilestone(
  id: string,
  verdict: 'Approved' | 'Rejected',
  reason?: string,
  decidedBy: string = 'user'
): Promise<void> {
  const pending = pendingMilestones.get(id);
  if (pending) {
    pending.resolve({ verdict, reason, decidedBy });
    pendingMilestones.delete(id);
  }
  milestones.updateDecision(id, verdict.toLowerCase(), Date.now(), decidedBy, reason || null);
  console.log(`Milestone ${id} resolved: ${verdict}`);
}

export function getPendingMilestones() {
  return milestones.listPending();
}