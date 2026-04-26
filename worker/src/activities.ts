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

export interface PanelReviewInput {
  implementation: Implementation;
  ticket: ScopedTicket;
  worktreePath?: string;
  runId?: string;
}

export interface PanelReviewResult {
  approved: boolean;
  blockers: Array<{ from: string; detail: string }>;
  advisories: Array<{ from: string; detail: string }>;
  summary: string;
  /** Raw per-specialist verdicts, keyed by specialist name. Useful for audit. */
  rawVerdicts: Record<string, unknown>;
  /** Combined, prioritised feedback strings suitable for handing back to the developer. */
  comments: string[];
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

export interface VerifyInput {
  worktreePath: string;
}

export interface StalledMilestoneInput {
  runId: string;
  kind: 'review' | 'test';
  ticketId: string;
  ticketTitle: string;
  lastAttemptSummary: string;
  panelVerdicts?: unknown;
}

export interface StalledMilestoneResult {
  /** 'skip' = continue to next ticket; 'abort' = stop the workflow with a stalled status. */
  decision: 'skip' | 'abort';
  reason?: string;
}

export interface VerifyOutput {
  allPassed: boolean;
  results: Array<{ label: string; passed: boolean; output: string }>;
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
import { callLLM, getPrimaryModelName, getPrimaryProvider, getApiKey } from './llm/callLLM.js';
import { withJsonRetry } from './llm/withJsonRetry.js';
import { NonRetryableAgentError } from './errors.js';
import { runVerify } from './verify.js';
import { loadPersona, loadPanel } from './personaLoader.js';
import { runOpenCodeAgent } from './llm/opencodeAgent.js';
import { useOpencode } from './llm/featureFlags.js';
import { sendAgentPrompt } from './llm/opencodeServeClient.js';
import { writeOpencodeConfig } from './llm/opencodeConfig.js';

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

// Legacy: only used on the one-shot LLM dictation path (ATELIER_USE_OPENCODE!=1).
// Under opencode the agent edits files directly via its own tools.
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

// Gather raw repo context that all researcher specialists share.
async function gatherRepoContext(projectPath: string): Promise<{ baseContext: string; srcFiles: string[] }> {
  const readme = await readFile(path.join(projectPath, 'README.md')).catch(() => '');
  const packageJson = await readFile(path.join(projectPath, 'package.json')).catch(() => '');
  const pyprojectToml = await readFile(path.join(projectPath, 'pyproject.toml')).catch(() => '');
  const cargoToml = await readFile(path.join(projectPath, 'Cargo.toml')).catch(() => '');
  const goMod = await readFile(path.join(projectPath, 'go.mod')).catch(() => '');
  const srcDir = path.join(projectPath, 'src');
  const srcFiles = await listDir(srcDir).catch(() => []);

  const baseContext = [
    `# Project: ${projectPath}`,
    readme && `## README.md (first 60 lines)\n${readme.split('\n').slice(0, 60).join('\n')}`,
    packageJson && `## package.json\n${packageJson.slice(0, 4000)}`,
    pyprojectToml && `## pyproject.toml\n${pyprojectToml.slice(0, 2000)}`,
    cargoToml && `## Cargo.toml\n${cargoToml.slice(0, 2000)}`,
    goMod && `## go.mod\n${goMod.slice(0, 2000)}`,
    srcFiles.length > 0 && `## src/ listing (first 30)\n${srcFiles.slice(0, 30).join(', ')}${srcFiles.length > 30 ? ' …' : ''}`,
  ].filter(Boolean).join('\n\n');

  return { baseContext, srcFiles };
}

// Recent commit subjects for the history specialist. Best-effort — a repo
// with no git history just produces an empty string and the specialist says so.
async function gitHistorySummary(projectPath: string, sinceDays = 90): Promise<string> {
  try {
    const result = await execCmd('git', [
      'log', `--since=${sinceDays}.days`, '--pretty=format:%ad %h %s', '--date=short', '-n', '200',
    ], projectPath, 30_000);
    if (result.code !== 0) return '';
    return result.stdout.trim();
  } catch {
    return '';
  }
}

const RESEARCHER_SPECIALISTS = ['architecture', 'dependencies', 'tests', 'history'] as const;
type ResearcherSpecialist = typeof RESEARCHER_SPECIALISTS[number];

export async function researchRepo(input: ResearchInput): Promise<ResearchOutput> {
  const { projectPath, userContext = {}, runId } = input;

  const { baseContext } = await gatherRepoContext(projectPath);
  const history = await gitHistorySummary(projectPath);

  if (await useOpencode()) {
    const panel = await loadPanel(process.cwd(), 'researcher', RESEARCHER_SPECIALISTS);
    const fragments = await Promise.all(RESEARCHER_SPECIALISTS.map(async (specialist) => {
      const agentId = `researcher-${specialist}`;
      await notifyAgentStart({ agentId, agentName: `Researcher (${specialist})`, terminalType: 'direct-llm' });
      const extra = specialist === 'history'
        ? `\n\n## Recent git history (subject lines, last 90 days)\n${history || '(no git history)'}`
        : '';
      try {
        const text = await sendAgentPrompt({
          runId,
          personaKey: agentId,
          personaText: panel[specialist],
          userPrompt: `${baseContext}${extra}`,
        });
        const out = await withJsonRetry<Record<string, unknown>>(
          () => Promise.resolve(text),
          { maxAttempts: 1, validate: (v) => typeof v === 'object' && v !== null },
        );
        await notifyAgentComplete({ agentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
        return [specialist, out] as const;
      } catch (e) {
        await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500) });
        return [specialist, { error: String(e) }] as const;
      }
    }));

    const specialistFindings = Object.fromEntries(fragments) as Record<ResearcherSpecialist, Record<string, unknown>>;
    const synthPersona = await loadPersona(process.cwd(), 'researcher-synthesizer');
    const synthPrompt = `User context: ${JSON.stringify(userContext)}\n\nSpecialist findings:\n${JSON.stringify(specialistFindings, null, 2)}`;
    try {
      const synthText = await sendAgentPrompt({
        runId,
        personaKey: 'researcher-synthesizer',
        personaText: synthPersona,
        userPrompt: synthPrompt,
      });
      return await withJsonRetry<ResearchOutput>(
        () => Promise.resolve(synthText),
        {
          maxAttempts: 1,
          validate: (v): v is ResearchOutput =>
            typeof v === 'object' && v !== null
            && typeof (v as any).repoStructure === 'string'
            && Array.isArray((v as any).currentFeatures)
            && Array.isArray((v as any).gaps)
            && Array.isArray((v as any).opportunities),
        },
      );
    } catch {
      return fallbackSynthesizeResearch(specialistFindings, baseContext);
    }
  }

