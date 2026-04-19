// backend/src/utils/exec-file.ts
import { spawn } from 'node:child_process';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export function execFileNoThrow(
  file: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> }
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: opts?.cwd, env: opts?.env, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr, status: code });
    });
    child.on('error', (err) => {
      resolve({ ok: false, stdout: '', stderr: err.message, status: null });
    });
  });
}
