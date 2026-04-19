export async function callMiniMax(system: string, user: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error('MiniMax API key not configured. Set the MINIMAX_API_KEY environment variable.');
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

export async function createMilestone(name: string, payload: unknown): Promise<string> {
  const id = crypto.randomUUID();
  return id;
}

export async function resolveMilestone(
  milestoneId: string,
  decision: { verdict: string; reason?: string; decidedBy: string }
): Promise<void> {
  console.log('resolveMilestone', milestoneId, decision);
}