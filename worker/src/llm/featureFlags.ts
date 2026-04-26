// Resolves Atelier feature flags. Backend is authoritative; env vars are a
// developer-mode fallback (lets the worker run standalone without the backend).

const BACKEND = process.env.ATELIER_BACKEND_URL || 'http://localhost:3001';

export async function useOpencode(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND}/api/settings/useOpencode`);
    if (response.ok) {
      const data = await response.json() as { useOpencode: boolean };
      return data.useOpencode === true;
    }
  } catch {
    // Backend unreachable — fall through to env var.
  }
  return process.env.ATELIER_USE_OPENCODE === '1';
}
