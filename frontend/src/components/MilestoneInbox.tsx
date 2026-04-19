import { useState, useEffect } from 'react';
import { X, Check, XCircle } from 'lucide-react';
import { invoke } from '../lib/ipc';

interface Milestone {
  id: string;
  run_id: string;
  type: string;
  status: string;
  payload_json: string;
  created_at: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function MilestoneInbox({ isOpen, onClose }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadMilestones();
      // Subscribe to WebSocket for new milestones
      const ws = new WebSocket('ws://localhost:3000');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'milestone:pending') {
            loadMilestones();
          }
        } catch {
          // Ignore parse errors
        }
      };
      return () => ws.close();
    }
  }, [isOpen]);

  async function loadMilestones() {
    setLoading(true);
    try {
      const pending = await invoke<Milestone[]>('milestone.listPending');
      setMilestones(pending);
    } catch (e) {
      console.error('Failed to load milestones:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(id: string, verdict: 'Approved' | 'Rejected', reason?: string) {
    try {
      await invoke('milestone.resolve', { id, verdict, reason });
      setMilestones(prev => prev.filter(m => m.id !== id));
    } catch (e) {
      console.error('Failed to resolve milestone:', e);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Milestones</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && <p className="text-muted-foreground">Loading...</p>}
          {!loading && milestones.length === 0 && (
            <p className="text-muted-foreground">No pending milestones</p>
          )}
          {milestones.map(milestone => (
            <MilestoneItem
              key={milestone.id}
              milestone={milestone}
              onApprove={(reason) => handleResolve(milestone.id, 'Approved', reason)}
              onReject={(reason) => handleResolve(milestone.id, 'Rejected', reason)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MilestoneItem({
  milestone,
  onApprove,
  onReject,
}: {
  milestone: Milestone;
  onApprove: (reason?: string) => void;
  onReject: (reason?: string) => void;
}) {
  const [reason, setReason] = useState('');

  let payload: any = {};
  try {
    payload = JSON.parse(milestone.payload_json || '{}');
  } catch {
    // Ignore parse errors
  }

  return (
    <div className="border border-border rounded-lg p-4 mb-4">
      <div className="font-medium mb-2">{milestone.type}</div>
      <div className="text-sm text-muted-foreground mb-4">
        Created: {new Date(milestone.created_at).toLocaleString()}
      </div>

      {payload.synthesis && (
        <div className="bg-muted rounded p-3 mb-4 text-sm max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{payload.synthesis}</pre>
        </div>
      )}
      {payload.design && (
        <div className="bg-muted rounded p-3 mb-4 text-sm max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{payload.design}</pre>
        </div>
      )}
      {payload.code && (
        <div className="bg-muted rounded p-3 mb-4 text-sm max-h-40 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{payload.code}</pre>
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          placeholder="Optional reason..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onApprove(reason || undefined)}
          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700"
        >
          <Check className="w-4 h-4" />
          Approve
        </button>
        <button
          onClick={() => onReject(reason || undefined)}
          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        >
          <XCircle className="w-4 h-4" />
          Reject
        </button>
      </div>
    </div>
  );
}
