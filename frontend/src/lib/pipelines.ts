export type NodeType = 'agent' | 'milestone' | 'condition';

export interface PipelineNode {
  agentId: string;
  name: string;
  type: NodeType;
}

// Templates mirror the agentIds emitted by worker workflows in
// worker/src/workflows/*.workflow.ts via notifyAgentStart/notifyAgentComplete.
// Keep these in sync when those workflows change.
export const PIPELINES: Record<string, PipelineNode[]> = {
  autopilot: [
    { agentId: 'researcher', name: 'Research Agent', type: 'agent' },
    { agentId: 'ticket-bot', name: 'Ticket Bot', type: 'agent' },
    { agentId: 'architect', name: 'Architect', type: 'agent' },
    { agentId: 'developer', name: 'Developer', type: 'agent' },
    { agentId: 'reviewer', name: 'Code Reviewer', type: 'agent' },
    { agentId: 'tester', name: 'Tester', type: 'agent' },
    { agentId: 'pusher', name: 'Pusher', type: 'agent' },
  ],
  greenfield: [
    { agentId: 'validator', name: 'Request Validator', type: 'agent' },
    { agentId: 'architect', name: 'Architect', type: 'agent' },
    { agentId: 'developer', name: 'Developer', type: 'agent' },
    { agentId: 'reviewer', name: 'Code Reviewer', type: 'agent' },
    { agentId: 'tester', name: 'Tester', type: 'agent' },
    { agentId: 'pusher', name: 'Pusher', type: 'agent' },
  ],
};

export function getPipeline(workflowType: string | undefined): PipelineNode[] {
  if (!workflowType) return [];
  return PIPELINES[workflowType] ?? [];
}
