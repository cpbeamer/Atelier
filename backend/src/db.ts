// backend/src/db.ts
import { Database } from 'bun:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { CURATED_PROVIDERS, type ProviderKind } from './providers/registry.js';

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

    CREATE TABLE IF NOT EXISTS agent_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_calls_run ON agent_calls(run_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_agent_calls_agent ON agent_calls(agent_id, started_at);

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

  // Idempotent ALTER TABLE additions. SQLite ADD COLUMN isn't guarded by
  // IF NOT EXISTS in older versions, so wrap each in try/catch.
  for (const ddl of [
    `ALTER TABLE model_config ADD COLUMN selected_model TEXT`,
    `ALTER TABLE model_config ADD COLUMN kind TEXT NOT NULL DEFAULT 'openai-compatible'`,
    `ALTER TABLE model_config ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE model_config ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`,
  ]) {
    try { db.exec(ddl); } catch { /* column already exists */ }
  }

  syncProvidersFromRegistry();
}

// Upsert curated providers from registry on every boot. INSERTs new rows
// with defaultEnabled honored; UPDATEs name/base_url/kind/models on existing
// rows but deliberately leaves enabled / selected_model / is_primary alone
// so user state survives a restart. Custom (is_custom=1) rows are untouched.
function syncProvidersFromRegistry() {
  const stmt = getDb().prepare(`
    INSERT INTO model_config (id, name, base_url, kind, enabled, models_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_url = excluded.base_url,
      kind = excluded.kind,
      models_json = excluded.models_json
    WHERE model_config.is_custom = 0
  `);
  for (const p of CURATED_PROVIDERS) {
    stmt.run(
      p.id,
      p.name,
      p.baseUrl,
      p.kind,
      p.defaultEnabled ? 1 : 0,
      JSON.stringify(p.defaultModels),
    );
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
  list: () => getDb().prepare('SELECT * FROM model_config ORDER BY name').all(),
  findById: (id: string) =>
    getDb().prepare('SELECT * FROM model_config WHERE id=?').get(id) as
      | { id: string; name: string; base_url: string; enabled: number; models_json: string; selected_model: string | null; kind: string; is_custom: number; is_primary: number }
      | undefined,
  findPrimary: () =>
    getDb().prepare('SELECT * FROM model_config WHERE is_primary=1 LIMIT 1').get() as
      | { id: string; name: string; base_url: string; selected_model: string | null; kind: string; models_json: string }
      | undefined,
  setEnabled: (id: string, enabled: number) =>
    getDb().prepare('UPDATE model_config SET enabled=? WHERE id=?').run(enabled, id),
  setModels: (id: string, modelsJson: string) =>
    getDb().prepare('UPDATE model_config SET models_json=? WHERE id=?').run(modelsJson, id),
  setSelectedModel: (id: string, selectedModel: string | null) =>
    getDb().prepare('UPDATE model_config SET selected_model=? WHERE id=?').run(selectedModel, id),
  setPrimary: (id: string) => {
    const tx = getDb().transaction((targetId: string) => {
      getDb().prepare('UPDATE model_config SET is_primary=0').run();
      getDb().prepare('UPDATE model_config SET is_primary=1 WHERE id=?').run(targetId);
    });
    tx(id);
  },
  addCustom: (id: string, name: string, baseUrl: string, kind: ProviderKind, modelsJson: string) =>
    getDb().prepare(`
      INSERT INTO model_config (id, name, base_url, kind, enabled, models_json, is_custom)
      VALUES (?, ?, ?, ?, 0, ?, 1)
    `).run(id, name, baseUrl, kind, modelsJson),
  removeCustom: (id: string) =>
    getDb().prepare('DELETE FROM model_config WHERE id=? AND is_custom=1').run(id),
};

export interface AgentCallRecord {
  runId: string;
  agentId: string;
  providerId: string;
  model: string;
  kind?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  startedAt: number;
  completedAt: number;
  error?: string | null;
}

export const agentCalls = {
  record: (row: AgentCallRecord) => {
    const tx = getDb().transaction((r: AgentCallRecord) => {
      getDb().prepare(`
        INSERT INTO agent_calls
        (run_id, agent_id, provider_id, model, kind, prompt_tokens, completion_tokens, cost_usd, duration_ms, started_at, completed_at, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        r.runId, r.agentId, r.providerId, r.model, r.kind ?? 'text',
        r.promptTokens, r.completionTokens, r.costUsd, r.durationMs,
        r.startedAt, r.completedAt, r.error ?? null,
      );
      // Aggregate onto workflow_runs. Safe no-op if the run row doesn't exist yet.
      getDb().prepare(`
        UPDATE workflow_runs
        SET total_tokens = total_tokens + ?, total_cost_usd = total_cost_usd + ?
        WHERE id = ?
      `).run(r.promptTokens + r.completionTokens, r.costUsd, r.runId);
    });
    tx(row);
  },
  totalsForRun: (runId: string) =>
    getDb().prepare('SELECT total_tokens, total_cost_usd FROM workflow_runs WHERE id = ?').get(runId) as
      | { total_tokens: number; total_cost_usd: number }
      | undefined,
  byAgentForRun: (runId: string) =>
    getDb().prepare(`
      SELECT agent_id,
             SUM(prompt_tokens + completion_tokens) AS tokens,
             SUM(cost_usd) AS cost,
             COUNT(*) AS calls
      FROM agent_calls
      WHERE run_id = ?
      GROUP BY agent_id
      ORDER BY cost DESC
    `).all(runId),
  listByRun: (runId: string, limit = 500) =>
    getDb().prepare('SELECT * FROM agent_calls WHERE run_id = ? ORDER BY started_at LIMIT ?').all(runId, limit),
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
