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

async function readFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
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

export async function callMiniMax(system: string, user: string): Promise<string> {
  // Get API key from env var or backend
  let apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    try {
      const response = await fetch('http://localhost:3001/api/settings/apiKey/minimax');
      if (response.ok) {
        const data = await response.json();
        apiKey = data.apiKey;
      }
    } catch {
      // Backend not reachable
    }
  }
  if (!apiKey) {
    throw new Error('MiniMax API key not configured. Add it in Settings.');
  }

  const response = await fetch('https://api.minimax.chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'MiniMax/Abab6.5s-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
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

  return callMiniMax(systemPrompt, fullPrompt);
}

// Stub implementations - replace with real agent logic in later tasks

export async function researchRepo(input: ResearchInput): Promise<ResearchOutput> {
  // TODO: Read repo files, run Claude Code research agent
  return {
    repoStructure: 'stub: would scan project files',
    currentFeatures: ['auth', 'api'],
    gaps: ['no tests', 'no ci'],
    opportunities: ['add ci/cd', 'add e2e tests'],
    marketContext: 'stub: would search web for competitor features',
  };
}

export async function debateFeatures(input: DebateInput): Promise<DebateOutput> {
  // TODO: Run debate agents in parallel, reconcile
  return {
    approvedFeatures: [{ name: 'Add CI/CD', rationale: 'table stakes', priority: 'high' }],
    rejectedFeatures: [{ name: 'Add AI buzzword feature', reason: 'vanity, no user need' }],
  };
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
  // TODO: Call Architect terminal agent
  return {
    scopedTickets: input.tickets.map(t => ({
      ...t,
      technicalPlan: 'stub: would create technical plan',
      filesToChange: ['.github/workflows/ci.yml'],
      dependencies: [],
    })),
  };
}

export async function implementCode(input: ImplementInput): Promise<ImplementOutput> {
  const { ticket, worktreePath, projectPath, feedback, testFeedback } = input;

  const persona = await loadPersona(projectPath, 'developer');

  let prompt = `
Ticket: ${ticket.title}
${ticket.description}

Technical plan:
${ticket.technicalPlan}

Files to change: ${ticket.filesToChange.join(', ')}

Worktree: ${worktreePath}
`;

  if (feedback && feedback.length > 0) {
    prompt += `\n\nCODE REVIEW FEEDBACK to address:
${feedback.join('\n')}\n`;
  }

  if (testFeedback && testFeedback.length > 0) {
    prompt += `\n\nTEST FAILURES to fix:
${testFeedback.join('\n')}\n`;
  }

  const result = await callMiniMax(persona, prompt);

  // Developer outputs the actual code changes - parse and apply them
  // For now, return the LLM output as code
  return {
    code: result,
    filesChanged: ticket.filesToChange,
  };
}

export async function reviewCode(input: ReviewInput): Promise<ReviewResult> {
  const { implementation, ticket } = input;

  const persona = await loadPersona(process.cwd(), 'code-reviewer');

  const prompt = `
Review this code for ticket: ${ticket.title}

CODE:
\`\`\`
${implementation.code}
\`\`\`

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

FILES CHANGED: ${implementation.filesChanged.join(', ')}

Review against the criteria. Return JSON:
{ "approved": true/false, "comments": ["specific comment 1", "specific comment 2"] }
`;

  const result = await callMiniMax(persona, prompt);

  try {
    return JSON.parse(result);
  } catch {
    return { approved: false, comments: ['Could not parse review output'] };
  }
}

export async function testCode(input: TestInput): Promise<TestResult> {
  const { implementation, ticket } = input;

  const persona = await loadPersona(process.cwd(), 'tester');

  const prompt = `
Test this implementation for ticket: ${ticket.title}

CODE:
\`\`\`
${implementation.code}
\`\`\`

ACCEPTANCE CRITERIA:
${ticket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

FILES: ${implementation.filesChanged.join(', ')}

Write and run tests to verify each acceptance criterion.
Report pass/fail for each criterion.

Return JSON:
{ "allPassed": true/false, "failures": ["criterion that failed", ...] }
`;

  const result = await callMiniMax(persona, prompt);

  try {
    return JSON.parse(result);
  } catch {
    return { allPassed: false, failures: ['Could not parse test output'] };
  }
}

export async function pushChanges(input: PushInput): Promise<PushResult> {
  // TODO: Call Pusher (direct LLM)
  return { branch: 'atelier/autopilot/run-1', commitSha: 'abc123' };
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