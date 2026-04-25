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

export function WorkflowGraph({ runId }: Props) {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);

  useEffect(() => {
    setNodes([
      { id: '1', name: 'PM Specialist', type: 'agent', status: 'completed', agentName: 'PM Specialist' },
      { id: '2', name: 'PM Validator', type: 'agent', status: 'completed', agentName: 'PM Validator' },
      { id: '3', name: 'Proposal review', type: 'milestone', status: 'running' },
      { id: '4', name: 'Architect', type: 'agent', status: 'pending', agentName: 'Architect' },
      { id: '5', name: 'Code writer', type: 'agent', status: 'pending', agentName: 'Code writer' },
    ]);
  }, [runId]);

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 pt-5 pb-4">
        <div className="text-[11px] text-[var(--color-text-faint)] mb-1">Pipeline</div>
        <div className="text-[15px] font-medium text-[var(--color-text)]">Workflow</div>
      </div>

      <div className="pb-6 px-1">
        {nodes.map((node, idx) => {
          const isLast = idx === nodes.length - 1;
          const dotColor =
            node.status === 'running' ? 'var(--color-accent)'
            : node.status === 'completed' ? 'var(--color-success)'
            : node.status === 'failed' ? 'var(--color-error)'
            : 'var(--color-text-faint)';

          const lineColor =
            node.status === 'completed' ? 'var(--color-success)'
            : node.status === 'running' ? 'var(--color-accent)'
            : 'var(--color-hair)';

          return (
            <div key={node.id} className="relative px-5">
              {!isLast && (
                <div
                  className="absolute left-[27px] top-7 bottom-[-12px] w-px"
                  style={{ background: lineColor, opacity: node.status === 'pending' ? 1 : 0.4 }}
                />
              )}
              <div className="relative flex items-start gap-3 py-2.5">
                <span
                  className={`relative mt-[3px] w-2 h-2 rounded-full shrink-0 ${node.status === 'running' ? 'live-dot' : ''}`}
                  style={{ background: dotColor }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--color-text)] truncate leading-tight">
                    {node.name}
                  </div>
                  <div className="text-[11px] mt-0.5 text-[var(--color-text-muted)]">
                    {labelFor(node.type, node.status)}
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

function labelFor(type: WorkflowNode['type'], status: WorkflowNode['status']): string {
  const t = type === 'agent' ? 'Agent' : type === 'milestone' ? 'Milestone' : 'Condition';
  const s = status === 'pending' ? 'pending' : status === 'running' ? 'running' : status === 'completed' ? 'done' : 'failed';
  return `${t} · ${s}`;
}
