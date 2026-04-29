import type { ScopedTicket } from '../activities';

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export interface CliAgentRunInput {
  runtime: 'claude-code';
  worktreePath: string;
  ticket: ScopedTicket;
  feedback?: string[];
  testFeedback?: string[];
  agentId: string;
  developerPersona: string;
}

export interface CliAgentRunOutput {
  summary: string;
  filesChanged: string[];
  exitCode: number;
  outputTail: string;
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

function buildTaskPrompt(input: CliAgentRunInput): string {
  const { ticket, feedback, testFeedback, developerPersona } = input;
  const parts: string[] = [
    developerPersona,
    '',
    '---',
    '',
    'Implement the following ticket in this repository. Use your tools to read existing code, write changes, and verify your work.',
    '',
    `Ticket: ${ticket.title}`,
    ticket.description,
    '',
    'Technical plan:',
    ticket.technicalPlan,
    '',
    'Acceptance criteria:',
    ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n'),
  ];
  if (ticket.filesToChange?.length) {
    parts.push('', `Suggested files to change: ${ticket.filesToChange.join(', ')}`);
  }
  if (feedback?.length) {
    parts.push('', 'CODE REVIEW FEEDBACK to address:', feedback.join('\n'));
  }
  if (testFeedback?.length) {
    parts.push('', 'TEST FAILURES to fix:', testFeedback.join('\n'));
  }
  parts.push('', 'When you finish, end your response with a single line: "SUMMARY: <one-line description of the change>".');
  return parts.join('\n');
}

function extractSummary(outputTail: string): string {
  const lines = outputTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^SUMMARY:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return outputTail.slice(-500).trim();
}

async function spawnClaudeCode(input: CliAgentRunInput, prompt: string): Promise<string> {
  await fetch(`${BACKEND}/api/agent/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: input.agentId,
      agentName: 'Developer',
      terminalType: 'terminal',
    }),
  });

  const response = await fetch(`${BACKEND}/api/pty/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: input.agentId,
      command: 'claude',
      args: ['--dangerously-skip-permissions', '-p', prompt],
      cwd: input.worktreePath,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to spawn Claude Code: HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Claude Code PTY timeout')), 30 * 60 * 1000);
    const poll = async () => {
      try {
        const status = await fetch(`${BACKEND}/api/agent/${encodeURIComponent(input.agentId)}/status`);
        if (status.ok) {
          const result = await status.json() as { status: string; output?: string; outputTail?: string; error?: string };
          if (result.status === 'completed') {
            clearTimeout(timeout);
            resolve(result.output ?? result.outputTail ?? '');
            return;
          }
          if (result.status === 'error') {
            clearTimeout(timeout);
            reject(new Error(result.error ?? result.output ?? result.outputTail ?? 'Claude Code exited with an error'));
            return;
          }
        }
      } catch {
        // Continue polling; transient backend failures should not orphan the agent immediately.
      }
      setTimeout(poll, 2000);
    };
    poll();
  });
}

export async function runCliAgent(input: CliAgentRunInput): Promise<CliAgentRunOutput> {
  if (input.runtime !== 'claude-code') {
    throw new Error(`Unsupported CLI runtime: ${input.runtime}`);
  }
  const baseSha = await snapshotHead(input.worktreePath);
  const outputTail = await spawnClaudeCode(input, buildTaskPrompt(input));
  const filesChanged = await diffFilesSince(input.worktreePath, baseSha);
  return {
    summary: extractSummary(outputTail),
    filesChanged,
    exitCode: 0,
    outputTail,
  };
}
