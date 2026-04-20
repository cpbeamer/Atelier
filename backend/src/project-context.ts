// backend/src/project-context.ts
import { projectContext } from './db.js';
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectContext {
  userPreferences?: Record<string, string>;
  previousDebateOutcomes?: Array<{ feature: string; verdict: string; rationale: string }>;
  knownConstraints?: string[];
  projectGoals?: string[];
}

const CONTEXT_DIR = (projectPath: string) => path.join(projectPath, '.atelier', 'context');
const CONTEXT_FILE = (projectPath: string) => path.join(CONTEXT_DIR(projectPath), 'context.json');

export function loadProjectContext(projectPath: string): ProjectContext {
  // Try DB first
  const projectId = path.basename(projectPath);
  const dbRecord = projectContext.get(projectId);
  if (dbRecord) {
    try {
      return JSON.parse(dbRecord.context_json);
    } catch {
      // Fall through to file
    }
  }

  // Fall back to file
  const filePath = CONTEXT_FILE(projectPath);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // Ignore
  }

  return {};
}

export function saveProjectContext(projectPath: string, context: ProjectContext): void {
  const dir = CONTEXT_DIR(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = CONTEXT_FILE(projectPath);
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2));

  // Also save to DB
  const projectId = path.basename(projectPath);
  projectContext.set(projectId, JSON.stringify(context));
}
