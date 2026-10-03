import { AsyncLocalStorage } from 'node:async_hooks';
import { fail } from './errors';

// Forge stops an invocation after 25 s. Each resolver call gets a budget a bit
// under that, so slow Git hosts or many $ref files end with a clear error
// instead of the platform killing the function mid-way.
export const INVOCATION_BUDGET_MS = 22_000;

const storage = new AsyncLocalStorage<{ deadline: number; done: Set<string>; memo: Map<string, Promise<unknown>> }>();

export function withBudget<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ deadline: Date.now() + ms, done: new Set(), memo: new Map() }, fn);
}

/**
 * Load a value once per invocation (for example a storage read needed by many
 * checks in one call). Same scoping as oncePerInvocation: never shared
 * between calls. Outside a budget it loads every time.
 */
export function memoPerInvocation<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return load();
  let value = store.memo.get(key) as Promise<T> | undefined;
  if (!value) {
    value = load();
    store.memo.set(key, value);
    // A failed load isn't kept, so a later check in the same call can retry.
    value.catch(() => store.memo.delete(key));
  }
  return value;
}

/**
 * Run a check once per invocation. Deliberately not module-level state:
 * Forge can reuse a runtime across invocations, possibly for other sites, so
 * "already done" only holds within one call. Outside a budget it always runs.
 */
export async function oncePerInvocation(key: string, fn: () => Promise<void>): Promise<void> {
  const store = storage.getStore();
  if (store?.done.has(key)) return;
  await fn();
  store?.done.add(key);
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
