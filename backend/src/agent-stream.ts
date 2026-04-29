// backend/src/agent-stream.ts
//
// Spawns the `claude` CLI with --output-format stream-json --verbose and parses
// its JSON Lines output into typed events the UI can render as a custom view
// (instead of rendering raw ANSI from a PTY).
//
// Event shape is intentionally flat and renderer-friendly — the UI just maps
// over `events` in order.

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';

export type AgentEvent =
  | { kind: 'init'; sessionId: string; model: string; cwd: string; tools: string[]; ts: number }
  | { kind: 'text'; text: string; ts: number }
  | { kind: 'thinking'; text: string; ts: number }
  | { kind: 'tool_use'; toolId: string; name: string; input: unknown; ts: number }
  | { kind: 'tool_result'; toolId: string; content: string; isError: boolean; ts: number }
  | { kind: 'result'; success: boolean; turns: number; durationMs: number; costUsd?: number; text?: string; ts: number }
  | { kind: 'stderr'; text: string; ts: number }
  | { kind: 'exit'; code: number; ts: number };

interface AgentInstance {
  id: string;
  child: ChildProcess;
  events: AgentEvent[];
  done: boolean;
}

const MAX_BUFFER = 2000;

class AgentStreamManager {
  private agents = new Map<string, AgentInstance>();
  private emitter = new EventEmitter();

  async start(opts: {
    id: string;
    persona?: string;
    task: string;
    cwd?: string;
    model?: string;
  }): Promise<{ id: string }> {
    const { id, persona, task, cwd, model } = opts;

    if (this.agents.has(id)) {
      this.kill(id);
    }

    let prompt = task;
    if (persona) {
      // Resolve persona from the backend's .atelier/agents directory if present.
      const candidates = [
        path.join(process.cwd(), 'src', '.atelier', 'agents', `${persona}.md`),
        path.join(process.cwd(), '.atelier', 'agents', `${persona}.md`),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          prompt = `${fs.readFileSync(p, 'utf-8')}\n\n---\n\n${task}`;
          break;
        }
      }
    }

    const args = [
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      '-p', prompt,
    ];
    if (model) args.push('--model', model);

    const child = spawn('claude', args, {
      cwd: cwd || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const instance: AgentInstance = { id, child, events: [], done: false };
    this.agents.set(id, instance);

    const push = (event: AgentEvent) => {
      instance.events.push(event);
      if (instance.events.length > MAX_BUFFER) instance.events.shift();
      this.emitter.emit(`event:${id}`, event);
    };

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        this.parseLine(line, push);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      push({ kind: 'stderr', text: chunk.toString('utf-8'), ts: Date.now() });
    });

    child.on('exit', (code) => {
      if (stdoutBuf.trim()) this.parseLine(stdoutBuf.trim(), push);
      push({ kind: 'exit', code: code ?? 0, ts: Date.now() });
      instance.done = true;
    });

    child.on('error', (err) => {
      push({ kind: 'stderr', text: `spawn error: ${err.message}`, ts: Date.now() });
      push({ kind: 'exit', code: -1, ts: Date.now() });
      instance.done = true;
    });

    return { id };
  }

  private parseLine(line: string, push: (e: AgentEvent) => void) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      push({ kind: 'stderr', text: `unparseable line: ${line}`, ts: Date.now() });
      return;
    }

    const ts = Date.now();

    if (obj.type === 'system' && obj.subtype === 'init') {
      push({
        kind: 'init',
        sessionId: obj.session_id ?? '',
        model: obj.model ?? '',
        cwd: obj.cwd ?? '',
        tools: Array.isArray(obj.tools) ? obj.tools : [],
        ts,
      });
      return;
    }

    if (obj.type === 'assistant' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          push({ kind: 'text', text: block.text, ts });
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          push({ kind: 'thinking', text: block.thinking, ts });
        } else if (block.type === 'tool_use') {
          push({
            kind: 'tool_use',
            toolId: block.id,
            name: block.name,
            input: block.input,
            ts,
          });
        }
      }
      return;
    }

    if (obj.type === 'user' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_result') {
          const rawContent = block.content;
          const content =
            typeof rawContent === 'string'
              ? rawContent
              : Array.isArray(rawContent)
                ? rawContent.map((c: any) => (typeof c === 'string' ? c : c.text ?? JSON.stringify(c))).join('\n')
                : JSON.stringify(rawContent);
          push({
            kind: 'tool_result',
            toolId: block.tool_use_id,
            content,
            isError: !!block.is_error,
            ts,
          });
        }
      }
      return;
    }

    if (obj.type === 'result') {
      push({
        kind: 'result',
        success: !obj.is_error,
        turns: obj.num_turns ?? 0,
        durationMs: obj.duration_ms ?? 0,
        costUsd: obj.total_cost_usd,
        text: obj.result,
        ts,
      });
      return;
    }
  }

  onEvent(id: string, handler: (event: AgentEvent) => void) {
    this.emitter.on(`event:${id}`, handler);
  }

  offEvent(id: string, handler: (event: AgentEvent) => void) {
    this.emitter.off(`event:${id}`, handler);
  }

  getScrollback(id: string): AgentEvent[] {
    return this.agents.get(id)?.events ?? [];
  }

  clear(id: string) {
    const instance = this.agents.get(id);
    if (instance) {
      try { instance.child?.kill?.(); } catch {}
      this.agents.delete(id);
    }
  }

  /**
   * Push an event into the stream for an agent ID that has no spawned child —
   * used by workflow activities to surface M2.7 progress in the matching UI pane.
   */
  pushSynthetic(id: string, event: AgentEvent) {
    let instance = this.agents.get(id);
    if (!instance) {
      instance = { id, child: null as unknown as ChildProcess, events: [], done: false };
      this.agents.set(id, instance);
    }
    instance.events.push(event);
    if (instance.events.length > MAX_BUFFER) instance.events.shift();
    this.emitter.emit(`event:${id}`, event);
  }

  isRunning(id: string): boolean {
    const a = this.agents.get(id);
    return !!a && !a.done;
  }

  kill(id: string) {
    const a = this.agents.get(id);
    if (a) {
      try { a.child.kill(); } catch {}
      this.agents.delete(id);
    }
  }

  killAll() {
    for (const id of this.agents.keys()) this.kill(id);
  }
}

export const agentStreamManager = new AgentStreamManager();
