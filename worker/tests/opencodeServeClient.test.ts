import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { getServeRunInfo } from '../src/llm/opencodeServeClient';

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  // Reset fetch between tests; each test installs its own mock.
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('getServeRunInfo returns the parsed registry payload on 200', async () => {
  const payload = {
    runId: 'run-abc',
    worktreePath: '/tmp/worktrees/run-abc',
    port: 4567,
    password: 'secret-token',
  };
  globalThis.fetch = mock(async (url: any) => {
    expect(String(url)).toContain('/api/opencode/run/run-abc');
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  const info = await getServeRunInfo('run-abc');
  expect(info).toEqual(payload);
});

test('getServeRunInfo URL-encodes the runId', async () => {
  let observedUrl = '';
  globalThis.fetch = mock(async (url: any) => {
    observedUrl = String(url);
    return new Response(JSON.stringify({
      runId: 'run/with slashes',
      worktreePath: '/tmp/x',
      port: 1234,
      password: 'p',
    }), { status: 200 });
  }) as any;

  await getServeRunInfo('run/with slashes');
  expect(observedUrl).toContain('/api/opencode/run/run%2Fwith%20slashes');
});

test('getServeRunInfo throws on 404 with the runId in the message', async () => {
  globalThis.fetch = mock(async () => new Response('{"error":"no run"}', { status: 404 })) as any;
  await expect(getServeRunInfo('missing-run')).rejects.toThrow(/missing-run/);
  await expect(getServeRunInfo('missing-run')).rejects.toThrow(/HTTP 404/);
});

test('getServeRunInfo throws on 500', async () => {
  globalThis.fetch = mock(async () => new Response('boom', { status: 500 })) as any;
  await expect(getServeRunInfo('any')).rejects.toThrow(/HTTP 500/);
});
