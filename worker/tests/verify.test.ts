import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { runVerify, detectVerifyCommands } from '../src/verify';
import { mkdtempSync, writeFileSync, mkdirSync, writeFile } from 'node:fs';
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

  test('pyproject.toml with ruff but not mypy produces only lint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.ruff]\n');
    const cmds = detectVerifyCommands(dir);
    const labels = cmds.map((c) => c.label);
    expect(labels).toContain('lint');
    expect(labels).not.toContain('typecheck');
  });
});

describe('runVerify', () => {
  const ORIGINAL_SPAWN = import.meta.require?.('node:child_process')?.spawn;

  afterEach(() => {
    // clean up any mocks
  });

  test('returns allPassed=true with empty results when no commands detected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    const result = await runVerify(dir, 5000);
    expect(result.allPassed).toBe(true);
    expect(result.results).toEqual([]);
  });

  test('runVerify returns failed result when typecheck fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'exit 1' } }));

    const result = await runVerify(dir, 5000);
    expect(result.allPassed).toBe(false);
    expect(result.results.length).toBeGreaterThan(0);
    const typecheckResult = result.results.find((r) => r.label === 'typecheck');
    expect(typecheckResult?.passed).toBe(false);
  });

  test('runVerify returns allPassed when no commands detected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    const result = await runVerify(dir, 5000);
    expect(result.allPassed).toBe(true);
    expect(result.results).toEqual([]);
  });
});