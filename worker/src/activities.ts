export interface MilestoneDecision {
  verdict: 'Approved' | 'Rejected';
  reason?: string;
  decidedBy: string;
}

export interface ResearchInput {
  projectPath: string;
  userContext?: Record<string, string>;
  agentId?: string;
  runId?: string;
}

export interface ResearchOutput {
  repoStructure: string;
  currentFeatures: string[];
  gaps: string[];
  opportunities: string[];
  marketContext: string;
}

export interface DebateInput {
  repoAnalysis: ResearchOutput;
  suggestedFeatures: string[];
  agentIds?: { signal?: string; noise?: string; reconcile?: string };
  runId?: string;
}

export interface DebateOutput {
  approvedFeatures: Array<{ name: string; rationale: string; priority: 'high' | 'medium' | 'low' }>;
  rejectedFeatures: Array<{ name: string; reason: string }>;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimate: 'S' | 'M' | 'L' | 'XL';
}

export interface TicketsInput {
  approvedFeatures: DebateOutput['approvedFeatures'];
  agentId?: string;
  runId?: string;
}

export interface TicketsOutput {
  tickets: Ticket[];
}

export interface ScopedTicket extends Ticket {
  technicalPlan: string;
  filesToChange: string[];
  dependencies: string[];
  /** Architect-estimated implementation complexity. Drives best-of-N gating. */
  complexity?: 'low' | 'medium' | 'high';
}

export interface ScopeInput {
  tickets: Ticket[];
  projectPath: string;
  worktreePath: string;
  agentId?: string;
  runId?: string;
}

export interface ScopeOutput {
  scopedTickets: ScopedTicket[];
}

export interface Implementation {
  ticketId: string;
  code: string;
  filesChanged: string[];
}

export interface ImplementInput {
  ticket: ScopedTicket;
  worktreePath: string;
  projectPath: string;
  feedback?: string[];
  testFeedback?: string[];
  agentId?: string;
  runId?: string;
}

export interface ImplementOutput {
  code: string;
  filesChanged: string[];
}

export interface ReviewResult {
  approved: boolean;
  comments: string[];
}

export interface ReviewInput {
  implementation: Implementation;
  ticket: ScopedTicket;
  agentId?: string;
  runId?: string;
}

export interface TestResult {
  allPassed: boolean;
  failures: string[];
}

export interface TestInput {
  implementation: Implementation;
  ticket: ScopedTicket;
  runId?: string;
}

export interface PushResult {
  branch: string;
  commitSha: string;
  prUrl?: string;
}

export interface PushInput {
  worktreePath: string;
  projectPath: string;
  tickets: ScopedTicket[];
}

export interface SetupWorkspaceInput {
  projectPath: string;
  projectSlug: string;
  runId: string;
}

export interface SetupWorkspaceOutput {
  worktreePath: string;
  branch: string;
  isWorktree: boolean;
}

export interface AgentNotification {
  agentId: string;
  agentName: string;
  terminalType: 'terminal' | 'direct-llm';
}

export interface AgentCompletion {
  agentId: string;
  status: 'completed' | 'error';
  output?: string;
}

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { callLLM, getPrimaryModelName } from './llm/callLLM.js';
import { withJsonRetry } from './llm/withJsonRetry.js';

async function readFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
}

interface ExecResult { code: number; stdout: string; stderr: string; }

function execCmd(command: string, args: string[], cwd?: string, timeoutMs = 60 * 60 * 1000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? 0, stdout, stderr }); });
  });
}

// M2.7 wraps reasoning in <think>...</think> tags; strip these before parsing
// structured output so hidden content never smuggles through file-edit markers
// or fake JSON blocks.
function stripThinking(output: string): string {
  return output.replace(/<think>[\s\S]*?<\/think>/g, '');
}

interface FileEdit { kind: 'write' | 'delete'; path: string; contents?: string; }

