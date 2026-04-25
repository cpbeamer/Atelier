// Minimal Bun global shim. Covers the runtime APIs we use from .ts files.
// A fuller typing would come from @types/bun — this is sufficient for `tsc --noEmit`.
declare global {
  const Bun: {
    spawn(cmd: string[], opts?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdout?: 'pipe' | 'inherit' | 'ignore';
      stderr?: 'pipe' | 'inherit' | 'ignore';
      stdin?: 'pipe' | 'inherit' | 'ignore';
    }): {
      stdout: ReadableStream<Uint8Array>;
      stderr: ReadableStream<Uint8Array>;
      stdin?: WritableStream<Uint8Array>;
      exited: Promise<number>;
      kill(signal?: number | string): void;
    };
    file(path: string): {
      text(): Promise<string>;
      json<T = unknown>(): Promise<T>;
      arrayBuffer(): Promise<ArrayBuffer>;
      exists(): Promise<boolean>;
    };
    write(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number>;
    env: Record<string, string | undefined>;
  };
}

declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T = any>(actual: T): {
    toBe(expected: T): void;
    toEqual(expected: any): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toBeNull(): void;
    toContain(expected: any): void;
    toThrow(message?: string | RegExp): void;
    toHaveBeenCalledTimes(n: number): void;
    not: ReturnType<typeof expect<T>>;
    rejects: { toThrow(message?: string | RegExp): Promise<void> };
    resolves: ReturnType<typeof expect<T>>;
  };
  export function mock<F extends (...args: any[]) => any>(fn: F): F & { mock: { calls: any[][] } };
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

export {};