  // Legacy path: pre-fetched context, callLLM per specialist.
  const panel = await loadPanel(process.cwd(), 'researcher', RESEARCHER_SPECIALISTS);
  const fragments = await Promise.all(RESEARCHER_SPECIALISTS.map(async (specialist) => {
    const agentId = `researcher-${specialist}`;
    await notifyAgentStart({ agentId, agentName: `Researcher (${specialist})`, terminalType: 'direct-llm' });
    try {
      const extra = specialist === 'history'
        ? `\n\n## Recent git history (subject lines, last 90 days)\n${history || '(no git history or git log failed)'}`
        : '';
      const out = await withJsonRetry<Record<string, unknown>>(
        (suffix) => callLLM(panel[specialist], `${baseContext}${extra}${suffix ?? ''}`, {
          cwd: projectPath, agentId, runId,
        }),
        {
          maxAttempts: 2,
          validate: (v) => typeof v === 'object' && v !== null,
        },
      );
      await notifyAgentComplete({ agentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
      return [specialist, out] as const;
    } catch (e) {
      await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500) });
      return [specialist, { error: String(e) }] as const;
    }
  }));

  const specialistFindings = Object.fromEntries(fragments) as Record<ResearcherSpecialist, Record<string, unknown>>;
  const synthPersona = await loadPersona(process.cwd(), 'researcher-synthesizer');
  const synthPrompt = `User context: ${JSON.stringify(userContext)}\n\nSpecialist findings:\n${JSON.stringify(specialistFindings, null, 2)}`;

  try {
    return await withJsonRetry<ResearchOutput>(
      (suffix) => callLLM(synthPersona, `${synthPrompt}${suffix ?? ''}`, {
        cwd: projectPath,
        agentId: 'researcher',
        runId,
      }),
      {
        maxAttempts: 3,
        validate: (v): v is ResearchOutput =>
          typeof v === 'object' && v !== null
          && typeof (v as any).repoStructure === 'string'
          && Array.isArray((v as any).currentFeatures)
          && Array.isArray((v as any).gaps)
          && Array.isArray((v as any).opportunities),
      },
    );
  } catch {
    return fallbackSynthesizeResearch(specialistFindings, baseContext);
  }
}

