import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { getAgentRuntime, useOpencode } from '../src/llm/featureFlags';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = process.env.ATELIER_USE_OPENCODE;
const ORIGINAL_RUNTIME_ENV = process.env.ATELIER_AGENT_RUNTIME;

beforeEach(() => {
  delete process.env.ATELIER_USE_OPENCODE;
  delete process.env.ATELIER_AGENT_RUNTIME;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENV !== undefined) process.env.ATELIER_USE_OPENCODE = ORIGINAL_ENV;
  else delete process.env.ATELIER_USE_OPENCODE;
  if (ORIGINAL_RUNTIME_ENV !== undefined) process.env.ATELIER_AGENT_RUNTIME = ORIGINAL_RUNTIME_ENV;
  else delete process.env.ATELIER_AGENT_RUNTIME;
});

test('returns selected runtime from backend', async () => {
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ agentRuntime: 'claude-code' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  expect(await getAgentRuntime()).toBe('claude-code');
});

test('useOpencode returns true only for opencode runtime', async () => {
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ agentRuntime: 'opencode' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  expect(await useOpencode()).toBe(true);
});

test('falls back to env var when backend is unreachable', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  process.env.ATELIER_AGENT_RUNTIME = 'claude-code';
  expect(await getAgentRuntime()).toBe('claude-code');
});

test('legacy opencode env var still works when backend is unreachable', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  process.env.ATELIER_USE_OPENCODE = '1';
  expect(await getAgentRuntime()).toBe('opencode');
});

test('returns direct-llm when backend and env vars are absent', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  expect(await getAgentRuntime()).toBe('direct-llm');
});
