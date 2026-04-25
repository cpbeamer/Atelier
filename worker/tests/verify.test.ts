import { describe, test, expect } from 'bun:test';
import { detectVerifyCommands } from '../src/verify';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('detectVerifyCommands', () => {
  test('package.json with typecheck script maps to bun run typecheck', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }));
    const cmds = detectVerifyCommands(dir);
    const labels = cmds.map((c) => c.label);
    expect(labels).toContain('typecheck');
    const typecheck = cmds.find((c) => c.label === 'typecheck')!;
    expect(typecheck.cmd).toBe('bun');
    expect(typecheck.args).toEqual(['run', 'typecheck']);
  });

  test('package.json with typescript devDep and tsconfig but no script: auto-runs tsc', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5' } }));
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    const cmds = detectVerifyCommands(dir);
    expect(cmds.some((c) => c.cmd === 'bunx' && c.args.includes('tsc'))).toBe(true);
  });

  test('package.json with lint script picks it up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));
    const cmds = detectVerifyCommands(dir);
    expect(cmds.some((c) => c.label === 'lint')).toBe(true);
  });

  test('no verifiable setup returns empty array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    expect(detectVerifyCommands(dir)).toEqual([]);
  });

  test('typescript devDep without tsconfig is ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { typescript: '^5' } }));
    const cmds = detectVerifyCommands(dir);
    expect(cmds.some((c) => c.label === 'typecheck')).toBe(false);
  });

  test('malformed package.json does not crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'package.json'), 'not json');
    expect(detectVerifyCommands(dir)).toEqual([]);
  });

  test('pyproject.toml with ruff + mypy produces both', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.ruff]\n[tool.mypy]\n');
    const cmds = detectVerifyCommands(dir);
    const labels = cmds.map((c) => c.label);
    expect(labels).toContain('lint');
    expect(labels).toContain('typecheck');
  });
});
