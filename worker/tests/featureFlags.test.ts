import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { useOpencode } from '../src/llm/featureFlags';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = process.env.ATELIER_USE_OPENCODE;

beforeEach(() => {
  delete process.env.ATELIER_USE_OPENCODE;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENV !== undefined) process.env.ATELIER_USE_OPENCODE = ORIGINAL_ENV;
  else delete process.env.ATELIER_USE_OPENCODE;
});

test('returns true when backend reports true', async () => {
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ useOpencode: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  expect(await useOpencode()).toBe(true);
});

test('returns false when backend reports false', async () => {
  globalThis.fetch = mock(async () => new Response(
    JSON.stringify({ useOpencode: false }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as any;
  expect(await useOpencode()).toBe(false);
});

test('falls back to env var when backend is unreachable', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  process.env.ATELIER_USE_OPENCODE = '1';
  expect(await useOpencode()).toBe(true);
});

test('returns false when both backend and env var are absent', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  expect(await useOpencode()).toBe(false);
});

test('env var "0" is treated as false', async () => {
  globalThis.fetch = mock(async () => { throw new Error('connect refused'); }) as any;
  process.env.ATELIER_USE_OPENCODE = '0';
  expect(await useOpencode()).toBe(false);
});
