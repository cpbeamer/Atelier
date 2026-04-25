import { describe, test, expect } from 'bun:test';
import { batchByDependencies, detectFileOverlap } from '../src/depGraph';

describe('batchByDependencies', () => {
  test('independent tickets with no file overlap go in one batch', () => {
    const tickets = [
      { id: 'A', dependencies: [], filesToChange: ['src/a.ts'] },
      { id: 'B', dependencies: [], filesToChange: ['src/b.ts'] },
    ];
    expect(batchByDependencies(tickets)).toEqual([['A', 'B']]);
  });

  test('linear dependency chain becomes sequential batches', () => {
    const tickets = [
      { id: 'A', dependencies: [], filesToChange: ['src/a.ts'] },
      { id: 'B', dependencies: ['A'], filesToChange: ['src/b.ts'] },
      { id: 'C', dependencies: ['B'], filesToChange: ['src/c.ts'] },
    ];
    expect(batchByDependencies(tickets)).toEqual([['A'], ['B'], ['C']]);
  });

  test('file overlap splits a batch even without explicit dependencies', () => {
    const tickets = [
      { id: 'A', dependencies: [], filesToChange: ['src/shared.ts'] },
      { id: 'B', dependencies: [], filesToChange: ['src/shared.ts'] },
    ];
    // Same-level but share a file — must serialise to avoid merge conflicts.
    expect(batchByDependencies(tickets)).toEqual([['A'], ['B']]);
  });

  test('fan-out from a common dependency produces one level of parallelism', () => {
    const tickets = [
      { id: 'A', dependencies: [], filesToChange: ['src/a.ts'] },
      { id: 'B', dependencies: ['A'], filesToChange: ['src/b.ts'] },
      { id: 'C', dependencies: ['A'], filesToChange: ['src/c.ts'] },
    ];
    const batches = batchByDependencies(tickets);
    expect(batches.length).toBe(2);
    expect(batches[0]).toEqual(['A']);
    expect(batches[1].sort()).toEqual(['B', 'C']);
  });

  test('cycle detection throws', () => {
    const tickets = [
      { id: 'A', dependencies: ['B'], filesToChange: [] },
      { id: 'B', dependencies: ['A'], filesToChange: [] },
    ];
    expect(() => batchByDependencies(tickets)).toThrow(/cycle/i);
  });

  test('empty input returns empty batches', () => {
    expect(batchByDependencies([])).toEqual([]);
  });

  test('tickets with no files can parallelise freely', () => {
    const tickets = [
      { id: 'A', dependencies: [], filesToChange: [] },
      { id: 'B', dependencies: [], filesToChange: [] },
    ];
    expect(batchByDependencies(tickets)).toEqual([['A', 'B']]);
  });

  test('diamond dependency resolves in levels', () => {
    const tickets = [
      { id: 'A', dependencies: [], filesToChange: ['src/a.ts'] },
      { id: 'B', dependencies: ['A'], filesToChange: ['src/b.ts'] },
      { id: 'C', dependencies: ['A'], filesToChange: ['src/c.ts'] },
      { id: 'D', dependencies: ['B', 'C'], filesToChange: ['src/d.ts'] },
    ];
    const batches = batchByDependencies(tickets);
    expect(batches[0]).toEqual(['A']);
    expect(batches[1].sort()).toEqual(['B', 'C']);
    expect(batches[2]).toEqual(['D']);
  });
});

describe('detectFileOverlap', () => {
  test('exact match', () => {
    expect(detectFileOverlap(['src/a.ts'], ['src/a.ts'])).toBe(true);
  });
  test('no overlap', () => {
    expect(detectFileOverlap(['src/a.ts'], ['src/b.ts'])).toBe(false);
  });
  test('empty arrays never overlap', () => {
    expect(detectFileOverlap([], ['src/a.ts'])).toBe(false);
    expect(detectFileOverlap(['src/a.ts'], [])).toBe(false);
  });
  test('partial overlap', () => {
    expect(detectFileOverlap(['a', 'b', 'c'], ['c', 'd'])).toBe(true);
  });
});
