// Static verification gate. Runs after the test loop and before the push so
// an LLM-approved implementation still has to pass typecheck + lint before
// the worktree gets committed. Detection is best-effort; if the project has
// no typecheck/lint surface, this returns allPassed=true with no results.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface VerifyCommand {
  cmd: string;
  args: string[];
  label: 'typecheck' | 'lint';
}

export interface VerifyResult {
  allPassed: boolean;
  results: Array<{ label: string; passed: boolean; output: string }>;
}

export function detectVerifyCommands(worktreePath: string): VerifyCommand[] {
  const cmds: VerifyCommand[] = [];

  const pkgPath = join(worktreePath, 'package.json');
  if (existsSync(pkgPath)) {
    let pkg: any = null;
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { /* malformed */ }

    if (pkg && typeof pkg === 'object') {
      const scripts = pkg.scripts ?? {};
      if (typeof scripts.typecheck === 'string' && scripts.typecheck.length > 0) {
        cmds.push({ cmd: 'bun', args: ['run', 'typecheck'], label: 'typecheck' });
      } else if (
        (pkg.devDependencies?.typescript || pkg.dependencies?.typescript)
        && existsSync(join(worktreePath, 'tsconfig.json'))
      ) {
        cmds.push({ cmd: 'bunx', args: ['tsc', '--noEmit'], label: 'typecheck' });
      }
      if (typeof scripts.lint === 'string' && scripts.lint.length > 0) {
        cmds.push({ cmd: 'bun', args: ['run', 'lint'], label: 'lint' });
      }
    }
  }

  const pyproj = join(worktreePath, 'pyproject.toml');
  if (existsSync(pyproj)) {
    try {
      const text = readFileSync(pyproj, 'utf8');
      if (text.includes('[tool.ruff') || text.includes('ruff =')) {
        cmds.push({ cmd: 'ruff', args: ['check', '.'], label: 'lint' });
      }
      if (text.includes('[tool.mypy') || text.includes('mypy =')) {
        cmds.push({ cmd: 'mypy', args: ['.'], label: 'typecheck' });
      }
    } catch { /* unreadable */ }
  }

  return cmds;
}

export async function runVerify(worktreePath: string, timeoutMs = 5 * 60 * 1000): Promise<VerifyResult> {
  const cmds = detectVerifyCommands(worktreePath);
  if (cmds.length === 0) return { allPassed: true, results: [] };

  const { spawn } = await import('node:child_process');
  const results: VerifyResult['results'] = [];

  for (const c of cmds) {
    const { exitCode, output } = await new Promise<{ exitCode: number; output: string }>((resolve) => {
      const proc = spawn(c.cmd, c.args, { cwd: worktreePath });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { proc.kill('SIGKILL'); }, timeoutMs);
      proc.stdout?.on('data', (d) => { stdout += d.toString(); });
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        clearTimeout(timer);
        // Command not found counts as a failure — we detected intent but can't run it
        resolve({ exitCode: 127, output: `${c.cmd}: ${err.message}` });
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          output: `${stdout}\n${stderr}`.trim().slice(0, 4000),
        });
      });
    });
    results.push({ label: c.label, passed: exitCode === 0, output });
  }

  return { allPassed: results.every((r) => r.passed), results };
}