function parseFileEdits(raw: string): FileEdit[] {
  const output = stripThinking(raw);
  const edits: FileEdit[] = [];
  const writeRe = /^===\s*BEGIN FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n===\s*END FILE\s*===/gm;
  let m: RegExpExecArray | null;
  while ((m = writeRe.exec(output)) !== null) {
    edits.push({ kind: 'write', path: m[1].trim(), contents: m[2] });
  }
  const deleteRe = /^===\s*DELETE FILE:\s*(.+?)\s*===/gm;
  while ((m = deleteRe.exec(output)) !== null) {
    edits.push({ kind: 'delete', path: m[1].trim() });
  }
  return edits;
}

async function applyFileEdits(worktreePath: string, edits: FileEdit[]): Promise<string[]> {
  const rootAbs = path.resolve(worktreePath);
  const applied: string[] = [];
  for (const edit of edits) {
    const target = path.resolve(rootAbs, edit.path);
    if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
      throw new Error(`Refused to touch path outside worktree: ${edit.path}`);
    }
    if (edit.kind === 'write') {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, edit.contents ?? '', 'utf-8');
      applied.push(edit.path);
    } else {
      await fs.promises.rm(target, { force: true });
      applied.push(edit.path);
    }
  }
  return applied;
}

async function readFilesForContext(worktreePath: string, paths: string[], maxBytesPer = 20_000): Promise<string> {
  const rootAbs = path.resolve(worktreePath);
  const chunks: string[] = [];
  for (const rel of paths) {
    const abs = path.resolve(rootAbs, rel);
    if (!abs.startsWith(rootAbs + path.sep)) continue;
    try {
      const buf = await fs.promises.readFile(abs, 'utf-8');
      const trimmed = buf.length > maxBytesPer ? buf.slice(0, maxBytesPer) + `\n... [truncated ${buf.length - maxBytesPer} bytes]` : buf;
      chunks.push(`--- ${rel} ---\n${trimmed}`);
    } catch {
      chunks.push(`--- ${rel} ---\n(file does not exist yet)`);
    }
  }
  return chunks.join('\n\n');
}

async function listDir(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map(e => e.name);
  } catch {
    return [];
  }
}

async function loadPersona(projectPath: string, personaKey: string): Promise<string> {
  const personaPath = path.join(projectPath, '.atelier', 'agents', `${personaKey}.md`);
  try {
    return await fs.promises.readFile(personaPath, 'utf-8');
  } catch {
    // Fall back to bundled persona
    const bundledPath = path.join(process.cwd(), 'src', '.atelier', 'agents', `${personaKey}.md`);
    return fs.promises.readFile(bundledPath, 'utf-8');
  }
}

async function runTerminalAgentViaPty(
  agentId: string,
  agentName: string,
  personaKey: string,
  task: string,
  cwd?: string
): Promise<string> {
  // Notify frontend to spawn the PTY
  await fetch('http://localhost:3001/api/agent/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, agentName, terminalType: 'terminal' }),
  });

  // Call backend to spawn PTY
  const response = await fetch('http://localhost:3001/api/pty/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: agentId, persona: personaKey, task, cwd }),
  });

  if (!response.ok) {
    throw new Error(`Failed to spawn PTY: ${response.statusText}`);
  }

  // Wait for completion signal
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('PTY timeout')), 30 * 60 * 1000);

    const poll = async () => {
      try {
        const status = await fetch(`http://localhost:3001/api/agent/${agentId}/status`);
        if (status.ok) {
          const result = await status.json();
          if (result.status === 'completed') {
            clearTimeout(timeout);
            resolve(result.output || '');
            return;
          }
          if (result.status === 'error') {
            clearTimeout(timeout);
            reject(new Error(result.error));
            return;
          }
        }
      } catch {
        // Continue polling
      }
      setTimeout(poll, 2000);
    };
    poll();
  });
}