function fallbackSynthesizeResearch(
  findings: Record<ResearcherSpecialist, Record<string, unknown>>,
  baseContext: string,
): ResearchOutput {
  const arch: any = findings.architecture ?? {};
  const deps: any = findings.dependencies ?? {};
  const tests: any = findings.tests ?? {};
  const history: any = findings.history ?? {};

  const modulesLine = Array.isArray(arch.modules)
    ? arch.modules.map((m: any) => `${m.name} (${m.path})`).join(', ')
    : '';
  const repoStructure = [arch.layering, modulesLine].filter(Boolean).join(' · ')
    || baseContext.split('\n').slice(0, 3).join(' ');

  const currentFeatures: string[] = [];
  if (Array.isArray(arch.entrypoints)) currentFeatures.push(...arch.entrypoints.map((e: any) => String(e.name ?? e)));
  if (Array.isArray(deps.runtime)) currentFeatures.push(...deps.runtime.slice(0, 6).map((d: any) => String(d.name ?? d)));

  const gaps: string[] = [];
  if (Array.isArray(deps.risks)) gaps.push(...deps.risks);
  if (Array.isArray(tests.gapsByArea)) gaps.push(...tests.gapsByArea);
  if (tests.approximateCoverage === 'none' || tests.approximateCoverage === 'minimal') {
    gaps.push(`Test coverage: ${tests.approximateCoverage}`);
  }
  if (Array.isArray(history.refactorSignals)) gaps.push(...history.refactorSignals);

  return {
    repoStructure: repoStructure.slice(0, 1000),
    currentFeatures: currentFeatures.slice(0, 10),
    gaps: gaps.slice(0, 10),
    opportunities: Array.isArray(history.recentThemes) ? history.recentThemes.slice(0, 5) : [],
    marketContext: '(synthesizer unavailable — filled from specialist findings only)',
  };
}


const DEBATE_SPECIALISTS = ['signal', 'noise', 'security', 'perf', 'ux', 'maintainability'] as const;
type DebateSpecialist = typeof DEBATE_SPECIALISTS[number];

