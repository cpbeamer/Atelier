// backend/src/sidecar-lifecycle.ts
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const TEMPORAL_BINARY = path.join(process.env.HOME || '', '.atelier', 'temporal', 'temporal');
const DATA_DIR = path.join(process.env.HOME || '', '.atelier', 'temporal', 'data');
const HEALTH_FLAG = path.join(process.env.HOME || '', '.atelier', 'temporal', 'sidecar-healthy');

let temporalProcess: ChildProcess | null = null;
let isRunning = false;

function readHealthyFlag(): boolean {
  try {
    const stat = fs.statSync(HEALTH_FLAG);
    const age = Date.now() - stat.mtimeMs;
    return age < 60_000;
  } catch {
    return false;
  }
}

function writeHealthyFlag() {
  try { fs.writeFileSync(HEALTH_FLAG, String(Date.now())); } catch {}
}

export async function startSidecar(): Promise<void> {
  if (isRunning) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (readHealthyFlag()) {
    try {
      await healthCheck();
      isRunning = true;
      console.log('[sidecar] skipping probe — flag file indicates recently healthy');
      return;
    } catch {
      // stale or misleading — proceed with full startup
    }
  }

  temporalProcess = spawn(TEMPORAL_BINARY, [
    'server', 'start-dev',
    '--db-filename', path.join(DATA_DIR, 'atelier.db'),
    '--port', '7466',
    '--http-port', '7467',
    '--ui-port', '8466',
    '--log-level', 'warn',
  ], { stdio: 'pipe' });

  temporalProcess.stderr?.on('data', (data) => {
    console.error('[Temporal]', data.toString());
  });

  temporalProcess.on('error', (err) => {
    console.error('Temporal sidecar error:', err);
    isRunning = false;
  });

  temporalProcess.on('close', () => {
    isRunning = false;
    temporalProcess = null;
  });

  await waitForHealth();
  writeHealthyFlag();
}

export async function stopSidecar(): Promise<void> {
  if (temporalProcess) {
    temporalProcess.kill('SIGTERM');
    temporalProcess = null;
  }
  isRunning = false;
  try { fs.unlinkSync(HEALTH_FLAG); } catch {}
}

export function getSidecarStatus(): { running: boolean; port: number } {
  return { running: isRunning, port: 7466 };
}

async function waitForHealth(timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await healthCheck();
      isRunning = true;
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Temporal sidecar failed to start');
}

function healthCheck(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:7467/api/v1/namespaces', (res) => {
      if (res.statusCode === 200) resolve();
      else reject(new Error(`Health check failed: ${res.statusCode}`));
    });
    req.on('error', reject);
    req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}