export async function spawnAgent(
  agentName: string,
  persona: string,
  task: string,
  context?: Record<string, string>
): Promise<string> {
  // Build context string for agents that receive prior agent outputs
  let contextStr = '';
  if (context) {
    contextStr = '\n\n## Context from Prior Agents\n';
    for (const [name, output] of Object.entries(context)) {
      contextStr += `\n### ${name}\n${output}\n`;
    }
  }

  // Load persona content from .atelier/agents/{persona}.md
  const personaPath = `.atelier/agents/${persona}.md`;
  const personaFile = Bun.file(personaPath);
  if (!await personaFile.exists()) {
    throw new Error(`Persona file not found: ${personaPath}`);
  }
  const systemPrompt = await personaFile.text();
  const fullPrompt = `${task}${contextStr}`;

  return callLLM(systemPrompt, fullPrompt);
}

// Stub implementations - replace with real agent logic in later tasks

export async function researchRepo(input: ResearchInput): Promise<ResearchOutput> {
  const { projectPath, userContext = {}, agentId, runId } = input;

  // Read key files
  const readme = await readFile(path.join(projectPath, 'README.md')).catch(() => '');
  const packageJson = await readFile(path.join(projectPath, 'package.json')).catch(() => '');
  const srcDir = path.join(projectPath, 'src');
  const srcFiles = await listDir(srcDir).catch(() => []);

  // Build repo structure summary
  const repoStructure = [
    `README.md: ${readme.split('\n').slice(0, 10).join(' ')}...`,
    `package.json: ${packageJson}`,
    `src/: ${srcFiles.slice(0, 20).join(', ')}${srcFiles.length > 20 ? '...' : ''}`,
  ].join('\n');

  // Parse package.json for current features
  let currentFeatures: string[] = [];
  let gaps: string[] = [];
  try {
    const pkg = JSON.parse(packageJson);
    currentFeatures = Object.keys(pkg.dependencies || {}).slice(0, 10);
    if (!pkg.scripts?.test) gaps.push('No test script');
    if (!pkg.scripts?.lint) gaps.push('No lint script');
    if (!pkg.github) gaps.push('No GitHub Actions configured');
  } catch {
    gaps.push('Could not parse package.json');
  }

  // Call Claude Code research via persona
  const researchPrompt = `
Project path: ${projectPath}

User context (from previous sessions):
${Object.entries(userContext).map(([k, v]) => `${k}: ${v}`).join('\n')}

Research this codebase. Read README.md, package.json, and key source files.
Identify:
1. What does this project do?
2. What are the current features?
3. What gaps or technical debt exists?
4. What opportunities for improvement?

Format your response as JSON with fields: repoStructure, currentFeatures, gaps, opportunities, marketContext
`;

  const persona = await loadPersona(projectPath, 'researcher');
  const result = await callLLM(persona, researchPrompt, { cwd: projectPath, agentId, runId });

  // Parse the result
  try {
    const parsed = JSON.parse(result);
    return {
      repoStructure: parsed.repoStructure || repoStructure,
      currentFeatures: parsed.currentFeatures || currentFeatures,
      gaps: parsed.gaps || gaps,
      opportunities: parsed.opportunities || [],
      marketContext: parsed.marketContext || '',
    };
  } catch {
    return {
      repoStructure,
      currentFeatures,
      gaps,
      opportunities: [],
      marketContext: '',
    };
  }
}

