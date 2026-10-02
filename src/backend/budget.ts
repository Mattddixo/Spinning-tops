import { AsyncLocalStorage } from 'node:async_hooks';
import { fail } from './errors';

// Forge stops an invocation after 25 s. Each resolver call gets a budget a bit
// under that, so slow Git hosts or many $ref files end with a clear error
// instead of the platform killing the function mid-way.
export const INVOCATION_BUDGET_MS = 22_000;

const storage = new AsyncLocalStorage<{ deadline: number }>();

export function withBudget<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ deadline: Date.now() + ms }, fn);
}

export function remainingMs(): number {
  const store = storage.getStore();
  return store ? store.deadline - Date.now() : Number.POSITIVE_INFINITY;
}

/** Throw if the budget is spent; otherwise return a timeout no longer than what's left. */
export function timeoutWithinBudget(preferredMs: number): number {
  const left = remainingMs();
  if (left < 750) fail('UPSTREAM_ERROR', 'errors.deadline', { seconds: Math.round(INVOCATION_BUDGET_MS / 1000) });
  return Math.max(500, Math.min(preferredMs, left - 250));
}

/** Fail early when there isn't enough time left for another request. */
export function checkBudget(): void {
  timeoutWithinBudget(1);
}