export async function debateFeatures(input: DebateInput): Promise<DebateOutput> {
  const { repoAnalysis, suggestedFeatures, agentIds, runId } = input;

  const featuresToDebate = suggestedFeatures.length > 0
    ? suggestedFeatures
    : repoAnalysis.opportunities;

  if (featuresToDebate.length === 0) {
    return { approvedFeatures: [], rejectedFeatures: [] };
  }

  const panel = await loadPanel(process.cwd(), 'debate', DEBATE_SPECIALISTS);

  const debatePrompt = `
You are assessing features for this project.

REPO ANALYSIS:
${JSON.stringify(repoAnalysis, null, 2)}

FEATURES TO ASSESS:
${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}

For EACH feature, provide your specialist-scoped assessment in the JSON shape your persona specifies.
`;

  const specialistAgentIds: Record<DebateSpecialist, string> = {
    signal: agentIds?.signal ?? 'debate-signal',
    noise: agentIds?.noise ?? 'debate-noise',
    security: 'debate-security',
    perf: 'debate-perf',
    ux: 'debate-ux',
    maintainability: 'debate-maintainability',
  };

  if (await useOpencode()) {
    const assessments = await Promise.all(DEBATE_SPECIALISTS.map(async (specialist) => {
      const sAgentId = specialistAgentIds[specialist];
      const isNew = specialist !== 'signal' && specialist !== 'noise';
      if (isNew) {
        await notifyAgentStart({ agentId: sAgentId, agentName: `Debate (${specialist})`, terminalType: 'direct-llm' });
      }
      try {
        const text = await sendAgentPrompt({
          runId,
          personaKey: sAgentId,
          personaText: panel[specialist],
          userPrompt: debatePrompt,
        });
        const out = await withJsonRetry<Record<string, unknown>>(
          () => Promise.resolve(text),
          {
            maxAttempts: 1,
            validate: (v) => typeof v === 'object' && v !== null && 'assessments' in (v as object),
          },
        );
        if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
        return [specialist, out] as const;
      } catch (e) {
        if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'error', output: String(e).slice(0, 500) });
        return [specialist, { error: String(e), assessments: [] }] as const;
      }
    }));
    const assessmentMap = Object.fromEntries(assessments) as Record<DebateSpecialist, Record<string, unknown>>;

    const reconcilerPersona = await loadPersona(process.cwd(), 'debate-reconciler');
    const reconcilePrompt = `Repo: ${repoAnalysis.repoStructure}\n\nFeatures assessed:\n${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nSpecialist assessments:\n${JSON.stringify(assessmentMap, null, 2)}`;

    const reconcileText = await sendAgentPrompt({
      runId,
      personaKey: agentIds?.reconcile ?? agentIds?.signal ?? 'debate-reconciler',
      personaText: reconcilerPersona,
      userPrompt: reconcilePrompt,
    });
    return await withJsonRetry<DebateOutput>(
      () => Promise.resolve(reconcileText),
      {
        maxAttempts: 1,
        validate: (v): v is DebateOutput =>
          typeof v === 'object' && v !== null
          && Array.isArray((v as any).approvedFeatures)
          && Array.isArray((v as any).rejectedFeatures),
      },
    );
  } else {
    // Legacy path: callLLM per specialist.
    const assessments = await Promise.all(DEBATE_SPECIALISTS.map(async (specialist) => {
      const sAgentId = specialistAgentIds[specialist];
      // signal/noise already get notifyAgentStart from the workflow. New
      // specialists need their own since the workflow doesn't know about them.
      const isNew = specialist !== 'signal' && specialist !== 'noise';
      if (isNew) {
        await notifyAgentStart({ agentId: sAgentId, agentName: `Debate (${specialist})`, terminalType: 'direct-llm' });
      }
      try {
        const out = await withJsonRetry<Record<string, unknown>>(
          (suffix) => callLLM(panel[specialist], `${debatePrompt}${suffix ?? ''}`, {
            agentId: sAgentId, runId,
          }),
          {
            maxAttempts: 2,
            validate: (v) => typeof v === 'object' && v !== null && 'assessments' in (v as object),
          },
        );
        if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'completed', output: JSON.stringify(out).slice(0, 500) });
        return [specialist, out] as const;
      } catch (e) {
        if (isNew) await notifyAgentComplete({ agentId: sAgentId, status: 'error', output: String(e).slice(0, 500) });
        return [specialist, { error: String(e), assessments: [] }] as const;
      }
    }));

    const assessmentMap = Object.fromEntries(assessments) as Record<DebateSpecialist, Record<string, unknown>>;
    const reconcilerPersona = await loadPersona(process.cwd(), 'debate-reconciler');
    const reconcilePrompt = `Repo: ${repoAnalysis.repoStructure}\n\nFeatures assessed:\n${featuresToDebate.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nSpecialist assessments:\n${JSON.stringify(assessmentMap, null, 2)}`;

    return await withJsonRetry<DebateOutput>(
      (suffix) => callLLM(
        reconcilerPersona,
        `${reconcilePrompt}${suffix ?? ''}`,
        { agentId: agentIds?.reconcile ?? agentIds?.signal ?? 'debate-reconciler', runId },
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

  if (await useOpencode()) {
    const text = await sendAgentPrompt({
      runId: runId ?? '',
      personaKey: agentId ?? 'ticket-bot',
      personaText: persona,
      userPrompt: prompt,
    });
    const tickets = await withJsonRetry<Ticket[]>(
      () => Promise.resolve(text),
      {
        maxAttempts: 1,
        validate: (v): v is Ticket[] =>
          Array.isArray(v)
          && v.every((t) => typeof t === 'object' && t !== null && 'id' in t && 'title' in t && 'acceptanceCriteria' in t),
      },
    );
    return { tickets };
  }

  // Legacy path.
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

  if (await useOpencode()) {
    const architectAgentId = agentId ?? 'architect';
    await notifyAgentStart({
      agentId: architectAgentId,
      agentName: 'Architect',
      terminalType: 'direct-llm',
    });
    try {
      const text = await sendAgentPrompt({
        runId: runId ?? '',
        personaKey: architectAgentId,
        personaText: persona,
        userPrompt: prompt,
      });
      const chosen = await withJsonRetry<ArchitectEntry[]>(
        () => Promise.resolve(text),
        {
          maxAttempts: 1,
          validate: (v) => Array.isArray(v) && v.length === tickets.length,
        },
      );
      await notifyAgentComplete({
        agentId: architectAgentId,
        status: 'completed',
        output: JSON.stringify(chosen).slice(0, 500),
      });
      return {
        scopedTickets: tickets.map((t, i) => ({
          ...t,
          technicalPlan: chosen[i]?.technicalPlan || 'Plan pending',
          filesToChange: chosen[i]?.filesToChange ?? [],
          dependencies: chosen[i]?.dependencies ?? [],
          complexity: chosen[i]?.complexity ?? 'medium',
        })),
      };
    } catch (e) {
      await notifyAgentComplete({ agentId: architectAgentId, status: 'error', output: String(e).slice(0, 500) });
      throw e;
    }
  }

  // Legacy path: best-of-3 parallel blind LLM calls with a judge.
  const candidateTemps = [0.2, 0.6, 0.9] as const;
  const candidates = await Promise.all(candidateTemps.map(async (temperature, idx) => {
    const subAgentId = `architect-${idx + 1}`;
    await notifyAgentStart({
      agentId: subAgentId,
      agentName: `Architect #${idx + 1} (temp=${temperature})`,
      terminalType: 'direct-llm',
    });
    try {
      const plan = await withJsonRetry<ArchitectEntry[]>(
        (suffix) => callLLM(persona, `${prompt}${suffix ?? ''}`, {
          cwd: projectPath, agentId: subAgentId, runId, temperature,
        }),
        {
          maxAttempts: 2,
          validate: (v) => Array.isArray(v) && v.length === tickets.length,
        },
      );
      await notifyAgentComplete({
        agentId: subAgentId,
        status: 'completed',
        output: JSON.stringify(plan).slice(0, 500),
      });
      return plan;
    } catch (e) {
      await notifyAgentComplete({
        agentId: subAgentId,
        status: 'error',
        output: String(e).slice(0, 500),
      });
      return null;
    }
  }));

  const validCandidates = candidates.filter((c): c is ArchitectEntry[] => c !== null);
  if (validCandidates.length === 0) {
    throw new NonRetryableAgentError('All architect candidates failed to produce valid plans');
  }

  // If only one candidate survived, skip the judge round-trip.
  let chosen: ArchitectEntry[];
  if (validCandidates.length === 1) {
    chosen = validCandidates[0];
  } else {
    const judgePersona = await loadPersona(projectPath, 'architect-judge');
    const judgePrompt = `Tickets:\n${JSON.stringify(tickets, null, 2)}\n\nCandidate plans:\n${validCandidates.map((c, i) => `=== PLAN ${i + 1} ===\n${JSON.stringify(c, null, 2)}`).join('\n\n')}`;
    const judgeAgentId = agentId ?? 'architect';
    try {
      chosen = await withJsonRetry<ArchitectEntry[]>(
        (suffix) => callLLM(judgePersona, `${judgePrompt}${suffix ?? ''}`, {
          cwd: projectPath, agentId: judgeAgentId, runId,
        }),
        {
          maxAttempts: 2,
          validate: (v) => Array.isArray(v) && v.length === tickets.length,
        },
      );
    } catch {
      // Judge failed validation — pick the first valid candidate rather than
      // blocking on a meta-agent. Every ticket still gets a plan.
      chosen = validCandidates[0];
    }
  }

  return {
    scopedTickets: tickets.map((t, i) => ({
      ...t,
      technicalPlan: chosen[i]?.technicalPlan || 'Plan pending',
      filesToChange: chosen[i]?.filesToChange ?? [],
      dependencies: chosen[i]?.dependencies ?? [],
      complexity: chosen[i]?.complexity ?? 'medium',
    })),
  };
}

export async function implementCode(input: ImplementInput): Promise<ImplementOutput> {
  const { ticket, worktreePath, projectPath, feedback, testFeedback, agentId, runId } = input;

  const persona = await loadPersona(projectPath, 'developer');

  // opencode path: spawn a real tool-using agent inside the worktree. The
  // agent has Read/Edit/Bash/Grep tools so it iterates against actual repo
  // state instead of dictating BEGIN FILE blocks blind. Gated behind a flag
  // until smoke-tested across more tickets.
  if (await useOpencode()) {
    const provider = await getPrimaryProvider();
    const apiKey = await getApiKey(provider.id, provider.kind);
    const run = await runOpenCodeAgent({
      worktreePath, ticket, feedback, testFeedback,
      agentId: agentId ?? 'developer',
      runId: runId ?? 'unknown',
      apiKey,
      primaryProvider: provider,
      developerPersona: persona,
    });
    if (run.filesChanged.length === 0) {
      // The model ran cleanly and explicitly chose to change nothing. Retrying
      // with the same prompt won't help — surface as non-retryable so the
      // workflow's stalled-milestone path can escalate to a human.
      throw new NonRetryableAgentError(
        `opencode produced no file changes for ticket ${ticket.id}. summary: ${run.summary}`,
      );
    }
    return { code: run.summary, filesChanged: run.filesChanged };
  }

  // Legacy path: one-shot LLM dictation with BEGIN FILE / END FILE parsing.
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
    // No amount of retry will fix a prompt/protocol mismatch — fail fast.
    throw new NonRetryableAgentError(
      `Developer produced no file edits for ticket ${ticket.id}. Output preview: ${result.slice(0, 500)}`,
    );
  }
  const applied = await applyFileEdits(worktreePath, edits);
  return { code: result, filesChanged: applied };
}

