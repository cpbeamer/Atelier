// backend/src/db.ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.join(process.env.HOME || '', '.atelier', 'db', 'atelier.sqlite');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
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
  `);
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
};
