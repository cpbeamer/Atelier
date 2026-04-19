// frontend/src/lib/db.ts
export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: number;
  last_opened_at: number;
  settings_json: string;
}

export interface WorkflowRun {
  id: string;
  project_id: string;
  workflow_name: string;
  temporal_workflow_id: string;
  status: 'running' | 'completed' | 'failed' | 'terminated' | 'awaiting-milestone';
  worktree_path: string;
  started_at: number;
  completed_at: number;
  input_json: string;
}

export interface Milestone {
  id: string;
  run_id: string;
  type: string;
  status: 'pending' | 'approved' | 'rejected' | 'timed-out';
  payload_json: string;
  created_at: number;
  decided_at: number;
  decided_by: string;
  decision_reason: string;
}