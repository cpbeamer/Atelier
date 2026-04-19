import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import { ptyManager } from './pty-manager.js';
import { startSidecar } from './sidecar-lifecycle.js';
import { milestones } from './db.js';
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

// Broadcast to all connected WebSocket clients
function broadcastToUI(type: string, payload: any) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  });
}

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

// HTTP server for worker communication
const httpServer = http.createServer(async (req, res) => {
  // Set CORS headers for worker
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:3001');

  // POST /api/milestone/create - create milestone and return id immediately
  if (req.method === 'POST' && url.pathname === '/api/milestone/create') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { runId, name, payload } = JSON.parse(body);
        const id = crypto.randomUUID();
        const payloadJson = JSON.stringify(payload);
        const now = Date.now();

        milestones.insert(id, runId, name, 'pending', payloadJson, now);

        // Broadcast milestone:pending to all connected UI clients
        broadcastToUI('milestone:pending', { id, name, payload });

        // Auto-timeout after 7 days
        setTimeout(() => {
          try {
            const m = milestones.findById(id);
            if (m && m.status === 'pending') {
              milestones.updateDecision(id, 'timed-out', Date.now(), 'auto-timeout', '7-day timeout');
            }
          } catch (err) {
            console.error(`Failed to timeout milestone ${id}: ${err}`);
          }
        }, 7 * 24 * 60 * 60 * 1000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // GET /api/milestone/:id - get milestone status
  if (req.method === 'GET' && url.pathname.startsWith('/api/milestone/')) {
    const id = url.pathname.split('/').pop();
    try {
      const milestone = milestones.findById(id) as any;
      if (!milestone) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Milestone not found' }));
        return;
      }

      const resolved = milestone.status !== 'pending';
      const response: any = {
        id: milestone.id,
        status: milestone.status,
        resolved,
        name: milestone.type,
        payload: milestone.payload_json ? JSON.parse(milestone.payload_json) : null,
      };

      if (resolved) {
        response.decision = {
          verdict: milestone.status === 'timed-out' ? 'Rejected' : milestone.status.charAt(0).toUpperCase() + milestone.status.slice(1),
          reason: milestone.decision_reason,
          decidedBy: milestone.decided_by,
        };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Default: 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(3001, () => {
  console.log(`Milestone HTTP API running on http://localhost:3001`);
});

// Start Temporal sidecar
startSidecar().catch(console.error);

process.on('SIGINT', () => {
  temporalProcess.kill();
  process.exit();
});
