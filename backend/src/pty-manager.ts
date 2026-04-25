// backend/src/pty-manager.ts
import type { IPty } from 'node-pty';
import * as pty from 'node-pty';
import { EventEmitter } from 'events';

export interface PtyInstance {
  id: string;
  process: IPty;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyExitState {
  exitCode: number;
  signal: number;
  /** Tail of the PTY's own data stream (last N bytes). Used to surface
   *  context in the status endpoint when a crashed PTY has no other trace. */
  outputTail: string;
  exitedAt: number;
}

class PtyManager {
  private instances = new Map<string, PtyInstance>();
  /** Bounded per-id ring of recent output, flushed on exit into exitStates. */
  private recentOutput = new Map<string, string>();
  /** Retained after a PTY exits so worker pollers can see the exit reason. */
  private exitStates = new Map<string, PtyExitState>();
  private emitter = new EventEmitter();

  private static OUTPUT_TAIL_BYTES = 4000;

  spawn(id: string, command: string, args: string[], cwd?: string): PtyInstance {
    if (this.instances.has(id)) {
      this.kill(id);
    }
    // Reset any previous exit state for this id (new PTY with the same id).
    this.exitStates.delete(id);
    this.recentOutput.set(id, '');

    const process = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: process.env as Record<string, string>,
    });

    const instance: PtyInstance = {
      id,
      process,
      write: (data) => process.write(data),
      resize: (cols, rows) => process.resize(cols, rows),
      kill: () => process.kill(),
    };

    this.instances.set(id, instance);

    process.onData((data) => {
      this.emitter.emit(`data:${id}`, data);
      // Keep a sliding-window tail for exit diagnostics.
      const prev = this.recentOutput.get(id) ?? '';
      const combined = prev + data;
      const tail = combined.length > PtyManager.OUTPUT_TAIL_BYTES
        ? combined.slice(combined.length - PtyManager.OUTPUT_TAIL_BYTES)
        : combined;
      this.recentOutput.set(id, tail);
    });

    process.onExit(({ exitCode, signal }) => {
      const code = exitCode ?? 0;
      const sig = signal ?? 0;
      this.exitStates.set(id, {
        exitCode: code,
        signal: sig,
        outputTail: this.recentOutput.get(id) ?? '',
        exitedAt: Date.now(),
      });
      this.recentOutput.delete(id);
      this.emitter.emit(`exit:${id}`, code, sig);
      this.instances.delete(id);
    });

    return instance;
  }

  /** Returns the exit state for a PTY that has exited, or undefined if it
   *  is still running (or was never spawned). */
  getExitState(id: string): PtyExitState | undefined {
    return this.exitStates.get(id);
  }

  onData(id: string, handler: (data: string) => void): void {
    this.emitter.on(`data:${id}`, handler);
  }

  onExit(id: string, handler: (exitCode: number, signal: number) => void): void {
    this.emitter.on(`exit:${id}`, handler);
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`PTY ${id} not found`);
    instance.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`PTY ${id} not found`);
    instance.resize(cols, rows);
  }

  kill(id: string): void {
    const instance = this.instances.get(id);
    if (instance) {
      instance.kill();
      this.instances.delete(id);
    }
  }

  isRunning(id: string): boolean {
    return this.instances.has(id);
  }

  killAll(): void {
    for (const [id] of this.instances) {
      this.kill(id);
    }
  }
}

export const ptyManager = new PtyManager();
