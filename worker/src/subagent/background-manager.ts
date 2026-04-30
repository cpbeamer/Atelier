// BackgroundManager — formal parallel subagent execution engine.
// Manages concurrent subagent tasks with concurrency limits, depth limits,
// circuit breakers, and session parentage tracking.

import { sendAgentPrompt } from '../llm/opencodeServeClient.js';
import { callLLM, getPrimaryModelName } from '../llm/callLLM.js';
import { withJsonRetry } from '../llm/withJsonRetry.js';
import { notifyAgentStart, notifyAgentComplete } from '../activities.js';
import { useOpencode } from '../llm/featureFlags.js';
import { contextBroker } from './context-broker.js';

export class CircuitBreakerError extends Error {
  name = 'CircuitBreakerError';
  constructor(message: string) {
    super(message);
  }
}

export interface SubagentTask {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  personaKey: string;
  sessionId?: string;
  parentSessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface BackgroundManagerConfig {
  maxConcurrency: number;
  maxDepth: number;
  defaultTimeoutMs: number;
  enableCircuitBreaker: boolean;
}

interface ConcurrencyLimit {
  key: string;
  maxConcurrent: number;
  currentCount: number;
  queue: Array<() => void>;
}

export class BackgroundManager {
  private static _instance: BackgroundManager | null = null;

  private tasks = new Map<string, SubagentTask>();
  private tasksByParent = new Map<string, Set<string>>();
  private concurrencyLimits = new Map<string, ConcurrencyLimit>();
  private circuitBreakerState = new Map<string, { count: number; windowStart: number }>();

  private maxConcurrency: number;
  private maxDepth: number;
  private defaultTimeoutMs: number;
  private enableCircuitBreaker: boolean;
  private circuitThreshold = 20;
  private circuitWindowMs = 10_000;

  constructor(config: Partial<BackgroundManagerConfig> = {}) {
    this.maxConcurrency = config.maxConcurrency ?? 5;
    this.maxDepth = config.maxDepth ?? 3;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 10 * 60 * 1000;
    this.enableCircuitBreaker = config.enableCircuitBreaker ?? true;
  }

  static getInstance(): BackgroundManager {
    if (!BackgroundManager._instance) {
      BackgroundManager._instance = new BackgroundManager();
    }
    return BackgroundManager._instance;
  }