export async function debateFeatures(input: DebateInput): Promise<DebateOutput> {
  const { repoAnalysis, suggestedFeatures, agentIds, runId } = input;

  // Load both debate personas
  const signalPersona = await loadPersona(process.cwd(), 'debate-signal');
  const noisePersona = await loadPersona(process.cwd(), 'debate-noise');

  const featuresToDebate = suggestedFeatures.length > 0
    ? suggestedFeatures
    : repoAnalysis.opportunities;

  // Run both agents in parallel
  const debatePrompt = `
You are debating features for this project:

REPO ANALYSIS:
${JSON.stringify(repoAnalysis, null, 2)}

FEATURES TO DEBATE:
${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}

For EACH feature, provide your assessment.
`;

  const [signalResult, noiseResult] = await Promise.all([
    callLLM(signalPersona, `FOR each feature:\n${debatePrompt}`, { agentId: agentIds?.signal, runId }),
    callLLM(noisePersona, `AGAINST each feature (be skeptical):\n${debatePrompt}`, { agentId: agentIds?.noise, runId }),
  ]);

  // Reconciliation: both agents' outputs are fed to a final arbiter. Stream it
  // into the signal pane by default so the user can see the arbiter reasoning.
  const reconcilePrompt = `Repo: ${repoAnalysis.repoStructure}\n\nSignal: ${signalResult}\n\nNoise: ${noiseResult}\n\nDecide which features to APPROVE (have genuine value and scope) and which to REJECT (noise or too ambitious). Respond as JSON with:\n- approvedFeatures: [{name, rationale, priority}]\n- rejectedFeatures: [{name, reason}]`;

  return await withJsonRetry<DebateOutput>(
    (suffix) => callLLM(
      'You are a pragmatic product manager. Filter signal from noise. Respond in JSON format only.',
      `${reconcilePrompt}${suffix ?? ''}`,
      { agentId: agentIds?.reconcile ?? agentIds?.signal, runId },
    ),
    {
      maxAttempts: 3,
      validate: (v): v is DebateOutput =>
        typeof v === 'object' && v !== null
        && Array.isArray((v as any).approvedFeatures)
        && Array.isArray((v as any).rejectedFeatures),
    },
  );
}

export async function generateTickets(input: TicketsInput): Promise<TicketsOutput> {
  const { approvedFeatures, agentId, runId } = input;

  if (approvedFeatures.length === 0) {
    return { tickets: [] };
  }

  const persona = await loadPersona(process.cwd(), 'ticket-bot');

  const prompt = `
Approved features to ticket:

${approvedFeatures.map(f => `- ${f.name}: ${f.rationale} (priority: ${f.priority})`).join('\n')}

For each feature, generate a ticket with:
- id: auto-generated (TICKET-1, TICKET-2, etc.)
- title: Concise feature name
- description: What and why (2-3 sentences)
- acceptanceCriteria: 3-5 specific, testable criteria
- estimate: T-shirt size (S/M/L/XL)

Respond ONLY with valid JSON array of tickets.
`;

  const tickets = await withJsonRetry<Ticket[]>(
    (suffix) => callLLM(persona, `${prompt}${suffix ?? ''}`, { agentId, runId }),
    {
      maxAttempts: 3,
      validate: (v): v is Ticket[] =>
        Array.isArray(v)
        && v.every((t) => typeof t === 'object' && t !== null && 'id' in t && 'title' in t && 'acceptanceCriteria' in t),
    },
  );
  return { tickets };
}

export async function scopeArchitecture(input: ScopeInput): Promise<ScopeOutput> {
  const { tickets, projectPath, worktreePath, agentId, runId } = input;

  const persona = await loadPersona(projectPath, 'architect');

  const prompt = `
Project path: ${projectPath}
Worktree: ${worktreePath}

Tickets to scope:

${tickets.map(t => `
TICKET: ${t.title}
${t.description}
Estimate: ${t.estimate}
`).join('\n---\n')}

For EACH ticket, provide:
1. technicalPlan: High-level approach (3-5 sentences)
2. filesToChange: Specific files to create/modify
3. dependencies: What must be done first (ticket IDs, or empty array)
4. complexity: "low" | "medium" | "high" — "low" for ≤2-file changes with no new types; "high" for >6 files, schema changes, or cross-cutting refactors; "medium" otherwise

Be specific. Generic plans are useless. Respond with ONLY a JSON array, one entry per input ticket, in input order.
`;

  type ArchitectEntry = {
    technicalPlan?: string;
    filesToChange?: string[];
    dependencies?: string[];
    complexity?: 'low' | 'medium' | 'high';
  };

  const parsed = await withJsonRetry<ArchitectEntry[]>(
    (suffix) => callLLM(persona, `${prompt}${suffix ?? ''}`, { cwd: projectPath, agentId, runId }),
    {
      maxAttempts: 3,
      validate: (v) => Array.isArray(v) && v.length === tickets.length,
    },
  );

  return {
    scopedTickets: tickets.map((t, i) => ({
      ...t,
      technicalPlan: parsed[i]?.technicalPlan || 'Plan pending',
      filesToChange: parsed[i]?.filesToChange ?? [],
      dependencies: parsed[i]?.dependencies ?? [],
      complexity: parsed[i]?.complexity ?? 'medium',
    })),
  };
}

