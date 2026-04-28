import { test, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startOpencodeServer, stopOpencodeServer, getOpencodeServer } from '../../src/opencode/lifecycle.js';
import { bootstrapWorktree } from '../../src/opencode/bootstrap.js';
import { ALL_PERSONAS } from '../../src/opencode/personas.js';
import { runRegistry } from '../../src/opencode/run-registry.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-lifecycle-'));

afterAll(async () => {
  for (const id of ['run-life-1']) {
    try { await stopOpencodeServer(id); } catch {}
  }
  runRegistry.clearAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('startOpencodeServer spawns serve and exposes a healthy port', async () => {
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt, { recursive: true });
  const personasSrc = path.join(tmp, 'personas');
  fs.mkdirSync(personasSrc, { recursive: true });
  for (const p of ALL_PERSONAS) fs.writeFileSync(path.join(personasSrc, `${p}.md`), `# ${p}\n`);
  await bootstrapWorktree({ worktreePath: wt, miniMaxApiKey: 'unused', personasSourceDir: personasSrc });

  const { port, password } = await startOpencodeServer('run-life-1', wt);
  expect(port).toBeGreaterThan(0);
  expect(password.length).toBeGreaterThanOrEqual(32);

  // opencode serve uses Basic auth: username "opencode", password = OPENCODE_SERVER_PASSWORD
  const authHeader = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  const res = await fetch(`http://127.0.0.1:${port}/app`, {
    headers: { Authorization: authHeader },
  });
  expect(res.status).toBe(200);
}, 30_000);

test('getOpencodeServer returns the registered entry', () => {
  const entry = getOpencodeServer('run-life-1');
  expect(entry).not.toBeNull();
  expect(entry!.port).toBeGreaterThan(0);
});

test('stopOpencodeServer kills the process and clears the registry', async () => {
  const before = getOpencodeServer('run-life-1')!;
  await stopOpencodeServer('run-life-1');
  expect(getOpencodeServer('run-life-1')).toBeNull();
  // The serve process should refuse new connections within ~1s
  await new Promise(r => setTimeout(r, 1000));
  let stillUp = false;
  try {
    const authHeader = 'Basic ' + Buffer.from('opencode:' + before.password).toString('base64');
    const res = await fetch(`http://127.0.0.1:${before.port}/app`, {
      headers: { Authorization: authHeader },
    });
    stillUp = res.ok;
  } catch { /* expected: connection refused */ }
  expect(stillUp).toBe(false);
}, 15_000);
