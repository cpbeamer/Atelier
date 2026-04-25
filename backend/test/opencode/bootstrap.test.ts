import { test, expect, beforeEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bootstrapWorktree } from '../../src/opencode/bootstrap.js';
import { ALL_PERSONAS } from '../../src/opencode/personas.js';

let tmp: string;
let personasSrc: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-bootstrap-'));
  personasSrc = path.join(tmp, '_src_personas');
  fs.mkdirSync(personasSrc, { recursive: true });
  for (const p of ALL_PERSONAS) {
    fs.writeFileSync(path.join(personasSrc, `${p}.md`), `# ${p}\n\nbody for ${p}\n`);
  }
});

test('writes opencode.json with provider and permission blocks', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const cfg = JSON.parse(fs.readFileSync(path.join(wt, 'opencode.json'), 'utf-8'));
  expect(cfg.provider.minimax.options.apiKey).toBe('sk-test');
  expect(cfg.permission.edit).toBe('allow');
  expect(cfg.permission.bash).toBe('allow');
  expect(cfg.permission.webfetch).toBe('allow');
});

test('materializes one .opencode/agent/<persona>.md per persona with frontmatter', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  for (const p of ALL_PERSONAS) {
    const file = path.join(wt, '.opencode', 'agent', `${p}.md`);
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('description:');
    expect(content).toContain('model: minimax/abab6.5s-chat');
    expect(content).toContain(`body for ${p}`);
  }
});

test('developer agent has edit and bash; researcher does not', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const dev = fs.readFileSync(path.join(wt, '.opencode', 'agent', 'developer.md'), 'utf-8');
  expect(dev).toMatch(/edit:\s*true/);
  expect(dev).toMatch(/bash:\s*true/);
  const res = fs.readFileSync(path.join(wt, '.opencode', 'agent', 'researcher.md'), 'utf-8');
  expect(res).toMatch(/edit:\s*false/);
  expect(res).toMatch(/bash:\s*false/);
});

test('is idempotent (second call does not throw and matches first)', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const first = fs.readFileSync(path.join(wt, 'opencode.json'), 'utf-8');
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  const second = fs.readFileSync(path.join(wt, 'opencode.json'), 'utf-8');
  expect(second).toBe(first);
});

test('creates .atelier/output directory for structured agent outputs', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'sk-test', personasSourceDir: personasSrc });
  expect(fs.existsSync(path.join(wt, '.atelier', 'output'))).toBe(true);
});
