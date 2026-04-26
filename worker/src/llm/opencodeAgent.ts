// Routes the developer activity through the per-run opencode serve via the
// SDK, capturing token usage on each turn for the cost-by-agent panel.
//
// This file used to spawn `opencode run` over the backend's PTY manager and
// poll for completion. The PTY path emitted tokens to opencode's local stats
// DB only — Atelier's agent_calls table never saw them, so the developer cost
// always rendered as zero. We now talk to the per-run opencode serve through
// the SDK (`sendDeveloperPrompt`) and forward token usage + cost to the
// `/api/agent/call` telemetry endpoint.

import { writeAgentsRules } from './opencodeConfig';
import { sendDeveloperPrompt } from './opencodeServeClient';
import { recordCall } from './telemetry';
import type { PrimaryProvider } from './callLLM';
import type { ScopedTicket } from '../activities';

export interface OpenCodeRunInput {
  worktreePath: string;
  ticket: ScopedTicket;
  feedback?: string[];
  testFeedback?: string[];
  agentId: string;
  runId: string;
  /** Resolved primary-provider API key. Currently unused on the SDK path
   *  because the per-run serve already has the key wired in via the
   *  bootstrapped opencode.json — kept for signature compatibility. */
  apiKey: string;
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

function extractSummary(outputTail: string): string {
  const lines = outputTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^SUMMARY:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return outputTail.slice(-500).trim();
}

export async function runOpenCodeAgent(input: OpenCodeRunInput): Promise<OpenCodeRunOutput> {
  const { worktreePath, primaryProvider, developerPersona, runId, agentId } = input;

  // Snapshot HEAD before opencode runs so the diff is correct whether or not
  // opencode commits as part of its workflow.
  const baseSha = await snapshotHead(worktreePath);

  // Write opencode.json + AGENTS.md fresh per run. backend/src/opencode/
  // bootstrap.ts:bootstrapWorktree exists but has no callers in the workflow
  // path — the per-run serve relies on whatever exists in the worktree at
  // startup, so we are the sole writer here.
  await writeAgentsRules(worktreePath, developerPersona);

  const taskPrompt = buildTaskPrompt(input);

  const startedAt = Date.now();
  const result = await sendDeveloperPrompt({
    runId,
    persona: 'developer',
    prompt: taskPrompt,
    model: primaryProvider.selectedModel ? `primary/${primaryProvider.selectedModel}` : undefined,
  });
  const completedAt = Date.now();

  await recordCall(process.env.ATELIER_BACKEND_URL || 'http://localhost:3001', {
    runId,
    agentId,
    providerId: primaryProvider.id,
    model: primaryProvider.selectedModel ?? '',
    kind: 'opencode',
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    costUsd: result.costUsd,
    durationMs: completedAt - startedAt,
    startedAt,
    completedAt,
    error: null,
  });

  const filesChanged = await diffFilesSince(worktreePath, baseSha);
  const outputTail = result.text;
  const summary = extractSummary(outputTail);

  return { summary, filesChanged, exitCode: 0, outputTail };
}