/**
 * Best-of-N developer for high-complexity tickets. Spawns N candidate
 * implementations at spread temperatures, applies the chosen one to the
 * worktree. Unlike implementCode, this does NOT apply all candidates —
 * only the single winner — so there's no race on the git index.
 *
 * Gating: the workflow routes here only when architect flagged
 * ticket.complexity === 'high'. Low/medium tickets keep the single-pass
 * implementCode path which is faster and usually sufficient.
 */
export async function implementCodeBestOfN(
  input: ImplementInput & { n?: number },
): Promise<ImplementOutput> {
  // Under opencode the inner agent iterates internally — spawning N parallel
  // candidates would race on the worktree's git index and require per-ticket
  // sub-worktrees to land safely. Defer that machinery; for now a single
  // well-resourced opencode run replaces N brittle one-shot candidates.
  if (await useOpencode()) {
    return implementCode(input);
  }

  const { ticket, worktreePath, projectPath, feedback, testFeedback, runId } = input;
  const n = Math.max(2, input.n ?? 3);

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

  // Generate N candidates in parallel with spread temperatures. Each writes
  // to its own agent pane for transparency; none of them touch the worktree.
  const tempsDefault = [0.3, 0.6, 0.9];
  const temps = Array.from({ length: n }, (_, i) => tempsDefault[i] ?? 0.3 + 0.2 * i);

  const candidates = await Promise.all(temps.map(async (temperature, idx) => {
    const subAgentId = `developer-${idx + 1}`;
    await notifyAgentStart({
      agentId: subAgentId,
      agentName: `Developer #${idx + 1} (temp=${temperature})`,
      terminalType: 'direct-llm',
    });
    try {
      const out = await callLLM(persona, prompt, {
        cwd: worktreePath, agentId: subAgentId, runId, temperature,
      });
      const edits = parseFileEdits(out);
      await notifyAgentComplete({
        agentId: subAgentId,
        status: 'completed',
        output: `${edits.length} edit(s) produced`,
      });
      return { output: out, edits };
    } catch (e) {
      await notifyAgentComplete({ agentId: subAgentId, status: 'error', output: String(e).slice(0, 500) });
      return null;
    }
  }));

  const valid = candidates
    .map((c, i) => c && c.edits.length > 0 ? { index: i, output: c.output } : null)
    .filter((c): c is { index: number; output: string } => c !== null);

  if (valid.length === 0) {
    throw new NonRetryableAgentError(
      `best-of-N: all ${n} developer candidates produced zero edits for ticket ${ticket.id}`,
    );
  }

  // If only one candidate validated, skip the judge and apply it.
  let winnerIdx: number;
  if (valid.length === 1) {
    winnerIdx = valid[0].index;
  } else {
    const judgePersona = await loadPersona(projectPath, 'developer-judge');
    const judgePrompt = `Ticket: ${ticket.title}\n${ticket.description}\n\nAcceptance:\n${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\nCandidates:\n${valid.map((c) => `=== CANDIDATE ${c.index} ===\n${c.output.slice(0, 10000)}`).join('\n\n')}`;
    try {
      const choice = await withJsonRetry<{ chosenIndex: number; reason: string }>(
        (suffix) => callLLM(judgePersona, `${judgePrompt}${suffix ?? ''}`, {
          agentId: 'developer-judge', runId,
        }),
        {
          maxAttempts: 2,
          validate: (v) =>
            typeof v === 'object' && v !== null
            && typeof (v as any).chosenIndex === 'number',
        },
      );
      winnerIdx = choice.chosenIndex >= 0 && valid.some((c) => c.index === choice.chosenIndex)
        ? choice.chosenIndex
        : valid[0].index;
    } catch {
      // Judge failed or returned -1 — use the first valid candidate.
      winnerIdx = valid[0].index;
    }
  }

  const winner = candidates[winnerIdx]!;
  const applied = await applyFileEdits(worktreePath, winner.edits);
  return { code: winner.output, filesChanged: applied };
}

