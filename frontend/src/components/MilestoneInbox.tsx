// frontend/src/components/MilestoneInbox.tsx
import { useState, useEffect } from 'react';
import { Check, X, Clock } from 'lucide-react';
import type { Milestone } from '../lib/db';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function MilestoneInbox({ isOpen, onClose }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) loadPendingMilestones();
  }, [isOpen]);

  async function loadPendingMilestones() {
    setLoading(true);
    try {
      const pending = await fetch('http://localhost:3000/api/milestones/pending').then(r => r.json());
      setMilestones(pending as Milestone[]);
    } catch (e) {
      console.error('Failed to load milestones', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(milestoneId: string, decision: 'approved' | 'rejected' | 'deferred', reason?: string) {
    await fetch('http://localhost:3000/api/milestones/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneId, decision, reason }),
    });
    loadPendingMilestones();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-card border-l border-border shadow-xl z-50 flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="font-medium">Milestones</div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <div className="text-center text-muted-foreground">Loading...</div>}
        {milestones.length === 0 && !loading && (
          <div className="text-center text-muted-foreground py-8">No pending milestones</div>
        )}
        {milestones.map((milestone) => {
          const payload = JSON.parse(milestone.payload_json || '{}');
          return (
            <div key={milestone.id} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{milestone.type}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(milestone.created_at).toLocaleString()}
                </div>
              </div>

              <div className="bg-muted rounded-md p-3 text-xs font-mono overflow-auto max-h-32">
                <pre className="whitespace-pre-wrap">{JSON.stringify(payload, null, 2)}</pre>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleDecision(milestone.id, 'approved')}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white py-2 rounded-md text-sm font-medium transition-colors"
                >
                  <Check className="w-4 h-4" /> Approve
                </button>
                <button
                  onClick={() => {
                    const reason = window.prompt('Rejection reason:');
                    if (reason) handleDecision(milestone.id, 'rejected', reason);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white py-2 rounded-md text-sm font-medium transition-colors"
                >
                  <X className="w-4 h-4" /> Reject
                </button>
                <button
                  onClick={() => handleDecision(milestone.id, 'deferred')}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-600 hover:bg-zinc-700 text-white py-2 rounded-md text-sm font-medium transition-colors"
                >
                  <Clock className="w-4 h-4" /> Defer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
