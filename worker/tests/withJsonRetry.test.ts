import { describe, test, expect } from 'bun:test';
import { withJsonRetry } from '../src/llm/withJsonRetry';

describe('withJsonRetry', () => {
  test('returns parsed object on first success', async () => {
    let calls = 0;
    const llm = async () => { calls++; return '{"ok": true}'; };
    const result = await withJsonRetry<{ ok: boolean }>(llm, { maxAttempts: 3 });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  test('retries on parse failure up to maxAttempts', async () => {
    let calls = 0;
    const llm = async () => {
      calls++;
      return calls < 3 ? 'not json at all' : '{"ok": true}';
    };
    const result = await withJsonRetry<{ ok: boolean }>(llm, { maxAttempts: 3 });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  test('throws after maxAttempts exhausted', async () => {
    let calls = 0;
    const llm = async () => { calls++; return 'never json'; };
    try {
      await withJsonRetry(llm, { maxAttempts: 2 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(String(e)).toContain('failed after 2 attempts');
    }
    expect(calls).toBe(2);
  });

  test('extracts JSON from prose wrapper', async () => {
    const llm = async () => 'Here is the answer: {"ok": true}\n— the model';
    const result = await withJsonRetry<{ ok: boolean }>(llm, { maxAttempts: 1 });
    expect(result).toEqual({ ok: true });
  });

  test('extracts JSON from markdown fences', async () => {
    const llm = async () => '```json\n{"ok": true}\n```';
    const result = await withJsonRetry<{ ok: boolean }>(llm, { maxAttempts: 1 });
    expect(result).toEqual({ ok: true });
  });

  test('extracts JSON array from prose', async () => {
    const llm = async () => 'Tickets: [{"id":"A"},{"id":"B"}]';
    const result = await withJsonRetry<Array<{ id: string }>>(llm, { maxAttempts: 1 });
    expect(result).toEqual([{ id: 'A' }, { id: 'B' }]);
  });

  test('validates against schema when provided', async () => {
    const llm = async () => '{"name": "x"}';
    const result = await withJsonRetry<{ name: string }>(llm, {
      maxAttempts: 2,
      validate: (v) => typeof v === 'object' && v !== null && 'name' in v,
    });
    expect(result.name).toBe('x');
  });

  test('retries when validation fails', async () => {
    let calls = 0;
    const llm = async () => { calls++; return calls === 1 ? '{"wrong": "shape"}' : '{"name": "x"}'; };
    await withJsonRetry<{ name: string }>(llm, {
      maxAttempts: 3,
      validate: (v) => typeof v === 'object' && v !== null && 'name' in (v as object),
    });
    expect(calls).toBe(2);
  });

  test('passes reprompt suffix on retries', async () => {
    const seenSuffixes: (string | undefined)[] = [];
    let calls = 0;
    const llm = async (suffix?: string) => {
      seenSuffixes.push(suffix);
      calls++;
      return calls < 3 ? 'junk' : '{"ok":1}';
    };
    await withJsonRetry(llm, { maxAttempts: 3 });
    expect(seenSuffixes[0]).toBeUndefined();
    expect(typeof seenSuffixes[1]).toBe('string');
    expect(typeof seenSuffixes[2]).toBe('string');
  });
});
