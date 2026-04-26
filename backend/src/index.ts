import path from 'node:path';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import { ptyManager } from './pty-manager.js';
import { agentStreamManager, type AgentEvent } from './agent-stream.js';
import { startSidecar, stopSidecar } from './sidecar-lifecycle.js';
import { milestones, modelConfig, agentCalls, type AgentCallRecord } from './db.js';
import { appSettings } from './app-settings.js';
import { loadProjectContext, saveProjectContext } from './project-context.js';
import './ipc-handlers.js';

declare global {
  var __ipcHandlers: Record<string, (opts: any) => Promise<any>> | undefined;
}

const PORT = 3000;

// WebSocket Server for UI
const wss = new WebSocketServer({ port: PORT });

// PTY subscriptions: maps PTY ID to set of subscribed WebSocket clients
const ptySubscriptions = new Map<string, Set<WebSocket>>();

// Track which PTY IDs have registered handlers (to avoid duplicate registration)
const ptyHandlersRegistered = new Set<string>();

// Structured-agent subscriptions: maps agent ID to set of subscribed WebSocket clients
const agentSubscriptions = new Map<string, Set<WebSocket>>();
const agentHandlersRegistered = new Set<string>();

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
    } else if (msg.type === 'agent-subscribe') {
      const { id } = msg.payload;
      if (!agentSubscriptions.has(id)) agentSubscriptions.set(id, new Set());
      agentSubscriptions.get(id)!.add(ws);

      // Replay any buffered scrollback first so late subscribers don't miss events.
      for (const event of agentStreamManager.getScrollback(id)) {
        ws.send(JSON.stringify({ type: 'agent-event', payload: { id, event } }));
      }

      if (!agentHandlersRegistered.has(id)) {
        agentStreamManager.onEvent(id, (event: AgentEvent) => {
          const subs = agentSubscriptions.get(id);
          if (!subs) return;
          const wire = JSON.stringify({ type: 'agent-event', payload: { id, event } });
          subs.forEach((c) => c.readyState === c.OPEN && c.send(wire));
          if (event.kind === 'exit') {
            agentHandlersRegistered.delete(id);
          }
        });
        agentHandlersRegistered.add(id);
      }
    } else if (msg.type === 'agent-start') {
      const { id, persona, task, cwd, model } = msg.payload;
      agentStreamManager
        .start({ id, persona, task, cwd, model })
        .catch((err) => {
          const subs = agentSubscriptions.get(id);
          if (subs) {
            const wire = JSON.stringify({
              type: 'agent-event',
              payload: { id, event: { kind: 'stderr', text: `start failed: ${err?.message ?? err}`, ts: Date.now() } },
            });
            subs.forEach((c) => c.readyState === c.OPEN && c.send(wire));
          }
        });
    } else if (msg.type === 'agent-kill') {
      agentStreamManager.kill(msg.payload.id);
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
          ws.send(JSON.stringify({ type: msg.type + ':response', id: msg.id, error: err?.message || String(err) }));
        });
      } else {
        ws.send(JSON.stringify({
          type: msg.type + ':response',
          id: msg.id,
          error: `No IPC handler registered for '${msg.type}'`,
        }));
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
    for (const [id, subscribers] of agentSubscriptions) {
      subscribers.delete(ws);
      if (subscribers.size === 0) agentSubscriptions.delete(id);
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

  // GET /api/settings/primaryProvider - resolve the primary provider for the worker
  if (req.method === 'GET' && url.pathname === '/api/settings/primaryProvider') {
    try {
      const row = modelConfig.findPrimary();
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No primary provider set' }));
        return;
      }
      let models: string[] = [];
      try { models = JSON.parse(row.models_json || '[]'); } catch { models = []; }
      const selectedModel = row.selected_model && models.includes(row.selected_model)
        ? row.selected_model
        : (models[0] ?? null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        kind: row.kind,
        selectedModel,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // GET /api/settings/apiKey/:providerId - get API key from keychain
  if (req.method === 'GET' && url.pathname.startsWith('/api/settings/apiKey/')) {
    const providerId = url.pathname.split('/').pop();
    try {
      const keytar = await import('keytar');
      const apiKey = await keytar.default.getPassword('Atelier', `atelier.provider.${providerId}.apiKey`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ apiKey: apiKey || null }));
    } catch (err) {
      // keytar may fail if no keyring is available (e.g., headless environment)
      console.warn('Failed to get API key from keyring:', err);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ apiKey: null }));
    }
    return;
  }

  // POST /api/pty/spawn — two payload shapes:
  //   { id, command, args, cwd?, env? }     raw spawn (opencode + future tools)
  //   { id, persona, task, cwd? }           legacy claude-CLI-via-shell
  if (req.method === 'POST' && url.pathname === '/api/pty/spawn') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.command === 'string') {
          const { id, command, args = [], cwd, env = {} } = parsed;
          ptyManager.spawn(id, command, args, cwd, env);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ spawned: true, ptyId: id }));
          return;
        }

        const { id, persona, task, cwd } = parsed;
        const personaPath = path.join(process.cwd(), 'src', '.atelier', 'agents', `${persona}.md`);
        const personaContent = fs.readFileSync(personaPath, 'utf-8');
        const fullPrompt = `${personaContent}\n\n---\n\n${task}`;

        const shell = process.platform === 'win32' ? 'wsl.exe' : '/bin/bash';
        const shellArgs = process.platform === 'win32'
          ? ['-d', 'Ubuntu', '--', 'bash', '-c', `claude --dangerously-skip-permissions -p "${fullPrompt.replace(/"/g, '\\"')}"`]
          : ['-c', `claude --dangerously-skip-permissions -p "${fullPrompt.replace(/"/g, '\\"')}"`];

        ptyManager.spawn(id, shell, shellArgs, cwd);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ spawned: true, ptyId: id }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // GET /api/agent/:agentId/status
  if (req.method === 'GET' && url.pathname.startsWith('/api/agent/') && url.pathname.endsWith('/status')) {
    const agentId = url.pathname.split('/')[2];
    const ptyRunning = ptyManager.isRunning(agentId);
    if (ptyRunning) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'running' }));
      return;
    }
    // PTY not running — may have exited (clean or crashed) or never spawned.
    const exitState = ptyManager.getExitState(agentId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (exitState) {
      res.end(JSON.stringify({
        status: exitState.exitCode === 0 ? 'completed' : 'error',
        exitCode: exitState.exitCode,
        signal: exitState.signal,
        outputTail: exitState.outputTail,
        output: exitState.outputTail,
        error: exitState.exitCode !== 0
          ? `PTY exited with code ${exitState.exitCode}${exitState.signal ? ` (signal ${exitState.signal})` : ''}`
          : undefined,
      }));
    } else {
      res.end(JSON.stringify({ status: 'completed', output: '' }));
    }
    return;
  }

  // GET /api/project/:projectSlug/context
  if (req.method === 'GET' && url.pathname.startsWith('/api/project/') && url.pathname.endsWith('/context')) {
    const projectSlug = url.pathname.split('/')[2];
    try {
      const context = loadProjectContext(path.join(process.env.HOME || '', '.atelier', 'projects', projectSlug));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(context));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // POST /api/project/:projectSlug/context
  if (req.method === 'POST' && url.pathname.startsWith('/api/project/') && url.pathname.endsWith('/context')) {
    const projectSlug = url.pathname.split('/')[2];
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const context = JSON.parse(body);
        const projectPath = path.join(process.env.HOME || '', '.atelier', 'projects', projectSlug);
        saveProjectContext(projectPath, context);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ saved: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // POST /api/agent/start
  if (req.method === 'POST' && url.pathname === '/api/agent/start') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const notification = JSON.parse(body);
        broadcastToUI('agent:started', notification);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // POST /api/agent/event  — push a synthetic agent-event (from worker activities)
  if (req.method === 'POST' && url.pathname === '/api/agent/event') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id, event } = JSON.parse(body);
        if (!id || !event || typeof event.kind !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id and event.kind required' }));
          return;
        }
        agentStreamManager.pushSynthetic(id, { ...event, ts: event.ts ?? Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // POST /api/agent/complete
  if (req.method === 'POST' && url.pathname === '/api/agent/complete') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const completion = JSON.parse(body);
        broadcastToUI('agent:completed', completion);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // POST /api/agent/call — worker reports a completed LLM call for telemetry
  if (req.method === 'POST' && url.pathname === '/api/agent/call') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const row = JSON.parse(body) as AgentCallRecord;
        if (!row.runId || !row.agentId || !row.providerId || !row.model) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'runId, agentId, providerId, model required' }));
          return;
        }
        agentCalls.record(row);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // GET /api/runs/:runId/cost — aggregate totals + per-agent breakdown
  if (req.method === 'GET' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/cost')) {
    const parts = url.pathname.split('/');
    const runId = parts[parts.length - 2];
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total: agentCalls.totalsForRun(runId) ?? { total_tokens: 0, total_cost_usd: 0 },
        byAgent: agentCalls.byAgentForRun(runId),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // GET /api/runs/:runId/calls — raw call log (audit)
  if (req.method === 'GET' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/calls')) {
    const parts = url.pathname.split('/');
    const runId = parts[parts.length - 2];
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agentCalls.listByRun(runId)));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // GET /api/settings/useOpencode — returns { useOpencode: boolean }
  if (req.method === 'GET' && url.pathname === '/api/settings/useOpencode') {
    try {
      const value = appSettings.getBool('useOpencode', false);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ useOpencode: value }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // POST /api/settings/useOpencode — body { useOpencode: boolean }
  if (req.method === 'POST' && url.pathname === '/api/settings/useOpencode') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { useOpencode?: unknown };
        if (typeof parsed.useOpencode !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'body must be { useOpencode: boolean }' }));
          return;
        }
        appSettings.set('useOpencode', parsed.useOpencode ? 'true' : 'false');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, useOpencode: parsed.useOpencode }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // Default: 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(3001, () => {
  console.log(`Milestone HTTP API running on http://localhost:3001`);
});

// Start Temporal sidecar (skip if using external server)
if (!process.env.USE_EXTERNAL_TEMPORAL) {
  startSidecar().catch(console.error);
} else {
  console.log('Using external Temporal server at', process.env.TEMPORAL_ADDRESS);
}

process.on('SIGINT', async () => {
  await stopSidecar().catch(() => {});
  process.exit();
});