export async function implementCode(input: ImplementInput): Promise<ImplementOutput> {
  const { ticket, worktreePath, projectPath, feedback, testFeedback, agentId, runId } = input;

  const persona = await loadPersona(projectPath, 'developer');

  const suggested = ticket.filesToChange.filter((p) => p && p.trim().length > 0);
  const existingContext = suggested.length > 0
    ? await readFilesForContext(worktreePath, suggested)
    : '(no suggested files — decide based on the ticket)';

  let prompt = `
Ticket: ${ticket.title}
${ticket.description}

Technical plan:
${ticket.technicalPlan}

Acceptance criteria:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

Suggested files to change: ${suggested.length > 0 ? suggested.join(', ') : '(decide based on context)'}

Current file contents (worktree rooted at ${worktreePath}):
${existingContext}
`;

  if (feedback && feedback.length > 0) {
    prompt += `\n\nCODE REVIEW FEEDBACK to address:\n${feedback.join('\n')}\n`;
  }
  if (testFeedback && testFeedback.length > 0) {
    prompt += `\n\nTEST FAILURES to fix:\n${testFeedback.join('\n')}\n`;
  }

  prompt += `

OUTPUT PROTOCOL — READ CAREFULLY
You cannot edit files directly. Emit file writes and deletes using these exact markers and nothing else will be applied:

=== BEGIN FILE: path/relative/to/worktree.ext ===
<full file contents — this REPLACES the file>
=== END FILE ===

=== DELETE FILE: path/relative/to/worktree.ext ===

Rules:
- Paths are relative to the worktree root. No absolute paths, no "..".
- Always emit the FULL intended contents of every file you change (not a diff, not a snippet).
- You may emit multiple BEGIN FILE / END FILE blocks. Emit DELETE FILE markers only when a file must be removed.
- Outside the markers you may write brief reasoning, but it will be ignored.
- End with a one-line summary prefixed "SUMMARY: ".`;

  const result = await callLLM(persona, prompt, { cwd: worktreePath, agentId, runId });
  const edits = parseFileEdits(result);
  if (edits.length === 0) {
    throw new Error(
      `Developer produced no file edits for ticket ${ticket.id}. Output preview: ${result.slice(0, 500)}`,
    );
  }
  const applied = await applyFileEdits(worktreePath, edits);

  return { code: result, filesChanged: applied };
}

export async function reviewCode(input: ReviewInput & { worktreePath?: string }): Promise<ReviewResult> {
  const { implementation, ticket, worktreePath, agentId, runId } = input;

  const persona = await loadPersona(process.cwd(), 'code-reviewer');

  const fileContents = worktreePath && implementation.filesChanged.length > 0
    ? await readFilesForContext(worktreePath, implementation.filesChanged)
    : '(no files to read)';

  const prompt = `
Review the changes for ticket: ${ticket.title}
${ticket.description}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Current file contents on disk:
${fileContents}

Evaluate against the acceptance criteria. Respond with ONLY a JSON object (no prose):
{ "approved": true|false, "comments": ["specific, actionable comment", ...] }
`;

  return await withJsonRetry<ReviewResult>(
    async (suffix) => stripThinking(await callLLM(persona, `${prompt}${suffix ?? ''}`, { cwd: worktreePath, agentId, runId })),
    {
      maxAttempts: 3,
      validate: (v): v is ReviewResult =>
        typeof v === 'object' && v !== null
        && typeof (v as any).approved === 'boolean'
        && Array.isArray((v as any).comments),
    },
  );
}

interface TestCommand { cmd: string; args: string[]; label: string; }

