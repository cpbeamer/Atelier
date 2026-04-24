// frontend/src/components/WorkflowGraph.tsx
import { useState, useEffect } from 'react';

interface WorkflowNode {
  id: string;
  name: string;
  type: 'agent' | 'milestone' | 'condition';
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentName?: string;
}

interface Props {
  runId?: string;
}

const STATUS_COLOR: Record<WorkflowNode['status'], string> = {
  running: '#d4ff00',
  completed: '#63d4ff',
  failed: '#ff6b5a',
  pending: '#4a4d52',
};

export function WorkflowGraph({ runId }: Props) {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);

  useEffect(() => {
    setNodes([
      { id: '1', name: 'PM Specialist', type: 'agent', status: 'completed', agentName: 'PM Specialist' },
      { id: '2', name: 'PM Validator', type: 'agent', status: 'completed', agentName: 'PM Validator' },
      { id: '3', name: 'PM Proposal Review', type: 'milestone', status: 'running' },
      { id: '4', name: 'Architect', type: 'agent', status: 'pending', agentName: 'Architect' },
      { id: '5', name: 'Code Writer', type: 'agent', status: 'pending', agentName: 'Code Writer' },
    ]);
  }, [runId]);

  return (
    <div className="h-full overflow-auto">
      <div className="px-4 pt-4 pb-3 border-b border-[#1e2024]">
        <div className="font-display uppercase tracking-[0.35em] text-[9px] text-[#4a4d52] mb-1">
          pipeline
        </div>
        <div className="font-display uppercase tracking-[0.2em] text-[13px] text-[#e8e6e0]">
          workflow
        </div>
      </div>

      <div className="py-3">
        {nodes.map((node, idx) => {
          const color = STATUS_COLOR[node.status];
          const isLast = idx === nodes.length - 1;
          return (
            <div key={node.id} className="relative px-4">
              {!isLast && (
                <div
                  className="absolute left-[22px] top-7 w-[1px] h-full"
                  style={{ background: node.status === 'completed' ? '#63d4ff33' : '#1e2024' }}
                />
              )}
              <div className="relative flex items-start gap-3 py-2">
                <div
                  className="relative mt-[2px] w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    background: color,
                    boxShadow: node.status === 'running' ? `0 0 12px ${color}, 0 0 24px ${color}88` : 'none',
                  }}
                >
                  {node.status === 'running' && (
                    <span
                      className="absolute inset-0 rounded-full animate-ping"
                      style={{ background: color, opacity: 0.5 }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display uppercase tracking-[0.12em] text-[11px] text-[#e8e6e0] truncate">
                    {node.name}
                  </div>
                  <div className="font-display uppercase tracking-[0.3em] text-[9px] mt-0.5" style={{ color }}>
                    {node.type} · {node.status}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
