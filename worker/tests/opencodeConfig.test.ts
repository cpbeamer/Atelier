import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildOpencodeConfig,
  writeOpencodeConfig,
  writeAgentsRules,
  OPENCODE_API_KEY_ENV,
} from '../src/llm/opencodeConfig';
import type { PrimaryProvider } from '../src/llm/callLLM';

function provider(overrides: Partial<PrimaryProvider> = {}): PrimaryProvider {
  return {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    kind: 'minimax',
    selectedModel: 'MiniMax-M2.7',
    ...overrides,
  };
}

describe('buildOpencodeConfig', () => {
  test('minimax kind → @ai-sdk/openai-compatible npm', () => {
    const cfg = buildOpencodeConfig(provider({ kind: 'minimax' }));
    expect(cfg.provider.primary.npm).toBe('@ai-sdk/openai-compatible');
  });

  test('openai-compatible kind → @ai-sdk/openai-compatible npm', () => {
    const cfg = buildOpencodeConfig(provider({ kind: 'openai-compatible' }));
    expect(cfg.provider.primary.npm).toBe('@ai-sdk/openai-compatible');
  });

  test('anthropic kind → @ai-sdk/anthropic npm', () => {
    const cfg = buildOpencodeConfig(provider({ kind: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com' }));
    expect(cfg.provider.primary.npm).toBe('@ai-sdk/anthropic');
  });

  test('apiKey is referenced via env-var, not embedded literally', () => {
    const cfg = buildOpencodeConfig(provider());
    expect(cfg.provider.primary.options.apiKey).toBe(`{env:${OPENCODE_API_KEY_ENV}}`);
  });

  test('baseURL flows from provider.baseUrl', () => {
    const cfg = buildOpencodeConfig(provider({ baseUrl: 'https://custom.example/v1' }));
    expect(cfg.provider.primary.options.baseURL).toBe('https://custom.example/v1');
  });

  test('models map and top-level model are keyed on selectedModel', () => {
    const cfg = buildOpencodeConfig(provider({ selectedModel: 'MiniMax-M2.7' }));
    expect(cfg.provider.primary.models['MiniMax-M2.7']).toEqual({ name: 'MiniMax-M2.7' });
    expect(cfg.model).toBe('primary/MiniMax-M2.7');
  });

  test('null selectedModel falls back to "default"', () => {
    const cfg = buildOpencodeConfig(provider({ selectedModel: null }));
    expect(cfg.provider.primary.models.default).toEqual({ name: 'default' });
    expect(cfg.model).toBe('primary/default');
  });

  test('provider name is preserved in the friendly label', () => {
    const cfg = buildOpencodeConfig(provider({ name: 'Custom Endpoint' }));
    expect(cfg.provider.primary.name).toBe('Atelier Primary (Custom Endpoint)');
  });

  test('shape matches opencode schema reference', () => {
    const cfg = buildOpencodeConfig(provider());
    expect(cfg.$schema).toBe('https://opencode.ai/config.json');
  });
});

describe('writeOpencodeConfig', () => {
  test('writes opencode.json into the worktree with the right shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-cfg-'));
    await writeOpencodeConfig(dir, provider());
    const written = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf-8'));
    expect(written.provider.primary.npm).toBe('@ai-sdk/openai-compatible');
    expect(written.model).toBe('primary/MiniMax-M2.7');
  });
});

describe('writeAgentsRules', () => {
  test('writes AGENTS.md when the worktree has none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-agents-'));
    const result = await writeAgentsRules(dir, '# developer persona\n\nbe helpful');
    expect(result.written).toBe(true);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toContain('developer persona');
  });

  test('leaves an existing AGENTS.md alone — project instructions win', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-agents-'));
    writeFileSync(join(dir, 'AGENTS.md'), '# project rules\n', 'utf-8');
    const result = await writeAgentsRules(dir, '# developer persona\n');
    expect(result.written).toBe(false);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe('# project rules\n');
  });

  test('returns written:true and the file actually exists on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-agents-'));
    const result = await writeAgentsRules(dir, 'x');
    expect(result.written).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
  });
});