export async function reviewCode(input: ReviewInput & { worktreePath?: string }): Promise<ReviewResult> {
  const { implementation, ticket, worktreePath, agentId, runId } = input;

  // reviewer-correctness now narrowly owns "does the code meet acceptance
  // criteria?" The full 4-specialist panel lives in reviewCodePanel.
  const persona = await loadPersona(process.cwd(), 'reviewer-correctness');

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

const REVIEWER_SPECIALISTS = ['correctness', 'security', 'tests', 'style'] as const;
type ReviewerSpecialist = typeof REVIEWER_SPECIALISTS[number];

/**
 * Multi-specialist reviewer. Runs correctness/security/tests/style in
 * parallel against the same implementation, then a synthesizer aggregates
 * the verdicts into a single approve/block decision plus concrete feedback.
 * Replaces the single-reviewer path; each specialist has its own narrow
 * prompt scope (see reviewer-<specialist>.md).
 */
export async function reviewCodePanel(input: PanelReviewInput): Promise<PanelReviewResult> {
  const { implementation, ticket, worktreePath, runId } = input;

  const panelPrompts = await loadPanel(process.cwd(), 'reviewer', REVIEWER_SPECIALISTS);

  const fileContents = worktreePath && implementation.filesChanged.length > 0
    ? await readFilesForContext(worktreePath, implementation.filesChanged)
    : '(no files to read)';

  const sharedContext = `
Ticket: ${ticket.title}
${ticket.description}

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Current file contents on disk:
${fileContents}

Evaluate strictly within your specialist scope. Respond with JSON only.
`;

  const verdicts = await Promise.all(
    REVIEWER_SPECIALISTS.map(async (specialist) => {
      const agentId = `reviewer-${specialist}`;
      await notifyAgentStart({ agentId, agentName: `Reviewer (${specialist})`, terminalType: 'direct-llm' });
      try {
        const verdict = await withJsonRetry<Record<string, unknown>>(
          (suffix) => callLLM(panelPrompts[specialist], `${sharedContext}${suffix ?? ''}`, {
            cwd: worktreePath, agentId, runId,
          }),
          {
            maxAttempts: 2,
            validate: (v) => typeof v === 'object' && v !== null && 'approved' in (v as object),
          },
        );
        await notifyAgentComplete({
          agentId,
          status: 'completed',
          output: JSON.stringify(verdict).slice(0, 500),
        });
        return [specialist, verdict] as const;
      } catch (e) {
        // If a single specialist can't produce valid JSON after 2 tries, treat
        // that specialist as blocking — missing signal is worse than a false
        // approval from the rest of the panel.
        await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500) });
        return [specialist, { approved: false, error: String(e) }] as const;
      }
    }),
  );

  const rawVerdicts = Object.fromEntries(verdicts) as Record<ReviewerSpecialist, Record<string, unknown>>;

  // Synthesizer — a 5th LLM call that aggregates. Faithful aggregation only;
  // never flips a specialist's verdict.
  const synthPersona = await loadPersona(process.cwd(), 'reviewer-synthesizer');
  const synthAgentId = 'reviewer-synthesizer';
  await notifyAgentStart({ agentId: synthAgentId, agentName: 'Reviewer Synthesizer', terminalType: 'direct-llm' });
  type Synth = { approved: boolean; blockers: Array<{ from?: string; detail?: string } | string>; advisories: Array<{ from?: string; detail?: string } | string>; summary: string };
  let synth: Synth;
  try {
    synth = await withJsonRetry<Synth>(
      (suffix) => callLLM(
        synthPersona,
        `Panel verdicts:\n${JSON.stringify(rawVerdicts, null, 2)}${suffix ?? ''}`,
        { agentId: synthAgentId, runId },
      ),
      {
        maxAttempts: 2,
        validate: (v) =>
          typeof v === 'object' && v !== null
          && typeof (v as any).approved === 'boolean'
          && Array.isArray((v as any).blockers)
          && Array.isArray((v as any).advisories),
      },
    );
  } catch {
    // Synthesizer itself failed — fall back to a deterministic aggregation
    // instead of blocking the whole pipeline on a meta-reviewer.
    synth = fallbackSynthesize(rawVerdicts);
  }
  await notifyAgentComplete({ agentId: synthAgentId, status: 'completed', output: synth.summary });

  const normalize = (e: { from?: string; detail?: string } | string, fallbackFrom: string) =>
    typeof e === 'string'
      ? { from: fallbackFrom, detail: e }
      : { from: e.from ?? fallbackFrom, detail: e.detail ?? JSON.stringify(e) };

  const blockers = synth.blockers.map((b) => normalize(b, 'panel'));
  const advisories = synth.advisories.map((a) => normalize(a, 'panel'));

  return {
    approved: synth.approved,
    blockers,
    advisories,
    summary: synth.summary,
    rawVerdicts,
    comments: blockers.map((b) => `[${b.from}] ${b.detail}`),
  };
}

