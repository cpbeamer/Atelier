import { describe, test, expect } from 'bun:test';
import { estimateCost, extractUsageFromPayload } from '../src/llm/telemetry';

describe('estimateCost', () => {
  test('MiniMax-M2.7: prompt + completion tokens at published rates', () => {
    const cost = estimateCost('minimax', 'MiniMax-M2.7', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.50, 3);
  });

  test('unknown model returns 0 (no crash)', () => {
    expect(estimateCost('openai-compatible', 'mystery-model', 100, 50)).toBe(0);
  });

  test('zero tokens returns 0', () => {
    expect(estimateCost('minimax', 'MiniMax-M2.7', 0, 0)).toBe(0);
  });

  test('anthropic Opus at 1k/1k prompt/completion', () => {
    const cost = estimateCost('anthropic', 'claude-opus-4-7', 1000, 1000);
    expect(cost).toBeCloseTo((1000 * 15 + 1000 * 75) / 1_000_000, 6);
  });
});

describe('extractUsageFromPayload', () => {
  test('minimax/openai final-chunk usage block', () => {
    const payload = { usage: { total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 } };
    expect(extractUsageFromPayload('minimax', payload)).toEqual({ promptTokens: 100, completionTokens: 50 });
  });

  test('anthropic message_start usage', () => {
    const payload = { type: 'message_start', message: { usage: { input_tokens: 42, output_tokens: 7 } } };
    expect(extractUsageFromPayload('anthropic', payload)).toEqual({ promptTokens: 42, completionTokens: 7 });
  });

  test('anthropic message_delta usage', () => {
    const payload = { type: 'message_delta', usage: { output_tokens: 42 } };
    expect(extractUsageFromPayload('anthropic', payload)).toEqual({ promptTokens: 0, completionTokens: 42 });
  });

  test('heartbeat or content-only delta returns null', () => {
    expect(extractUsageFromPayload('minimax', { choices: [{ delta: { content: 'x' } }] })).toBeNull();
    expect(extractUsageFromPayload('anthropic', { type: 'content_block_delta', delta: { text: 'x' } })).toBeNull();
  });

  test('null/undefined payload returns null', () => {
    expect(extractUsageFromPayload('minimax', null)).toBeNull();
    expect(extractUsageFromPayload('minimax', undefined)).toBeNull();
  });
});
