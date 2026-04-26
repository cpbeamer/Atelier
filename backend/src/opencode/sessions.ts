import { runRegistry } from './run-registry.js';
import type { Persona } from './personas.js';

export interface EnsureSessionResult { sessionId: string; }

export async function ensureSession(runId: string, persona: Persona): Promise<EnsureSessionResult> {
  const entry = runRegistry.get(runId);
  if (!entry) throw new Error(`No run registered for ${runId}`);

  const cached = entry.sessions.get(persona);
  if (cached) return { sessionId: cached };

  const auth = `Basic ${btoa(`opencode:${entry.password}`)}`;

  const res = await fetch(`http://127.0.0.1:${entry.port}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify({ title: persona, agentName: persona }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`opencode session create failed (${res.status}): ${text}`);
  }
  const { id } = (await res.json()) as { id: string };
  runRegistry.attachSession(runId, persona, id);
  return { sessionId: id };
}