function fallbackSynthesize(rawVerdicts: Record<string, any>): {
  approved: boolean;
  blockers: Array<{ from: string; detail: string }>;
  advisories: Array<{ from: string; detail: string }>;
  summary: string;
} {
  const blockers: Array<{ from: string; detail: string }> = [];
  for (const [specialist, v] of Object.entries(rawVerdicts)) {
    if (!v || typeof v !== 'object') continue;
    if (v.approved === false) {
      // Pull whatever findings are available — each specialist uses a slightly
      // different field name (comments/findings/untested/issues).
      const raw = v.comments ?? v.findings ?? v.untested ?? v.issues ?? [`${specialist} did not approve`];
      for (const item of (Array.isArray(raw) ? raw : [raw])) {
        blockers.push({ from: specialist, detail: typeof item === 'string' ? item : JSON.stringify(item) });
      }
    }
  }
  return {
    approved: blockers.length === 0,
    blockers,
    advisories: [],
    summary: blockers.length === 0 ? 'All specialists approved' : `${blockers.length} blocker(s) from panel (synthesizer fallback)`,
  };
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

export async function verifyCode(input: VerifyInput): Promise<VerifyOutput> {
  return runVerify(input.worktreePath);
}

/**
 * Called when a review or test loop has exhausted its 3-attempt budget.
 * Creates a milestone via the backend HTTP API and polls for a human decision.
 * The milestone existing POST /api/milestone/create endpoint sets status='pending'
 * and auto-times-out after 7 days; this activity polls /api/milestone/:id at a
 * reasonable cadence.
 *
 * Decision mapping (from the existing binary milestone API):
 * - status='approved' → decision='skip' (user says "give up on this ticket, move on")
 * - status='rejected' or 'timed-out' → decision='abort' (user says "stop the run")
 */
export async function emitStalledMilestone(input: StalledMilestoneInput): Promise<StalledMilestoneResult> {
  const created = await fetch(`${BACKEND_URL}/api/milestone/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: input.runId,
      name: `stalled-${input.kind}`,
      payload: {
        ticketId: input.ticketId,
        ticketTitle: input.ticketTitle,
        lastAttemptSummary: input.lastAttemptSummary,
        panelVerdicts: input.panelVerdicts,
        message: `The ${input.kind} loop for ticket "${input.ticketTitle}" exhausted its 3-attempt budget. Approve to skip this ticket and continue; reject to abort the run.`,
      },
    }),
  }).then((r) => r.json()) as { id: string };

  const milestoneId = created.id;
  // Poll at 5s. Temporal activity timeout is 30min by default, much shorter than
  // the milestone's 7-day server-side timeout — so we cap polling at ~25min here
  // and let Temporal's retry policy handle the "no decision in 30min" case by
  // re-invoking the activity (polling resumes against the same milestone).
  const hardDeadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < hardDeadline) {
    await new Promise<void>((res) => setTimeout(res, 5000));
    const state = await fetch(`${BACKEND_URL}/api/milestone/${milestoneId}`)
      .then((r) => r.json()) as { resolved?: boolean; status?: string; decision?: { verdict?: string; reason?: string } };
    if (state.resolved) {
      const verdict = state.decision?.verdict;
      if (verdict === 'Approved') {
        return { decision: 'skip', reason: state.decision?.reason ?? 'approved: skip this ticket' };
      }
      return { decision: 'abort', reason: state.decision?.reason ?? `${verdict ?? 'rejected'}: abort run` };
    }
  }
  // No decision in 25min — re-throw so Temporal retries the polling. The
  // milestone ID is regenerated on each retry, which is fine because the user
  // sees a fresh pending milestone and can decide on the new one.
  throw new Error(`Stalled milestone ${milestoneId} not decided within activity timeout`);
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

const OPENCODE_BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export async function startRunOpencode(input: { runId: string; worktreePath: string }): Promise<void> {
  const response = await fetch(`${OPENCODE_BACKEND}/api/opencode/run/${encodeURIComponent(input.runId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreePath: input.worktreePath }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to start opencode serve for run ${input.runId}: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
}

export async function stopRunOpencode(input: { runId: string }): Promise<void> {
  // Best-effort: failure here is non-fatal, the cleanup just leaks a subprocess
  // until the backend exits. Don't throw.
  try {
    await fetch(`${OPENCODE_BACKEND}/api/opencode/run/${encodeURIComponent(input.runId)}/stop`, {
      method: 'POST',
    });
  } catch {
    // Backend unreachable — caller has nothing useful to do.
  }
}

// Workflow code can't read process.env or call fetch directly. Expose the
// flag resolver as an activity so the workflow can branch on it.
export async function useOpencodeForRun(): Promise<boolean> {
  return useOpencode();
}

export async function bootstrapOpencodeWorktree(input: { worktreePath: string }): Promise<void> {
  const provider = await getPrimaryProvider();
  await writeOpencodeConfig(input.worktreePath, provider);
}