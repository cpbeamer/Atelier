// Persona loader. A persona is the system-prompt half of an agent call.
// Resolution order: project-local override at
// `<projectPath>/.atelier/agents/<personaKey>.md`, falling back to the
// bundled persona at `<workerCwd>/src/.atelier/agents/<personaKey>.md`.
//
// loadPanel batches N specialist prompts under a shared prefix — e.g.
// loadPanel(cwd, 'reviewer', ['correctness', 'security']) → { correctness, security }
// reading `reviewer-correctness.md` and `reviewer-security.md` in parallel.

import fs from 'node:fs';
import path from 'node:path';

export async function loadPersona(projectPath: string, personaKey: string): Promise<string> {
  const projectOverride = path.join(projectPath, '.atelier', 'agents', `${personaKey}.md`);
  try {
    return await fs.promises.readFile(projectOverride, 'utf-8');
  } catch {
    const bundled = path.join(process.cwd(), 'src', '.atelier', 'agents', `${personaKey}.md`);
    return fs.promises.readFile(bundled, 'utf-8');
  }
}

export async function loadPanel<S extends string>(
  projectPath: string,
  prefix: string,
  specialists: readonly S[],
): Promise<Record<S, string>> {
  const entries = await Promise.all(
    specialists.map(async (s) => [s, await loadPersona(projectPath, `${prefix}-${s}`)] as const),
  );
  return Object.fromEntries(entries) as Record<S, string>;
}
