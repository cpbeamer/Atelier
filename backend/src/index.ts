import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import { ptyManager } from './pty-manager.js';
import { startSidecar } from './sidecar-lifecycle.js';
import './ipc-handlers.js';

declare global {
  var __ipcHandlers: Record<string, (opts: any) => Promise<any>> | undefined;
}

const PORT = 3000;
const TEMPORAL_PATH = path.join(process.env.HOME || '', '.atelier', 'temporal', 'temporal');

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

// PTY subscriptions: maps PTY ID to set of subscribed WebSocket clients
const ptySubscriptions = new Map<string, Set<WebSocket>>();

// Track which PTY IDs have registered handlers (to avoid duplicate registration)
const ptyHandlersRegistered = new Set<string>();

wss.on('connection', (ws) => {
  console.log('UI connected');

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'pty-subscribe') {
      const { id } = msg.payload;
      if (!ptySubscriptions.has(id)) {
        ptySubscriptions.set(id, new Set());
      }
      ptySubscriptions.get(id)!.add(ws);

      // Register PTY event handlers for this ID if not already registered
      if (!ptyHandlersRegistered.has(id)) {
        ptyManager.onData(id, (data) => {
          const subscribers = ptySubscriptions.get(id);
          if (subscribers) {
            const message = JSON.stringify({ type: 'pty-output', payload: { id, data } });
            subscribers.forEach((ws) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(message);
              }
            });
          }
        });

        ptyManager.onExit(id, (exitCode, signal) => {
          const subscribers = ptySubscriptions.get(id);
          if (subscribers) {
            const message = JSON.stringify({ type: 'pty-exit', payload: { id, exitCode, signal } });
            subscribers.forEach((ws) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(message);
              }
            });
          }
          ptySubscriptions.delete(id);
          ptyHandlersRegistered.delete(id);
        });

        ptyHandlersRegistered.add(id);
      }

      console.log(`Client subscribed to PTY: ${id}`);
    } else if (msg.type === 'pty-spawn') {
      const { id, command, args, cwd } = msg.payload;
      console.log(`Spawning PTY ${id}: ${command} ${args.join(' ')}`);
      ptyManager.spawn(id, command, args, cwd);
    } else if (msg.type === 'pty-write') {
      const { id, data } = msg.payload;
      ptyManager.write(id, data);
    } else if (msg.type === 'pty-resize') {
      const { id, cols, rows } = msg.payload;
      ptyManager.resize(id, cols, rows);
    } else {
      // Route to IPC handlers via globalThis registry
      const handlers = globalThis.__ipcHandlers;
      if (handlers && handlers[msg.type]) {
        handlers[msg.type](msg.payload).then((result: any) => {
          ws.send(JSON.stringify({ type: msg.type + ':response', id: msg.id, payload: result }));
        }).catch((err: any) => {
          ws.send(JSON.stringify({ type: msg.type + ':response', id: msg.id, error: err.message }));
        });
      }
    }
  });

  ws.on('close', () => {
    console.log('UI disconnected');
    // Remove this socket from all PTY subscriptions
    for (const [id, subscribers] of ptySubscriptions) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        ptySubscriptions.delete(id);
      }
    }
  });
});

console.log(`Bun Orchestrator running on ws://localhost:${PORT}`);

// Start Temporal sidecar
startSidecar().catch(console.error);

process.on('SIGINT', () => {
  temporalProcess.kill();
  process.exit();
});
