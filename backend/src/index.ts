import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import fs from 'node:fs';

const PORT = 3000;
const BINARIES_DIR = path.join(process.cwd(), '..', 'binaries');
const TEMPORAL_PATH = path.join(BINARIES_DIR, 'temporal.exe');

// Start Temporal Sidecar
function startTemporal() {
  console.log('Starting Temporal sidecar...');
  const temporal = spawn(TEMPORAL_PATH, [
    'server', 'start-dev',
    '--port', '7466',
    '--http-port', '7467',
    '--ui-port', '8466'
  ], {
    stdio: 'inherit'
  });

  temporal.on('error', (err) => {
    console.error('Failed to start Temporal:', err);
  });

  return temporal;
}

const temporalProcess = startTemporal();

// WebSocket Server for UI
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  console.log('UI connected');
  let ptyProcess: pty.IPty | null = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'spawn') {
      const { command, args, cwd } = msg.payload;
      
      if (ptyProcess) {
        ptyProcess.kill();
      }

      console.log(`Spawning PTY: ${command} ${args.join(' ')}`);
      
      ptyProcess = pty.spawn(command, args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: cwd || process.cwd(),
        env: process.env as any
      });

      ptyProcess.onData((data) => {
        ws.send(JSON.stringify({ type: 'output', payload: data }));
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        ws.send(JSON.stringify({ type: 'exit', payload: { exitCode, signal } }));
        ptyProcess = null;
      });
    } else if (msg.type === 'input') {
      if (ptyProcess) {
        ptyProcess.write(msg.payload);
      }
    } else if (msg.type === 'resize') {
      if (ptyProcess) {
        ptyProcess.resize(msg.payload.cols, msg.payload.rows);
      }
    }
  });

  ws.on('close', () => {
    console.log('UI disconnected');
    if (ptyProcess) {
      ptyProcess.kill();
    }
  });
});

console.log(`Bun Orchestrator running on ws://localhost:${PORT}`);

process.on('SIGINT', () => {
  temporalProcess.kill();
  process.exit();
});
