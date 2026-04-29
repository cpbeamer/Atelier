import { test, expect } from 'bun:test';
import { AGENT_RUNTIMES, isAgentRuntimeId, runtimeFromLegacyUseOpencode } from '../src/agent-runtime.js';

test('runtime registry includes built-in adapters', () => {
  expect(AGENT_RUNTIMES.map((runtime) => runtime.id)).toEqual(['opencode', 'claude-code', 'direct-llm']);
});

test('validates runtime ids', () => {
  expect(isAgentRuntimeId('opencode')).toBe(true);
  expect(isAgentRuntimeId('claude-code')).toBe(true);
  expect(isAgentRuntimeId('direct-llm')).toBe(true);
  expect(isAgentRuntimeId('unknown')).toBe(false);
});

test('maps legacy opencode boolean setting to runtime ids', () => {
  expect(runtimeFromLegacyUseOpencode('true')).toBe('opencode');
  expect(runtimeFromLegacyUseOpencode('false')).toBe('direct-llm');
  expect(runtimeFromLegacyUseOpencode(null)).toBeNull();
});
