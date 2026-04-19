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
    // In production: poll Temporal event history to build this graph
    // For now: static preview
    setNodes([
      { id: '1', name: 'PM Specialist', type: 'agent', status: 'completed', agentName: 'PM Specialist' },
      { id: '2', name: 'PM Validator', type: 'agent', status: 'completed', agentName: 'PM Validator' },
      { id: '3', name: 'PM Proposal Review', type: 'milestone', status: 'running' },
      { id: '4', name: 'Architect', type: 'agent', status: 'pending', agentName: 'Architect' },
      { id: '5', name: 'Code Writer', type: 'agent', status: 'pending', agentName: 'Code Writer' },
    ]);
  }, [runId]);

  return (
    <div className="h-full bg-card border border-border rounded-lg p-4 overflow-auto">
      <div className="font-medium text-sm mb-4">Workflow Progress</div>
      <div className="space-y-3">
        {nodes.map((node) => (
          <div key={node.id} className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm ${
            node.status === 'running' ? 'border-blue-500 bg-blue-500/10' :
            node.status === 'completed' ? 'border-green-600 bg-green-500/10' :
            node.status === 'failed' ? 'border-red-600 bg-red-500/10' :
            'border-border bg-muted'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              node.status === 'running' ? 'bg-blue-500 animate-pulse' :
              node.status === 'completed' ? 'bg-green-600' :
              node.status === 'failed' ? 'bg-red-600' :
              'bg-zinc-500'
            }`} />
            <div>
              <div className="font-medium text-xs">{node.name}</div>
              {node.type === 'milestone' && (
                <div className="text-xs text-muted-foreground">Awaiting approval</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
