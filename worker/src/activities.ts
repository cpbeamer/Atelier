export interface MilestoneDecision {
  verdict: 'Approved' | 'Rejected';
  reason?: string;
  decidedBy: string;
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