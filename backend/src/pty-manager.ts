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

class PtyManager {
  private instances = new Map<string, PtyInstance>();
  private emitter = new EventEmitter();

  spawn(id: string, command: string, args: string[], cwd?: string): PtyInstance {
    if (this.instances.has(id)) {
      this.kill(id);
    }

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
    });

    process.onExit(({ exitCode, signal }) => {
      this.emitter.emit(`exit:${id}`, exitCode ?? 0, signal ?? 0);
      this.instances.delete(id);
    });

    return instance;
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
