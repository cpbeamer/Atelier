import { describe, test, expect } from 'bun:test';
import { withJsonRetry } from '../src/llm/withJsonRetry';

describe('withJsonRetry', () => {
  test('returns parsed value on first attempt when valid JSON', async () => {
    const result = await withJsonRetry(() => Promise.resolve('{"key":"value"}'), {});
    expect(result).toEqual({ key: 'value' });
  });

  test('returns parsed array on first attempt', async () => {
    const result = await withJsonRetry(() => Promise.resolve('["a","b"]'), {});
    expect(result).toEqual(['a', 'b']);
  });

  test('strips markdown fences and extracts JSON', async () => {
    const result = await withJsonRetry(
      () => Promise.resolve('```json\n{"ok":true}\n```'),
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  test('strips plain markdown fences', async () => {
    const result = await withJsonRetry(
      () => Promise.resolve('```\n{"ok":true}\n```'),
      {},
    );
    expect(result).toEqual({ ok: true });
  });

  test('extracts JSON object from prose', async () => {
    const result = await withJsonRetry(
      () => Promise.resolve('Here is the result: {"key":"value"} and more text'),
      {},
    );
    expect(result).toEqual({ key: 'value' });
  });

  test('extracts JSON array from prose', async () => {
    const result = await withJsonRetry(
      () => Promise.resolve('Results: [1, 2, 3] are the numbers'),
      {},
    );
    expect(result).toEqual([1, 2, 3]);
  });

  test('retries on unparseable output and succeeds second time', async () => {
    let attempts = 0;
    const result = await withJsonRetry(() => {
      attempts++;
      if (attempts === 1) return Promise.resolve('not json at all');
      return Promise.resolve('{"fixed":true}');
    }, { maxAttempts: 3 });
    expect(result).toEqual({ fixed: true });
    expect(attempts).toBe(2);
  });

  test('retries on failed validation and succeeds second time', async () => {
    let attempts = 0;
    const result = await withJsonRetry(() => {
      attempts++;
      if (attempts === 1) return Promise.resolve('{"bad":true}');
      return Promise.resolve('{"good":true}');
    }, {
      maxAttempts: 3,
      validate: (v: unknown) => (v as any).good === true,
    });
    expect(result).toEqual({ good: true });
    expect(attempts).toBe(2);
  });

  test('throws after maxAttempts when output never parseable', async () => {
    await expect(
      withJsonRetry(() => Promise.resolve('still not json'), { maxAttempts: 3 }),
    ).rejects.toThrow(/failed after 3 attempts/);
    await expect(
      withJsonRetry(() => Promise.resolve('still not json'), { maxAttempts: 3 }),
    ).rejects.toThrow(/not parseable JSON/);
  });

  test('throws after maxAttempts when validation always fails', async () => {
    await expect(
      withJsonRetry(() => Promise.resolve('{"bad":true}'), {
        maxAttempts: 2,
        validate: (v: unknown) => (v as any).good === true,
      }),
    ).rejects.toThrow(/failed after 2 attempts/);
    await expect(
      withJsonRetry(() => Promise.resolve('{"bad":true}'), {
        maxAttempts: 2,
        validate: (v: unknown) => (v as any).good === true,
      }),
    ).rejects.toThrow(/failed schema validation/);
  });

  test('default maxAttempts is 3', async () => {
    let attempts = 0;
    await expect(
      withJsonRetry(() => {
        attempts++;
        return Promise.resolve('invalid');
      }, {}),
    ).rejects.toThrow(/failed after 3 attempts/);
    expect(attempts).toBe(3);
  });

  test('appends retry reminder suffix after first failure', async () => {
    const suffixes: string[] = [];
    let callCount = 0;
    await withJsonRetry(async (suffix) => {
      callCount++;
      if (suffix) suffixes.push(suffix);
      if (callCount === 1) return 'not json at all';
      return '{"fixed":true}';
    }, { maxAttempts: 3 });
    expect(callCount).toBe(2);
    expect(suffixes.length).toBe(1);
    expect(suffixes[0]).toContain('previous response was rejected');
    expect(suffixes[0]).toContain('Return ONLY a valid JSON');
  });

  test('throws with truncated sample of last output', async () => {
    const longOutput = 'x'.repeat(1000);
    await expect(
      withJsonRetry(() => Promise.resolve(longOutput), { maxAttempts: 1 }),
    ).rejects.toThrow(/x{500}/);
  });

  test('throws with (empty) when output was empty', async () => {
    await expect(
      withJsonRetry(() => Promise.resolve(''), { maxAttempts: 1 }),
    ).rejects.toThrow(/\(empty\)/);
  });

  test('default validate always returns true (accepts any parsed JSON)', async () => {
    const result = await withJsonRetry(() => Promise.resolve('42'), {});
    expect(result).toBe(42);
  });
});