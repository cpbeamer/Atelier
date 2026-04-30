import { beforeEach, expect, test } from 'bun:test';
import { initDb, getDb, runContext } from '../src/db.js';

beforeEach(() => {
  initDb(':memory:');
  getDb().exec('DELETE FROM run_context');
});

test('runContext returns an empty context for unknown runs', () => {
  expect(runContext.get('missing')).toEqual({
    facts: [],
    fileFindings: [],
    decisions: [],
    openQuestions: [],
    issues: [],
    verification: [],
    gotchas: [],
    agentSummaries: [],
  });
});

test('runContext append merges arrays without exact duplicates', () => {
  runContext.append('run-1', {
    facts: ['uses Bun', 'uses Temporal'],
    fileFindings: [{ path: 'worker/src/a.ts', summary: 'first finding', sourceAgentId: 'explorer' }],
  });
  const merged = runContext.append('run-1', {
    facts: ['uses Bun', 'has agents'],
    fileFindings: [
      { path: 'worker/src/a.ts', summary: 'first finding', sourceAgentId: 'explorer' },
      { path: 'backend/src/db.ts', summary: 'stores context', sourceAgentId: 'librarian' },
    ],
  });

  expect(merged.facts).toEqual(['uses Bun', 'uses Temporal', 'has agents']);
  expect(merged.fileFindings).toEqual([
    { path: 'worker/src/a.ts', summary: 'first finding', sourceAgentId: 'explorer' },
    { path: 'backend/src/db.ts', summary: 'stores context', sourceAgentId: 'librarian' },
  ]);
});

test('runContext reset clears existing context', () => {
  runContext.append('run-1', { facts: ['persisted'] });
  expect(runContext.get('run-1').facts).toEqual(['persisted']);
  expect(runContext.reset('run-1').facts).toEqual([]);
  expect(runContext.get('run-1').facts).toEqual([]);
});
