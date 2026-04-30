import { describe, expect, test } from 'bun:test';
import { applyReviewSeverityGate } from '../src/activities';

describe('applyReviewSeverityGate', () => {
  test('approves when all findings are below the rework threshold', () => {
    const result = applyReviewSeverityGate(
      [{ from: 'style', detail: 'rename local helper for clarity', severityScore: 45 }],
      [{ from: 'tests', detail: 'add optional edge-case coverage', severityScore: 70 }],
    );

    expect(result.approved).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.advisories.map((finding) => finding.detail)).toEqual([
      'rename local helper for clarity',
      'add optional edge-case coverage',
    ]);
  });

  test('returns only severity 80+ findings as developer comments', () => {
    const result = applyReviewSeverityGate(
      [
        { from: 'correctness', detail: 'primary acceptance criterion is unmet', severityScore: 90 },
        { from: 'style', detail: 'import order differs from nearby files', severityScore: 20 },
      ],
      [{ from: 'security', detail: 'minor hardening gap', severityScore: 55 }],
    );

    expect(result.approved).toBe(false);
    expect(result.blockers).toEqual([
      { from: 'correctness', detail: 'primary acceptance criterion is unmet', severityScore: 90 },
    ]);
    expect(result.advisories).toHaveLength(2);
  });
});
