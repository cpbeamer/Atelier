// Spawns `opencode run` inside a git worktree as a real tool-using agent.
// Replaces the legacy one-shot `callLLM` + `BEGIN FILE / END FILE` parsing
// path for `implementCode` when ATELIER_USE_OPENCODE=1.
//
// Returns the set of files changed since opencode started — captured via git
// diff against a snapshot of HEAD taken before the run, so the result is
// correct whether opencode itself runs `git commit` (it might) or leaves
// changes unstaged in the working tree.

import { writeOpencodeConfig, writeAgentsRules, OPENCODE_API_KEY_ENV } from './opencodeConfig';
import type { PrimaryProvider } from './callLLM';
import type { ScopedTicket } from '../activities';

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export interface OpenCodeRunInput {
  worktreePath: string;
  ticket: ScopedTicket;
  feedback?: string[];
  testFeedback?: string[];
  agentId: string;
  runId: string;
  /** Resolved primary-provider API key. Passed to the subprocess via env so it
   *  doesn't leak into the long-lived backend process.env. */
  apiKey: string;
  timeoutMs?: number;
  primaryProvider: PrimaryProvider;
  developerPersona: string;
}

export interface OpenCodeRunOutput {
  /** One-line summary parsed from the last `SUMMARY:` line in opencode's
   *  output, or the trailing 500 chars if no SUMMARY marker present. */
  summary: string;
  /** Files changed since the run started — tracked diffs + untracked files. */
  filesChanged: string[];
  exitCode: number;
  outputTail: string;
}

export class NoOpencodeChangesError extends Error {
  name = 'NonRetryableAgentError';
}

interface PtyStatus {
  status: 'running' | 'completed' | 'error';
  output?: string;
  outputTail?: string;
  exitCode?: number;
  signal?: number;
  error?: string;
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { stdout, exitCode };
  } catch {
    return { stdout: '', exitCode: 1 };
  }
}

async function snapshotHead(worktreePath: string): Promise<string | null> {
  const { stdout, exitCode } = await runGit(worktreePath, ['rev-parse', 'HEAD']);
  if (exitCode !== 0) return null;
  const sha = stdout.trim();
  return sha.length > 0 ? sha : null;
}

async function diffFilesSince(worktreePath: string, baseSha: string | null): Promise<string[]> {
  const files = new Set<string>();
  if (baseSha) {
    const tracked = await runGit(worktreePath, ['diff', '--name-only', baseSha]);
    tracked.stdout.split('\n').filter(Boolean).forEach((f) => files.add(f.trim()));
  }
  const untracked = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
  untracked.stdout.split('\n').filter(Boolean).forEach((f) => files.add(f.trim()));
  return Array.from(files);
}

function buildTaskPrompt(input: OpenCodeRunInput): string {
  const { ticket, feedback, testFeedback } = input;
  const parts: string[] = [
    `Implement the following ticket in this repository. Use your tools to read existing code, write changes, and verify your work.`,
    ``,
    `Ticket: ${ticket.title}`,
    ticket.description,
    ``,
    `Technical plan:`,
    ticket.technicalPlan,
    ``,
    `Acceptance criteria:`,
    ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n'),
  ];
  if (ticket.filesToChange?.length) {
    parts.push('', `Suggested files to change: ${ticket.filesToChange.join(', ')}`);
  }
  if (feedback?.length) {
    parts.push('', `CODE REVIEW FEEDBACK to address:`, feedback.join('\n'));
  }
  if (testFeedback?.length) {
    parts.push('', `TEST FAILURES to fix:`, testFeedback.join('\n'));
  }
  parts.push(
    '',
    `When you finish, end your response with a single line: "SUMMARY: <one-line description of the change>".`,
  );
  return parts.join('\n');
}

async function spawnOpencodePty(input: OpenCodeRunInput, taskPrompt: string): Promise<void> {
  const model = input.primaryProvider.selectedModel ?? 'default';
  const response = await fetch(`${BACKEND}/api/pty/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: input.agentId,
      command: 'opencode',
      args: ['run', '--dangerously-skip-permissions', '--model', `primary/${model}`, taskPrompt],
      cwd: input.worktreePath,
      env: { [OPENCODE_API_KEY_ENV]: input.apiKey },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to spawn opencode PTY: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
}

async function pollUntilComplete(agentId: string, timeoutMs: number): Promise<PtyStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BACKEND}/api/agent/${encodeURIComponent(agentId)}/status`);
      if (response.ok) {
        const status = await response.json() as PtyStatus;
        if (status.status === 'completed' || status.status === 'error') {
          return status;
        }
      }
    } catch {
      // Backend may flap — keep polling.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`opencode PTY timeout after ${timeoutMs}ms (agentId=${agentId})`);
}

function extractSummary(outputTail: string): string {
  const lines = outputTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^SUMMARY:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return outputTail.slice(-500).trim();
}

export async function runOpenCodeAgent(input: OpenCodeRunInput): Promise<OpenCodeRunOutput> {
  const {
    worktreePath, primaryProvider, developerPersona, agentId,
    timeoutMs = 30 * 60 * 1000,
  } = input;

  // Snapshot HEAD before opencode runs so the diff is correct whether or not
  // opencode commits as part of its workflow.
  const baseSha = await snapshotHead(worktreePath);

  await writeOpencodeConfig(worktreePath, primaryProvider);
  await writeAgentsRules(worktreePath, developerPersona);

  const taskPrompt = buildTaskPrompt(input);
  await spawnOpencodePty(input, taskPrompt);
  const status = await pollUntilComplete(agentId, timeoutMs);

  const filesChanged = await diffFilesSince(worktreePath, baseSha);
  const outputTail = status.outputTail ?? status.output ?? '';
  const summary = extractSummary(outputTail);
  const exitCode = status.exitCode ?? (status.status === 'completed' ? 0 : 1);

  if (exitCode !== 0) {
    // Crash mid-run — let Temporal retry. The transient-error retry policy in
    // the workflow already caps at 3 attempts.
    throw new Error(
      `opencode exited ${exitCode}${status.signal ? ` (signal ${status.signal})` : ''}: ${outputTail.slice(-500)}`,
    );
  }

  return { summary, filesChanged, exitCode, outputTail };
}
