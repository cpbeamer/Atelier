// frontend/src/components/WorkflowGraph.tsx
import { useState, useEffect, useMemo } from 'react';
import { getPipeline } from '../lib/pipelines';

interface WorkflowNode {
  id: string;
  name: string;
  type: 'agent' | 'milestone' | 'condition';
  status: 'pending' | 'running' | 'completed' | 'failed';
  runs: number;
}

interface Props {
  runId?: string;
  workflowType?: string;
}

export function WorkflowGraph({ runId, workflowType }: Props) {
  const template = useMemo(() => getPipeline(workflowType), [workflowType]);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);

  useEffect(() => {
    setNodes(template.map(n => ({
      id: n.agentId,
      name: n.name,
      type: n.type,
      status: 'pending',
      runs: 0,
    })));
  }, [runId, template]);

  useEffect(() => {
    if (!runId || template.length === 0) return;

    const ws = new WebSocket('ws://localhost:3000');

    ws.onmessage = (event) => {
      let msg: { type?: string; payload?: { agentId?: string; status?: string } };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const id = msg.payload?.agentId;
      if (!id) return;

      if (msg.type === 'agent:started') {
        setNodes(prev => prev.map(n =>
          n.id === id ? { ...n, status: 'running', runs: n.runs + 1 } : n
        ));
      } else if (msg.type === 'agent:completed') {
        const failed = msg.payload?.status === 'error';
        setNodes(prev => prev.map(n =>
          n.id === id ? { ...n, status: failed ? 'failed' : 'completed' } : n
        ));
      }
    };

    return () => ws.close();
  }, [runId, template]);

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 pt-5 pb-4">
        <div className="text-[11px] text-[var(--color-text-faint)] mb-1">Pipeline</div>
        <div className="text-[15px] font-medium text-[var(--color-text)]">Workflow</div>
      </div>

      {template.length === 0 ? (
        <div className="px-5 text-[12px] text-[var(--color-text-muted)]">
          No pipeline defined for this workflow.
        </div>
      ) : (
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
                      {labelFor(node.type, node.status, node.runs)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelFor(type: WorkflowNode['type'], status: WorkflowNode['status'], runs: number): string {
  const t = type === 'agent' ? 'Agent' : type === 'milestone' ? 'Milestone' : 'Condition';
  const s = status === 'pending' ? 'pending' : status === 'running' ? 'running' : status === 'completed' ? 'done' : 'failed';
  const suffix = runs > 1 ? ` · ×${runs}` : '';
  return `${t} · ${s}${suffix}`;
}
