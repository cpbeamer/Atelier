// backend/src/milestone-service.ts
import { milestones } from './db.js';

const pendingMilestones = new Map<string, {
  resolve: (decision: MilestoneDecision) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
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
): Promise<MilestoneDecision> {
  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(payload);
  const now = Date.now();

  // Insert into database
  try {
    milestones.insert(id, runId, name, 'pending', payloadJson, now);
  } catch (err) {
    throw new Error(`Failed to insert milestone: ${err}`);
  }

  // Return a promise that resolves when frontend resolves the milestone
  return new Promise<MilestoneDecision>((resolve, reject) => {
    // Auto-timeout after 7 days
    const timeoutId = setTimeout(() => {
      if (pendingMilestones.has(id)) {
        pendingMilestones.delete(id);
        try {
          milestones.updateDecision(id, 'timed-out', Date.now(), 'auto-timeout', '7-day timeout');
        } catch (err) {
          console.error(`Failed to update timed-out milestone: ${err}`);
        }
      }
    }, 7 * 24 * 60 * 60 * 1000);

    pendingMilestones.set(id, {
      resolve: (decision) => {
        clearTimeout(timeoutId);
        resolve(decision);
      },
      reject,
      timeoutId,
    });
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
    clearTimeout(pending.timeoutId);
    pending.resolve({ verdict, reason, decidedBy });
    pendingMilestones.delete(id);
  }
  try {
    milestones.updateDecision(id, verdict.toLowerCase(), Date.now(), decidedBy, reason || null);
  } catch (err) {
    console.error(`Failed to update milestone decision: ${err}`);
  }
  console.log(`Milestone ${id} resolved: ${verdict}`);
}

export function getPendingMilestones() {
  return milestones.listPending();
}