import { keytar } from 'keytar';

const SERVICE_NAME = 'Atelier';
const KEYCHAIN_PREFIX = 'atelier.provider.';

function keychainKey(providerId: string, key: string) {
  return `${KEYCHAIN_PREFIX}${providerId}.${key}`;
}

export async function callMiniMax(system: string, user: string): Promise<string> {
  const apiKey = await keytar.getPassword(SERVICE_NAME, keychainKey('minimax', 'apiKey'));
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

  // For MVP, we use a simple prompt-based approach
  // Persona files contain the system prompt
  const personaPrompts: Record<string, string> = {
    'Researcher A': 'You are Researcher A, a thorough researcher...',
    'Researcher B': 'You are Researcher B, a critical analyst...',
    'Synthesizer': 'You are Synthesizer, an expert at combining...',
    'Architect': 'You are Architect, a senior technical leader...',
    'Code Writer': 'You are Code Writer, a pragmatic software engineer...',
  };

  const systemPrompt = personaPrompts[agentName] || 'You are a helpful assistant.';
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