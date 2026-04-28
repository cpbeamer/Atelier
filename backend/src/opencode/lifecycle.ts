import { spawn, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { runRegistry, type RunEntry } from './run-registry.js';

const STARTUP_TIMEOUT_MS = 15_000;
// opencode prints: "opencode server listening on http://127.0.0.1:PORT"
const PORT_REGEX = /https?:\/\/127\.0\.0\.1:(\d+)/;
const processes = new Map<string, ChildProcess>();

export async function startOpencodeServer(
  runId: string,
  worktreePath: string,
): Promise<{ port: number; password: string }> {
  if (runRegistry.get(runId)) {
    throw new Error(`opencode server already running for ${runId}`);
  }
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(
    'opencode',
    ['serve', '--port', '0', '--hostname', '127.0.0.1'],
    {
      cwd: worktreePath,
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  processes.set(runId, child);

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('opencode serve startup timeout'));
    }, STARTUP_TIMEOUT_MS);
    let buf = '';
    const onLine = (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(PORT_REGEX);
      if (match) {
        clearTimeout(timer);
        child.stdout?.off('data', onLine);
        child.stderr?.off('data', onLine);
        resolve(parseInt(match[1], 10));
      }
    };
    child.stdout?.on('data', onLine);
    child.stderr?.on('data', onLine);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`opencode serve exited with code ${code} before startup`));
    });
  });

  await waitForHealth(port, password);
  runRegistry.register(runId, { worktreePath, port, password, pid: child.pid! });

  child.on('exit', () => {
    processes.delete(runId);
    runRegistry.unregister(runId);
  });

  return { port, password };
}

export async function stopOpencodeServer(runId: string): Promise<void> {
  const child = processes.get(runId);
  if (child) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
    processes.delete(runId);
  }
  runRegistry.unregister(runId);
}

export function getOpencodeServer(runId: string): RunEntry | null {
  return runRegistry.get(runId);
}

/**
 * opencode serve uses HTTP Basic auth: username "opencode", password = OPENCODE_SERVER_PASSWORD.
 * This differs from Bearer token auth.
 */
async function waitForHealth(port: number, password: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const authHeader = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/app`, {
        headers: { Authorization: authHeader },
      });
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('opencode serve did not become healthy in time');
}
