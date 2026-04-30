import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
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

// ── sendAgentPrompt tests ─────────────────────────────────────────────────────

import { sendAgentPrompt } from '../src/llm/opencodeServeClient';

test('sendAgentPrompt prepends ANALYSIS MODE and persona text', async () => {
  let capturedPrompt = '';
  globalThis.fetch = mock(async (urlOrReq: any, init: any) => {
    // The opencode SDK passes a Request object; direct fetch() calls pass a string URL.
    const isRequest = typeof urlOrReq === 'object' && urlOrReq instanceof Request;
    const u = isRequest ? urlOrReq.url : String(urlOrReq);
    if (u.includes('/api/opencode/run/run-1') && !u.includes('/session/')) {
      return new Response(JSON.stringify({
        runId: 'run-1', worktreePath: '/tmp/wt', port: 9999, password: 'pw',
      }), { status: 200 });
    }
    if (u.includes('/session/researcher')) {
      return new Response(JSON.stringify({ sessionId: 'sess-1' }), { status: 200 });
    }
    if (u.includes('/session/sess-1')) {
      const rawBody = isRequest ? await urlOrReq.text() : (init as any).body;
      const body = JSON.parse(rawBody);
      capturedPrompt = body.parts[0].text;
      return new Response(JSON.stringify({
        info: { tokens: { input: 10, output: 5 }, cost: 0.001 },
        parts: [{ type: 'text', text: '{"gaps":[]}' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  const text = await sendAgentPrompt({
    runId: 'run-1',
    personaKey: 'researcher',
    personaText: 'You are a researcher.',
    userPrompt: 'Find gaps.',
  });

  expect(text).toBe('{"gaps":[]}');
  expect(capturedPrompt).toContain('ANALYSIS MODE');
  expect(capturedPrompt).toContain('You are a researcher.');
  expect(capturedPrompt).toContain('Find gaps.');
  expect(capturedPrompt).toContain('valid JSON');
});

test('sendAgentPrompt throws when server is not running', async () => {
  globalThis.fetch = mock(async () => new Response('{}', { status: 404 })) as any;
  await expect(
    sendAgentPrompt({ runId: 'no-server', personaKey: 'analyst', personaText: '', userPrompt: 'x' }),
  ).rejects.toThrow(/HTTP 404/);
});

// ── parseModelRef tests ────────────────────────────────────────────────────────

import { parseModelRef } from '../src/llm/opencodeServeClient';

describe('parseModelRef', () => {
  test('parses valid "provider/model" string', () => {
    const result = parseModelRef('primary/MiniMax-M2.7');
    expect(result).toEqual({ providerID: 'primary', modelID: 'MiniMax-M2.7' });
  });

  test('parses "primary/default"', () => {
    const result = parseModelRef('primary/default');
    expect(result).toEqual({ providerID: 'primary', modelID: 'default' });
  });

  test('returns null for undefined input', () => {
    expect(parseModelRef(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseModelRef('')).toBeNull();
  });

  test('returns null when there is no slash', () => {
    expect(parseModelRef('primaryMiniMax-M2.7')).toBeNull();
  });

  test('returns null when slash is at the start', () => {
    expect(parseModelRef('/MiniMax-M2.7')).toBeNull();
  });

  test('returns null when slash is at the end', () => {
    expect(parseModelRef('primary/')).toBeNull();
  });

  test('handles provider names with hyphens', () => {
    const result = parseModelRef('openai/gpt-4o-mini');
    expect(result).toEqual({ providerID: 'openai', modelID: 'gpt-4o-mini' });
  });

  test('handles slash-separated provider like openrouter', () => {
    const result = parseModelRef('anthropic/claude-opus-4-7');
    expect(result).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4-7' });
  });
});