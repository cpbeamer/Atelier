import { useState, useEffect, useCallback } from 'react';
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
      const ws = new WebSocket('ws://localhost:3000');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'milestone:pending') loadMilestones();
        } catch { /* ignore */ }
      };
      ws.onerror = () => console.error('WebSocket error');
      return () => ws.close();
    }
  }, [isOpen]);

  const loadMilestones = useCallback(async () => {
    setLoading(true);
    try {
      const pending = await invoke<Milestone[]>('milestone.listPending');
      setMilestones(pending);
    } catch (e) {
      console.error('Failed to load milestones:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleResolve = useCallback(async (id: string, verdict: 'Approved' | 'Rejected', reason?: string) => {
    try {
      await invoke('milestone.resolve', { id, verdict, reason });
      setMilestones(prev => prev.filter(m => m.id !== id));
    } catch (e) {
      console.error('Failed to resolve milestone:', e);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--color-surface)] border border-[var(--color-hair)] rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-hair)]">
          <h2 className="text-[16px] font-medium">Milestones</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <p className="text-[13px] text-[var(--color-text-muted)]">Loading…</p>}
          {!loading && milestones.length === 0 && (
            <p className="text-[13px] text-[var(--color-text-muted)]">No pending milestones.</p>
          )}
          <div className="space-y-3">
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
  } catch { /* ignore */ }

  return (
    <div className="rounded-lg border border-[var(--color-hair)] bg-[var(--color-surface-2)]/60 p-4">
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <span className="text-[13.5px] font-medium text-[var(--color-text)]">{milestone.type}</span>
        <span className="text-[11px] text-[var(--color-text-faint)] font-mono shrink-0">
          {new Date(milestone.created_at).toLocaleString()}
        </span>
      </div>

      {(payload.synthesis || payload.design || payload.code) && (
        <pre className="mb-3 px-3 py-2 rounded bg-[var(--color-ink)] border border-[var(--color-hair)] text-[11.5px] font-mono text-[var(--color-text-dim)] whitespace-pre-wrap max-h-44 overflow-y-auto">
          {payload.synthesis || payload.design || payload.code}
        </pre>
      )}

      <input
        type="text"
        placeholder="Optional reason…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full mb-3 bg-[var(--color-ink)] border border-[var(--color-hair)] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--color-accent)]/40 transition-colors"
      />

      <div className="flex gap-2">
        <button
          onClick={() => onApprove(reason || undefined)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-[var(--color-ink)] text-[12.5px] font-medium hover:opacity-90 transition-opacity"
        >
          <Check className="w-3.5 h-3.5" />
          Approve
        </button>
        <button
          onClick={() => onReject(reason || undefined)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-hair-2)] text-[var(--color-text-dim)] text-[12.5px] hover:border-[var(--color-error)]/40 hover:text-[var(--color-error)] transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}