async function detectTestCommand(cwd: string): Promise<TestCommand | null> {
  const exists = (f: string) => fs.existsSync(path.join(cwd, f));

  if (exists('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      const testScript: string | undefined = pkg.scripts?.test;
      const isNoopTest = !testScript || /no test specified/i.test(testScript);
      if (!isNoopTest) {
        if (exists('bun.lockb') || exists('bun.lock')) return { cmd: 'bun', args: ['run', 'test'], label: 'bun run test' };
        if (exists('pnpm-lock.yaml')) return { cmd: 'pnpm', args: ['test'], label: 'pnpm test' };
        if (exists('yarn.lock')) return { cmd: 'yarn', args: ['test'], label: 'yarn test' };
        return { cmd: 'npm', args: ['test', '--', '--silent'], label: 'npm test' };
      }
    } catch { /* fall through */ }
  }
  if (exists('pyproject.toml') || exists('pytest.ini') || exists('setup.cfg')) {
    return { cmd: 'pytest', args: ['-q'], label: 'pytest' };
  }
  if (exists('Cargo.toml')) return { cmd: 'cargo', args: ['test', '--quiet'], label: 'cargo test' };
  if (exists('go.mod')) return { cmd: 'go', args: ['test', './...'], label: 'go test ./...' };
  return null;
}

function extractFailureLines(output: string, max = 15): string[] {
  const patterns = [/\bfail\b/i, /\berror\b/i, /✗|×|✘/, /AssertionError/i, /Expected/i, /Exception/i];
  const lines = output.split('\n');
  const hits: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (patterns.some((p) => p.test(trimmed))) {
      hits.push(trimmed.slice(0, 300));
      if (hits.length >= max) break;
    }
  }
  return hits;
}

export async function testCode(input: TestInput & { worktreePath?: string }): Promise<TestResult> {
  const { ticket, worktreePath } = input;
  const cwd = worktreePath || process.cwd();

  const testCmd = await detectTestCommand(cwd);
  if (!testCmd) {
    return {
      allPassed: false,
      failures: [
        `No test command detected in ${cwd}. Expected one of: package.json scripts.test, pyproject.toml, Cargo.toml, go.mod.`,
      ],
    };
  }

  const result = await execCmd(testCmd.cmd, testCmd.args, cwd, 15 * 60 * 1000);
  if (result.code === 0) {
    return { allPassed: true, failures: [] };
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  const extracted = extractFailureLines(combined);
  const tail = combined.split('\n').slice(-20).join('\n').trim();
  const failures = extracted.length > 0
    ? extracted
    : [`${testCmd.label} exited with code ${result.code}`, ...tail.split('\n').slice(-8)];

  return {
    allPassed: false,
    failures: [
      `command: ${testCmd.label} (exit ${result.code})`,
      `ticket: ${ticket.id}`,
      ...failures,
    ],
  };
}

export async function setupWorkspace(input: SetupWorkspaceInput): Promise<SetupWorkspaceOutput> {
  const { projectPath, projectSlug, runId } = input;
  const home = process.env.HOME ?? '/root';
  const worktreePath = path.join(home, '.atelier', 'worktrees', projectSlug, runId);
  const branch = `atelier/autopilot/${runId}`;

  const isGitRepo = (await execCmd('git', ['rev-parse', '--git-dir'], projectPath)).code === 0;

  if (!isGitRepo) {
    const init = await execCmd('git', ['init', '-b', 'main'], projectPath);
    if (init.code !== 0) throw new Error(`git init failed: ${init.stderr}`);
    // Ensure there's at least one commit so worktree add works.
    const hasCommit = (await execCmd('git', ['rev-parse', 'HEAD'], projectPath)).code === 0;
    if (!hasCommit) {
      await execCmd('git', ['add', '-A'], projectPath);
      await execCmd('git', ['commit', '--allow-empty', '-m', 'atelier: initial commit'], projectPath);
    }
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  // Clean any stale worktree directory.
  if (fs.existsSync(worktreePath)) {
    await execCmd('git', ['worktree', 'remove', '--force', worktreePath], projectPath);
  }
  const add = await execCmd('git', ['worktree', 'add', '-b', branch, worktreePath], projectPath);
  if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr}`);

  return { worktreePath, branch, isWorktree: true };
}

export async function pushChanges(input: PushInput): Promise<PushResult> {
  const { worktreePath, tickets } = input;

  const stage = await execCmd('git', ['add', '-A'], worktreePath);
  if (stage.code !== 0) throw new Error(`git add failed: ${stage.stderr}`);

  const status = await execCmd('git', ['status', '--porcelain'], worktreePath);
  const headBranch = await execCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  const branch = headBranch.stdout.trim() || `atelier/autopilot/${Date.now()}`;

  if (!status.stdout.trim()) {
    const sha = await execCmd('git', ['rev-parse', 'HEAD'], worktreePath);
    return { branch, commitSha: sha.stdout.trim() || 'no-changes' };
  }

  const ticketLines = tickets.map((t) => `- ${t.title}`).join('\n');
  const commitMsg = `atelier: autopilot run\n\n${ticketLines}`;
  const commit = await execCmd('git', ['commit', '-m', commitMsg], worktreePath);
  if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr}`);

  const sha = await execCmd('git', ['rev-parse', 'HEAD'], worktreePath);

  // Best-effort push; no remote or no auth is not fatal for a local run.
  const push = await execCmd('git', ['push', '-u', 'origin', branch], worktreePath);
  if (push.code !== 0) {
    console.warn(`[pushChanges] git push failed (non-fatal): ${push.stderr.trim()}`);
  }

  return { branch, commitSha: sha.stdout.trim() };
}

