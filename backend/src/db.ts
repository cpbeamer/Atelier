// backend/src/db.ts
import { Database } from 'bun:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(process.env.HOME || '', '.atelier', 'db', 'atelier.sqlite');

let db: Database;

export function getDb(): Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.run('PRAGMA journal_mode = WAL');
    migrate();
  }
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL,
      settings_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      temporal_workflow_id TEXT UNIQUE,
      temporal_run_id TEXT,
      status TEXT NOT NULL,
      worktree_path TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      total_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0,
      input_json TEXT,
      result_json TEXT
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT,
      decision_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project ON workflow_runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_milestones_pending ON milestones(status);

    CREATE TABLE IF NOT EXISTS model_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      models_json TEXT DEFAULT '[]',
      selected_model TEXT
    );

    CREATE TABLE IF NOT EXISTS project_context (
      project_id TEXT PRIMARY KEY,
      context_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `);

  // Add selected_model column to existing DBs (idempotent — wrapped because
  // ADD COLUMN is not guarded by IF NOT EXISTS in older SQLite versions).
  try {
    db.exec(`ALTER TABLE model_config ADD COLUMN selected_model TEXT`);
  } catch {
    // Column already exists — expected on subsequent boots.
  }

  // Seed MiniMax and OpenRouter if no providers exist
  const count = getDb().prepare('SELECT COUNT(*) as c FROM model_config').get() as { c: number };
  if (count.c === 0) {
    getDb().prepare(`INSERT INTO model_config (id, name, base_url, enabled, models_json) VALUES (?,?,?,?,?)`)
      .run('minimax', 'MiniMax', 'https://api.minimax.io/v1', 1, '["MiniMax-M2.7","MiniMax-M2.7-highspeed"]');
    getDb().prepare(`INSERT INTO model_config (id, name, base_url, enabled, models_json) VALUES (?,?,?,?,?)`)
      .run('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 0, '["anthropic/claude-3.5-sonnet","openai/gpt-4o"]');
  } else {
    // Migrate existing minimax row to M2.7 endpoint/models (idempotent).
    getDb().prepare(`UPDATE model_config SET base_url = ?, models_json = ? WHERE id = 'minimax'`)
      .run('https://api.minimax.io/v1', '["MiniMax-M2.7","MiniMax-M2.7-highspeed"]');
  }
}

export const projects = {
  insert: (id: string, name: string, path: string, created_at: number, last_opened_at: number, settings_json = '{}') =>
    getDb().prepare('INSERT INTO projects VALUES (?,?,?,?,?,?)').run(id, name, path, created_at, last_opened_at, settings_json),
  list: () => getDb().prepare('SELECT * FROM projects ORDER BY last_opened_at DESC').all(),
  findById: (id: string) => getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id),
  updateLastOpened: (id: string, last_opened_at: number) =>
    getDb().prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(last_opened_at, id),
};

export const runs = {
  insert: (id: string, project_id: string, workflow_name: string, temporal_workflow_id: string, status: string, started_at: number, input_json: string) =>
    getDb().prepare('INSERT INTO workflow_runs (id,project_id,workflow_name,temporal_workflow_id,status,started_at,input_json) VALUES (?,?,?,?,?,?,?)')
      .run(id, project_id, workflow_name, temporal_workflow_id, status, started_at, input_json),
  listByProject: (projectId: string) =>
    getDb().prepare('SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 50').all(projectId),
  updateStatus: (id: string, status: string, completed_at?: number) =>
    completed_at
      ? getDb().prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?').run(status, completed_at, id)
      : getDb().prepare('UPDATE workflow_runs SET status = ? WHERE id = ?').run(status, id),
};

export const milestones = {
  insert: (id: string, run_id: string, type: string, status: string, payload_json: string, created_at: number) =>
    getDb().prepare('INSERT INTO milestones (id,run_id,type,status,payload_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, run_id, type, status, payload_json, created_at),
  updateDecision: (id: string, status: string, decided_at: number, decided_by: string, decision_reason: string | null) =>
    getDb().prepare('UPDATE milestones SET status=?,decided_at=?,decided_by=?,decision_reason=? WHERE id=?')
      .run(status, decided_at, decided_by, decision_reason, id),
  listPending: () => getDb().prepare("SELECT * FROM milestones WHERE status='pending' ORDER BY created_at").all(),
  listByRun: (runId: string) => getDb().prepare('SELECT * FROM milestones WHERE run_id = ? ORDER BY created_at').all(runId),
  findById: (id: string) => getDb().prepare('SELECT * FROM milestones WHERE id = ?').get(id),
};

export const modelConfig = {
  upsert: (id: string, name: string, baseUrl: string, enabled: number, modelsJson: string) =>
    getDb().prepare(`
      INSERT INTO model_config (id, name, base_url, enabled, models_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, base_url=excluded.base_url,
        enabled=excluded.enabled, models_json=excluded.models_json
    `).run(id, name, baseUrl, enabled, modelsJson),
  list: () => getDb().prepare('SELECT * FROM model_config ORDER BY name').all(),
  setEnabled: (id: string, enabled: number) =>
    getDb().prepare('UPDATE model_config SET enabled=? WHERE id=?').run(enabled, id),
  setModels: (id: string, modelsJson: string) =>
    getDb().prepare('UPDATE model_config SET models_json=? WHERE id=?').run(modelsJson, id),
  setSelectedModel: (id: string, selectedModel: string | null) =>
    getDb().prepare('UPDATE model_config SET selected_model=? WHERE id=?').run(selectedModel, id),
};

export const projectContext = {
  get: (projectId: string) =>
    getDb().prepare('SELECT context_json FROM project_context WHERE project_id = ?').get(projectId) as { context_json: string } | undefined,
  set: (projectId: string, contextJson: string) =>
    getDb().prepare(`
      INSERT INTO project_context (project_id, context_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET context_json = excluded.context_json, updated_at = excluded.updated_at
    `).run(projectId, contextJson, Date.now()),
};
