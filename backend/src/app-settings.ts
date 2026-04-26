// backend/src/app-settings.ts
//
// Generic global key/value settings table. String-typed by design — callers
// encode/decode richer values themselves (see `getBool` for the boolean
// convenience). Used for runtime-toggleable flags that need to persist
// across restarts but aren't scoped to a project or run.
import { getDb } from './db.js';

export const appSettings = {
  get(key: string): string | null {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    getDb()
      .prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(key, value, Date.now());
  },

  /** Convenience: parses "true" / "false" strings, returns `defaultValue`
   *  when the key is absent or the stored value is anything else. */
  getBool(key: string, defaultValue: boolean): boolean {
    const raw = this.get(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultValue;
  },
};
