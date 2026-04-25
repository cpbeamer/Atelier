import { test, expect, beforeEach, mock } from 'bun:test';
import { ensureSession } from '../../src/opencode/sessions.js';
import { runRegistry } from '../../src/opencode/run-registry.js';

beforeEach(() => {
  runRegistry.clearAll();
  runRegistry.register('run-s', { worktreePath: '/wt', port: 4096, password: 'pw', pid: 1 });
});

test('ensureSession creates a session on first call and caches the id', async () => {
  let calls = 0;
  const fetchMock = mock(async (_url: string, _init?: RequestInit) => {
    calls++;
    return new Response(JSON.stringify({ id: 'sess-123' }), { status: 200 });
  });
  // @ts-ignore — replace global fetch for this test
  globalThis.fetch = fetchMock;

  const a = await ensureSession('run-s', 'researcher');
  const b = await ensureSession('run-s', 'researcher');
  expect(a.sessionId).toBe('sess-123');
  expect(b.sessionId).toBe('sess-123');
  expect(calls).toBe(1);
});

test('ensureSession throws if no run is registered', async () => {
  await expect(ensureSession('does-not-exist', 'researcher')).rejects.toThrow(/No run registered/);
});

test('ensureSession passes Basic auth and the persona as agent', async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  // @ts-ignore
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ id: 'sess-x' }), { status: 200 });
  });

  await ensureSession('run-s', 'developer');
  expect(captured!.url).toBe('http://127.0.0.1:4096/session');
  // Basic auth: base64("opencode:pw") = "b3BlbmNvZGU6cHc="
  expect((captured!.init!.headers as any).Authorization).toBe(`Basic ${btoa('opencode:pw')}`);
  const body = JSON.parse(captured!.init!.body as string);
  expect(body.title).toBe('developer');
  expect(body.agentName).toBe('developer');
});
