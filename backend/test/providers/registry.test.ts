import { describe, test, expect } from 'bun:test';
import { CURATED_PROVIDERS } from '../../src/providers/registry';

describe('CURATED_PROVIDERS', () => {
  test('has minimax provider with correct defaults', () => {
    const minimax = CURATED_PROVIDERS.find((p) => p.id === 'minimax');
    expect(minimax).toBeDefined();
    expect(minimax!.name).toBe('MiniMax');
    expect(minimax!.kind).toBe('minimax');
    expect(minimax!.baseUrl).toBe('https://api.minimax.io/v1');
    expect(minimax!.defaultModels).toContain('MiniMax-M2.7');
    expect(minimax!.defaultEnabled).toBe(true);
  });

  test('has anthropic provider', () => {
    const anthropic = CURATED_PROVIDERS.find((p) => p.id === 'anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.kind).toBe('anthropic');
    expect(anthropic!.baseUrl).toBe('https://api.anthropic.com/v1');
  });

  test('has openai provider', () => {
    const openai = CURATED_PROVIDERS.find((p) => p.id === 'openai');
    expect(openai).toBeDefined();
    expect(openai!.kind).toBe('openai-compatible');
    expect(openai!.defaultModels).toContain('gpt-4o');
  });

  test('all providers have non-empty id, name, baseUrl, kind, defaultModels', () => {
    for (const p of CURATED_PROVIDERS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.baseUrl.length).toBeGreaterThan(0);
      expect(p.kind.length).toBeGreaterThan(0);
      expect(p.defaultModels.length).toBeGreaterThan(0);
    }
  });

  test('all provider ids are unique', () => {
    const ids = CURATED_PROVIDERS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('openai-compatible providers have https baseUrls', () => {
    const oaiCompatible = CURATED_PROVIDERS.filter((p) => p.kind === 'openai-compatible');
    for (const p of oaiCompatible) {
      expect(p.baseUrl).toStartWith('https://');
    }
  });

  test('all providers use https baseUrls', () => {
    for (const p of CURATED_PROVIDERS) {
      expect(p.baseUrl).toStartWith('https://');
    }
  });

  test('provider kinds are all recognized values', () => {
    const validKinds = ['openai-compatible', 'anthropic', 'minimax'];
    for (const p of CURATED_PROVIDERS) {
      expect(validKinds).toContain(p.kind);
    }
  });
});