  async launch(
    prompt: string,
    personaKey: string,
    agentId: string,
    agentName: string,
    parentSessionId?: string,
    options: { timeoutMs?: number; model?: string; cwd?: string; runId?: string; category?: string; includeRunContext?: boolean } = {},
  ): Promise<string> {
    const taskId = `atelier-sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    if (this.enableCircuitBreaker && parentSessionId) {
      this.checkCircuitBreaker(parentSessionId);
    }

    const depth = this.getTaskDepth(parentSessionId);
    if (depth >= this.maxDepth) {
      throw new CircuitBreakerError(
        `Max subagent depth (${this.maxDepth}) exceeded for session ${parentSessionId}`,
      );
    }

    const task: SubagentTask = {
      id: taskId,
      agentId,
      agentName,
      prompt,
      personaKey,
      sessionId: taskId,
      parentSessionId,
      status: 'pending',
    };

    this.tasks.set(taskId, task);
    if (parentSessionId) {
      const children = this.tasksByParent.get(parentSessionId) ?? new Set();
      children.add(taskId);
      this.tasksByParent.set(parentSessionId, children);
    }

    this.launchAsync(task, options);
    return taskId;
  }

  async launchParallel(
    tasks: Array<{
      prompt: string;
      personaKey: string;
      agentId: string;
      agentName: string;
      parentSessionId?: string;
    }>,
    options: { timeoutMs?: number; model?: string; cwd?: string; runId?: string; category?: string; includeRunContext?: boolean } = {},
  ): Promise<SubagentTask[]> {
    const taskIds = await Promise.all(
      tasks.map((t) =>
        this.launch(t.prompt, t.personaKey, t.agentId, t.agentName, t.parentSessionId, options),
      ),
    );
    return taskIds.map((id) => this.tasks.get(id)!).filter(Boolean);
  }

  private async launchAsync(
    task: SubagentTask,
    options: { timeoutMs?: number; model?: string; cwd?: string; runId?: string; category?: string; includeRunContext?: boolean },
  ): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();

    await notifyAgentStart({
      agentId: task.agentId,
      agentName: task.agentName,
      terminalType: 'direct-llm',
      runId: options.runId,
    });

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const timeout = setTimeout(() => {
      task.status = 'failed';
      task.error = `Task timed out after ${timeoutMs}ms`;
      task.completedAt = Date.now();
    }, timeoutMs);

    try {
      const persona = await this.loadPersona(task.personaKey);
      const sharedContext = options.includeRunContext === false
        ? ''
        : await contextBroker.formatForPrompt(options.runId);
      const prompt = `${task.prompt}${sharedContext}`;
      let result: string;

      if (await useOpencode()) {
        result = await sendAgentPrompt({
          runId: options.runId ?? '',
          personaKey: task.agentId,
          personaText: persona,
          userPrompt: prompt,
          model: options.model,
        });
      } else {
        result = await callLLM(persona, prompt, {
          cwd: options.cwd,
          agentId: task.agentId,
          runId: options.runId,
        });
      }

      clearTimeout(timeout);
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
    } catch (err) {
      clearTimeout(timeout);
      task.status = 'failed';
      task.error = String(err);
      task.completedAt = Date.now();
    }

    await contextBroker.recordAgentResult(options.runId, {
      agentId: task.agentId,
      agentName: task.agentName,
      category: options.category,
      output: task.result,
      error: task.error,
    });

    await notifyAgentComplete({
      agentId: task.agentId,
      status: task.status === 'completed' ? 'completed' : 'error',
      output: task.status === 'completed'
        ? (task.result?.slice(0, 500) ?? '')
        : (task.error?.slice(0, 500) ?? ''),
      runId: options.runId,
    });
  }

  private async loadPersona(personaKey: string): Promise<string> {
    const { loadPersona } = await import('../personaLoader.js');
    return loadPersona(process.cwd(), personaKey);
  }

  private checkCircuitBreaker(sessionId: string): void {
    const now = Date.now();
    const state = this.circuitBreakerState.get(sessionId);

    if (!state || now - state.windowStart > this.circuitWindowMs) {
      this.circuitBreakerState.set(sessionId, { count: 1, windowStart: now });
      return;
    }

    state.count++;
    if (state.count > this.circuitThreshold) {
      throw new CircuitBreakerError(
        `Circuit breaker opened: ${state.count} tasks spawned in ${this.circuitWindowMs}ms window for session ${sessionId}`,
      );
    }
  }

  private getTaskDepth(parentSessionId?: string): number {
    if (!parentSessionId) return 0;
    let depth = 0;
    let current = parentSessionId;
    while (current) {
      const task = this.tasks.get(current);
      if (!task?.parentSessionId) break;
      current = task.parentSessionId;
      depth++;
    }
    return depth;
  }

  trackTask(taskId: string): SubagentTask | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTasks(parentSessionId?: string): SubagentTask[] {
    if (parentSessionId) {
      const childIds = this.tasksByParent.get(parentSessionId) ?? new Set();
      return Array.from(childIds)
        .map((id) => this.tasks.get(id))
        .filter((t): t is SubagentTask => t !== undefined && t.status === 'running');
    }
    return Array.from(this.tasks.values()).filter((t) => t.status === 'running');
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.status = 'failed';
      task.error = 'Cancelled by BackgroundManager';
      task.completedAt = Date.now();
    }
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'failed';
        task.error = 'Cancelled by BackgroundManager';
        task.completedAt = Date.now();
      }
    }
  }

  reserveSubagentSpawn(depth: number): boolean {
    return depth < this.maxDepth;
  }
}
