import { test, expect, beforeEach } from 'bun:test';
import { runRegistry } from '../../src/opencode/run-registry.js';

beforeEach(() => runRegistry.clearAll());

test('register / get / unregister', () => {
  runRegistry.register('run-1', { worktreePath: '/wt/1', port: 4096, password: 'pw', pid: 123 });
  expect(runRegistry.get('run-1')?.port).toBe(4096);
  expect(runRegistry.get('run-1')?.sessions.size).toBe(0);
  runRegistry.unregister('run-1');
  expect(runRegistry.get('run-1')).toBeNull();
});

test('attachSession stores per-persona sessionId', () => {
  runRegistry.register('run-1', { worktreePath: '/wt/1', port: 4096, password: 'pw', pid: 123 });
  runRegistry.attachSession('run-1', 'researcher', 'sess-abc');
  expect(runRegistry.get('run-1')?.sessions.get('researcher')).toBe('sess-abc');
});

test('clearAll wipes everything', () => {
  runRegistry.register('a', { worktreePath: '/a', port: 1, password: 'p', pid: 1 });
  runRegistry.register('b', { worktreePath: '/b', port: 2, password: 'p', pid: 2 });
  runRegistry.clearAll();
  expect(runRegistry.get('a')).toBeNull();
  expect(runRegistry.get('b')).toBeNull();
});
