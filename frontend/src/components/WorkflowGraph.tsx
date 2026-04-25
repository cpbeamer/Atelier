// frontend/src/components/WorkflowGraph.tsx
import { useState, useEffect, useMemo } from 'react';
import { getPipeline } from '../lib/pipelines';

type Status = 'pending' | 'running' | 'completed' | 'failed';

interface NodeState {
  agentId: string;
  name: string;
  status: Status;
  runs: number;
}

interface Props {
  runId?: string;
  workflowType?: string;
}

export function WorkflowGraph({ runId, workflowType }: Props) {
  const template = useMemo(() => getPipeline(workflowType), [workflowType]);
  const [nodes, setNodes] = useState<NodeState[]>([]);

  useEffect(() => {
    setNodes(template.map(n => ({
      agentId: n.agentId,
      name: n.name,
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
          n.agentId === id ? { ...n, status: 'running', runs: n.runs + 1 } : n
        ));
      } else if (msg.type === 'agent:completed') {
        const failed = msg.payload?.status === 'error';
        setNodes(prev => prev.map(n =>
          n.agentId === id ? { ...n, status: failed ? 'failed' : 'completed' } : n
        ));
      }
    };

    return () => ws.close();
  }, [runId, template]);

  if (template.length === 0) {
    return (
      <div className="h-full bg-card border border-border rounded-lg p-4 overflow-auto">
        <div className="font-medium text-sm mb-4">Workflow Progress</div>
        <div className="text-xs text-muted-foreground">No pipeline defined for this workflow.</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-card border border-border rounded-lg p-4 overflow-auto">
      <div className="font-medium text-sm mb-4">Workflow Progress</div>
      <div className="space-y-3">
        {nodes.map((node) => (
          <div key={node.agentId} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm ${
            node.status === 'running' ? 'border-blue-500 bg-blue-500/10' :
            node.status === 'completed' ? 'border-green-600 bg-green-500/10' :
            node.status === 'failed' ? 'border-red-600 bg-red-500/10' :
            'border-border bg-muted'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                node.status === 'running' ? 'bg-blue-500 animate-pulse' :
                node.status === 'completed' ? 'bg-green-600' :
                node.status === 'failed' ? 'bg-red-600' :
                'bg-zinc-500'
              }`} />
              <div className="font-medium text-xs truncate">{node.name}</div>
            </div>
            {node.runs > 1 && (
              <div className="text-xs text-muted-foreground tabular-nums shrink-0">×{node.runs}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
