// Hook system — lifecycle callbacks that fire at key points:
// pre-tool, post-tool, agent start/complete, error recovery, context injection.
// Pattern from oh-my-opencode's 50+ hooks.

export type HookName =
  | 'preToolUse'
  | 'postToolUse'
  | 'agentStart'
  | 'agentComplete'
  | 'errorRecovery'
  | 'contextInjection'
  | 'todoContinuationEnforcer'
  | 'commentChecker'
  | 'keywordDetector'
  | 'sessionRecovery';

export interface HookContext {
  agentId: string;
  agentName: string;
  sessionId?: string;
  runId?: string;
  cwd?: string;
}

export interface HookResult {
  continue: boolean;
  modifiedOutput?: string;
  error?: string;
}

export type HookFn = (ctx: HookContext, data: HookData) => HookResult | Promise<HookResult>;

export interface HookData {
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  output?: string;
  error?: Error | string;
  agentOutput?: string;
  status?: 'completed' | 'error';
}

export interface HookRegistration {
  name: HookName;
  fn: HookFn;
  enabled: boolean;
  priority: number;
}

export class HookSystem {
  private static _instance: HookSystem | null = null;

  private hooks: Map<HookName, HookRegistration[]> = new Map();
  private ultraworkMode = false;
  private todoContinuationMode = false;
  private pendingTodos: Array<{ task: string; context: HookContext }> = [];

  private constructor() {
    this.initBuiltinHooks();
  }

  static getInstance(): HookSystem {
    if (!HookSystem._instance) {
      HookSystem._instance = new HookSystem();
    }
    return HookSystem._instance;
  }

  private initBuiltinHooks(): void {
    // Todo Continuation Enforcer — keeps agent working until task is done
    this.register({
      name: 'todoContinuationEnforcer',
      fn: async (ctx, data) => {
        if (!this.todoContinuationMode) return { continue: true };

        if (data.agentOutput) {
          // Check if agent is trying to stop without completing
          const output = String(data.agentOutput).toLowerCase();
          if (output.includes('done') || output.includes('complete') || output.includes('finished')) {
            // Check pending todos
            if (this.pendingTodos.length > 0) {
              return {
                continue: false,
                modifiedOutput: `Task incomplete. ${this.pendingTodos.length} items remaining. Continue working.`,
              };
            }
          }
        }
        return { continue: true };
      },
      enabled: false,
      priority: 10,
    });

    // Comment Checker — prevents excessive AI comments
    this.register({
      name: 'commentChecker',
      fn: async (ctx, data) => {
        if (data.toolName === 'edit' || data.toolName === 'write') {
          const content = String(data.toolArgs?.content ?? '');
          const commentLines = (content.match(/\/\/.*|\/\*[\s\S]*?\*\/|#.*/g) ?? []).length;
          const totalLines = content.split('\n').length;
          if (totalLines > 5 && commentLines / totalLines > 0.3) {
            return {
              continue: false,
              modifiedOutput: 'Too many comments. Code should be self-documenting. Remove excess comments.',
            };
          }
        }
        return { continue: true };
      },
      enabled: true,
      priority: 5,
    });

    // Keyword Detector — triggers ultrawork mode on magic keywords
    this.register({
      name: 'keywordDetector',
      fn: async (ctx, data) => {
        const content = String(data.agentOutput ?? '');
        if (content.includes('ultrawork') || content.includes('ulw') || content.includes('ultrathink')) {
          this.ultraworkMode = true;
        }
        return { continue: true };
      },
      enabled: true,
      priority: 20,
    });
  }

  register(hook: HookRegistration): void {
    const existing = this.hooks.get(hook.name) ?? [];
    existing.push(hook);
    existing.sort((a, b) => b.priority - a.priority);
    this.hooks.set(hook.name, existing);
  }

  unregister(name: HookName, fn: HookFn): void {
    const existing = this.hooks.get(name) ?? [];
    this.hooks.set(name, existing.filter(h => h.fn !== fn));
  }

  async runHooks(name: HookName, ctx: HookContext, data: HookData): Promise<HookResult> {
    const registered = this.hooks.get(name) ?? [];
    const enabled = registered.filter(h => h.enabled);

    if (enabled.length === 0) {
      return { continue: true };
    }

    let result: HookResult = { continue: true };
    for (const hook of enabled) {
      try {
        result = await hook.fn(ctx, data);
        if (!result.continue) {
          break;
        }
      } catch (e) {
        result = { continue: true, error: String(e) };
      }
    }
    return result;
  }

  // Pre-tool hook — fires before a tool is called
  async preToolUse(ctx: HookContext, toolName: string, toolArgs: Record<string, unknown>): Promise<HookResult> {
    return this.runHooks('preToolUse', ctx, { toolName, toolArgs });
  }

  // Post-tool hook — fires after a tool completes
  async postToolUse(
    ctx: HookContext,
    toolName: string,
    toolArgs: Record<string, unknown>,
    output: string,
  ): Promise<HookResult> {
    return this.runHooks('postToolUse', ctx, { toolName, toolArgs, output });
  }

  // Error recovery hook — fires when an error occurs
  async errorRecovery(ctx: HookContext, error: Error | string): Promise<HookResult> {
    return this.runHooks('errorRecovery', ctx, { error });
  }

  // Context injection hook — fires before agent runs
  async contextInjection(ctx: HookContext): Promise<{ context: string }> {
    const result = await this.runHooks('contextInjection', ctx, {});
    return { context: result.modifiedOutput ?? '' };
  }

  // Ultrawork mode — aggressive parallel execution
  enableUltraworkMode(): void {
    this.ultraworkMode = true;
    this.todoContinuationMode = true;
  }

  disableUltraworkMode(): void {
    this.ultraworkMode = false;
    this.todoContinuationMode = false;
  }

  isUltraworkMode(): boolean {
    return this.ultraworkMode;
  }

  // Todo continuation
  addPendingTodo(task: string, context: HookContext): void {
    this.pendingTodos.push({ task, context });
  }

  clearPendingTodos(): void {
    this.pendingTodos = [];
  }

  getPendingTodos(): Array<{ task: string; context: HookContext }> {
    return [...this.pendingTodos];
  }

  // Control whether hooks are active
  setHookEnabled(name: HookName, enabled: boolean): void {
    const registered = this.hooks.get(name) ?? [];
    for (const hook of registered) {
      hook.enabled = enabled;
    }
  }
}