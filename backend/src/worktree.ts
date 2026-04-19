// backend/src/worktree.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { execFileNoThrow } from './utils/exec-file.js';

const WORKTREE_BASE = path.join(process.env.HOME || '', '.atelier', 'worktrees');

export interface WorktreeInstance {
  path: string;
  branch: string;
}

export async function createWorktree(
  projectPath: string,
  projectSlug: string,
  runId: string
): Promise<WorktreeInstance> {
  const branch = `atelier/${runId}`;
  const worktreePath = path.join(WORKTREE_BASE, projectSlug, runId);

  fs.mkdirSync(worktreePath, { recursive: true });

  const result = await execFileNoThrow('git', ['worktree', 'add', '--no-track', worktreePath, branch], { cwd: projectPath });
  if (!result.ok) throw new Error(`git worktree add failed: ${result.stderr}`);

  return { path: worktreePath, branch };
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  await execFileNoThrow('git', ['worktree', 'remove', worktreePath], { cwd: worktreePath });
}

export async function pruneWorktrees(projectPath: string): Promise<void> {
  await execFileNoThrow('git', ['worktree', 'prune'], { cwd: projectPath });
}
