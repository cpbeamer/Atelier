export interface RunEntry {
  worktreePath: string;
  port: number;
  password: string;
  pid: number;
  sessions: Map<string, string>;
}

class RunRegistry {
  private map = new Map<string, RunEntry>();

  register(runId: string, info: Omit<RunEntry, 'sessions'>): void {
    this.map.set(runId, { ...info, sessions: new Map() });
  }

  get(runId: string): RunEntry | null {
    return this.map.get(runId) ?? null;
  }

  unregister(runId: string): void {
    this.map.delete(runId);
  }

  attachSession(runId: string, persona: string, sessionId: string): void {
    const entry = this.map.get(runId);
    if (!entry) throw new Error(`No run registered for ${runId}`);
    entry.sessions.set(persona, sessionId);
  }

  clearAll(): void {
    this.map.clear();
  }
}

export const runRegistry = new RunRegistry();
