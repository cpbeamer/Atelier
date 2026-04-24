export interface MilestoneDecision {
  verdict: 'Approved' | 'Rejected';
  reason?: string;
  decidedBy: string;
}

export interface ResearchInput {
  projectPath: string;
  userContext?: Record<string, string>;
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
}

export interface TicketsOutput {
  tickets: Ticket[];
}

export interface ScopedTicket extends Ticket {
  technicalPlan: string;
  filesToChange: string[];
  dependencies: string[];
}

export interface ScopeInput {
  tickets: Ticket[];
  projectPath: string;
  worktreePath: string;
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
}

export interface TestResult {
  allPassed: boolean;
  failures: string[];
}

export interface TestInput {
  implementation: Implementation;
  ticket: ScopedTicket;
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

export async function callClaude(system: string, user: string, cwd?: string): Promise<string> {
  const prompt = `${system}\n\n---\n\n${user}`;
  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  const result = await execCmd(
    claudeBin,
    ['-p', prompt, '--dangerously-skip-permissions'],
    cwd,
    30 * 60 * 1000,
  );
  if (result.code !== 0) {
    throw new Error(`claude CLI exited with code ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

// Legacy alias — preserved so any lingering references keep compiling.
export const callMiniMax = callClaude;

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

  return callMiniMax(systemPrompt, fullPrompt);
}

// Stub implementations - replace with real agent logic in later tasks

export async function researchRepo(input: ResearchInput): Promise<ResearchOutput> {
  const { projectPath, userContext = {} } = input;

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
  const result = await callClaude(persona, researchPrompt, projectPath);

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
  const { repoAnalysis, suggestedFeatures } = input;

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
    callMiniMax(signalPersona, `FOR each feature:\n${debatePrompt}`),
    callMiniMax(noisePersona, `AGAINST each feature (be skeptical):\n${debatePrompt}`),
  ]);

  // Reconciliation: both agents' outputs are fed to a final arbiter
  const reconciliation = await callMiniMax(
    'You are a pragmatic product manager. Filter signal from noise. Respond in JSON format only.',
    `Repo: ${repoAnalysis.repoStructure}\n\nSignal: ${signalResult}\n\nNoise: ${noiseResult}\n\nDecide which features to APPROVE (have genuine value and scope) and which to REJECT (noise or too ambitious). Respond as JSON with:\n- approvedFeatures: [{name, rationale, priority}]\n- rejectedFeatures: [{name, reason}]`
  );

  try {
    return JSON.parse(reconciliation);
  } catch {
    return {
      approvedFeatures: featuresToDebate.slice(0, 3).map(f => ({ name: f, rationale: 'Default approved', priority: 'medium' as const })),
      rejectedFeatures: [],
    };
  }
}

export async function generateTickets(input: TicketsInput): Promise<TicketsOutput> {
  const { approvedFeatures } = input;

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

  const result = await callMiniMax(persona, prompt);

  try {
    const tickets = JSON.parse(result);
    return { tickets };
  } catch {
    return {
      tickets: approvedFeatures.map((f, i) => ({
        id: `TICKET-${i + 1}`,
        title: f.name,
        description: f.rationale,
        acceptanceCriteria: ['Implementation complete'],
        estimate: f.priority === 'high' ? 'L' : 'M',
      })),
    };
  }
}

export async function scopeArchitecture(input: ScopeInput): Promise<ScopeOutput> {
  const { tickets, projectPath, worktreePath } = input;

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
3. dependencies: What must be done first

Be specific. Generic plans are useless.
`;

  const result = await callClaude(persona, prompt, projectPath);

  // Try to parse as JSON, fall back to structured parsing
  try {
    const parsed = JSON.parse(result);
    return {
      scopedTickets: tickets.map((t, i) => ({
        ...t,
        technicalPlan: parsed[i]?.technicalPlan || 'Plan pending',
        filesToChange: parsed[i]?.filesToChange || [],
        dependencies: parsed[i]?.dependencies || [],
      })),
    };
  } catch {
    // Fall back: split by ticket and extract fields heuristically
    return {
      scopedTickets: tickets.map(t => ({
        ...t,
        technicalPlan: result.substring(0, 500),
        filesToChange: [],
        dependencies: [],
      })),
    };
  }
}

export async function implementCode(input: ImplementInput): Promise<ImplementOutput> {
  const { ticket, worktreePath, projectPath, feedback, testFeedback } = input;

  const persona = await loadPersona(projectPath, 'developer');

  let prompt = `
You are working inside the worktree at: ${worktreePath}
This IS your current working directory. You have full file-edit and shell access.

Ticket: ${ticket.title}
${ticket.description}

Technical plan:
${ticket.technicalPlan}

Suggested files to change: ${ticket.filesToChange.join(', ') || '(decide from context)'}

Acceptance criteria:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}
`;

  if (feedback && feedback.length > 0) {
    prompt += `\n\nCODE REVIEW FEEDBACK to address:
${feedback.join('\n')}\n`;
  }

  if (testFeedback && testFeedback.length > 0) {
    prompt += `\n\nTEST FAILURES to fix:
${testFeedback.join('\n')}\n`;
  }

  prompt += `\n\nREQUIREMENTS:
- Actually edit the files — do not just describe changes. Use the Edit/Write tools.
- Keep changes focused on this ticket.
- After editing, list every file you changed on its own line, prefixed with "FILE_CHANGED: ".
- End your response with a short summary block starting with "SUMMARY:".`;

  const result = await callClaude(persona, prompt, worktreePath);

  // Extract files the agent reported editing.
  const filesChanged = Array.from(
    new Set(
      Array.from(result.matchAll(/^FILE_CHANGED:\s*(.+)$/gm)).map((m) => m[1].trim()),
    ),
  );

  return {
    code: result,
    filesChanged: filesChanged.length > 0 ? filesChanged : ticket.filesToChange,
  };
}

export async function reviewCode(input: ReviewInput & { worktreePath?: string }): Promise<ReviewResult> {
  const { implementation, ticket, worktreePath } = input;

  const persona = await loadPersona(process.cwd(), 'code-reviewer');

  const prompt = `
Review the changes for ticket: ${ticket.title}

FILES CHANGED: ${implementation.filesChanged.join(', ')}
You can read the actual files on disk to verify the implementation matches the description.

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

DEVELOPER OUTPUT:
${implementation.code.slice(0, 4000)}

Read the changed files, evaluate them against the acceptance criteria, and respond with ONLY a JSON object:
{ "approved": true|false, "comments": ["specific, actionable comment", ...] }
`;

  const result = await callClaude(persona, prompt, worktreePath);

  try {
    // Extract the JSON object if there's surrounding prose.
    const match = result.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : JSON.parse(result);
  } catch {
    return { approved: false, comments: ['Could not parse review output'] };
  }
}

export async function testCode(input: TestInput & { worktreePath?: string }): Promise<TestResult> {
  const { implementation, ticket, worktreePath } = input;

  const persona = await loadPersona(process.cwd(), 'tester');

  const prompt = `
You are in the project worktree${worktreePath ? ` at ${worktreePath}` : ''}.

Ticket: ${ticket.title}
FILES CHANGED: ${implementation.filesChanged.join(', ')}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

Verify the implementation:
1. Detect the project's test command (package.json scripts, pytest, go test, cargo test, etc.)
2. Run it. If the project has no tests, write minimal smoke tests for the acceptance criteria and run them.
3. Record which criteria pass and which fail.

Respond with ONLY a JSON object:
{ "allPassed": true|false, "failures": ["criterion that failed or error message", ...] }
`;

  const result = await callClaude(persona, prompt, worktreePath);

  try {
    const match = result.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : JSON.parse(result);
  } catch {
    return { allPassed: false, failures: ['Could not parse test output'] };
  }
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

export async function notifyAgentStart(input: AgentNotification): Promise<void> {
  // Notify frontend via HTTP callback to show this agent's terminal
  try {
    await fetch('http://localhost:3001/api/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    // Backend not reachable - non-fatal
  }
}

export async function notifyAgentComplete(input: AgentCompletion): Promise<void> {
  try {
    await fetch('http://localhost:3001/api/agent/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    // Non-fatal
  }
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