async function emitAgentEvent(id: string, event: { kind: string; [k: string]: any }): Promise<void> {
  try {
    await fetch('http://localhost:3001/api/agent/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, event }),
    });
  } catch { /* backend not reachable — non-fatal */ }
}

export async function notifyAgentStart(input: AgentNotification): Promise<void> {
  const model = await getPrimaryModelName();
  await emitAgentEvent(input.agentId, {
    kind: 'init',
    sessionId: input.agentId,
    model,
    cwd: '',
    tools: [],
  });
  await emitAgentEvent(input.agentId, {
    kind: 'text',
    text: `▶ ${input.agentName} starting…`,
  });
  try {
    await fetch('http://localhost:3001/api/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch { /* non-fatal */ }
}

export async function notifyAgentComplete(input: AgentCompletion): Promise<void> {
  await emitAgentEvent(input.agentId, {
    kind: 'text',
    text: input.status === 'completed' ? '✓ done' : `✗ error${input.output ? `: ${input.output}` : ''}`,
  });
  await emitAgentEvent(input.agentId, {
    kind: 'result',
    success: input.status === 'completed',
    turns: 1,
    durationMs: 0,
    text: input.output ?? '',
  });
  try {
    await fetch('http://localhost:3001/api/agent/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch { /* non-fatal */ }
}

export async function emitAgentText(input: { agentId: string; text: string }): Promise<void> {
  await emitAgentEvent(input.agentId, { kind: 'text', text: input.text });
}

const BACKEND_URL = 'http://localhost:3001';

export async function createMilestone(name: string, payload: unknown): Promise<MilestoneDecision> {
  // Get runId from context if available, otherwise use a default
  const runId = 'default';

  // Call backend to create milestone
  const response = await fetch(`${BACKEND_URL}/api/milestone/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, name, payload }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create milestone: ${response.statusText}`);
  }

  const { id } = await response.json();

  // Poll for resolution with exponential backoff
  const startTime = Date.now();
  const timeout = 7 * 24 * 60 * 60 * 1000; // 7 days

  while (Date.now() - startTime < timeout) {
    const checkResponse = await fetch(`${BACKEND_URL}/api/milestone/${id}`);
    if (checkResponse.ok) {
      const milestone = await checkResponse.json();
      if (milestone.resolved) {
        return milestone.decision;
      }
    }
    // Wait before next poll (1 second)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('Milestone timeout');
}

export async function resolveMilestone(
  milestoneId: string,
  decision: { verdict: string; reason?: string; decidedBy: string }
): Promise<void> {
  console.log('resolveMilestone', milestoneId, decision);
}