import { asUser, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import type { AuditAction, AuditEntry, AuditEntryView } from '../shared/types';

// Admin activity log: who changed settings, connections or approved hosts.
// Kept in one KVS value (newest first, last 200 entries, ~60 KB max).
const KEY = 'audit-log';
const MAX_ENTRIES = 200;

export async function recordAudit(accountId: string | undefined, action: AuditAction, target?: string, changes?: string[]): Promise<void> {
  if (!accountId) return;
  try {
    const log = (await kvs.get<AuditEntry[]>(KEY)) ?? [];
    const entry: AuditEntry = { at: new Date().toISOString(), accountId, action };
    if (target) entry.target = target.slice(0, 200);
    if (changes?.length) entry.changes = changes.slice(0, 20);
    await kvs.set(KEY, [entry, ...log].slice(0, MAX_ENTRIES));
  } catch (err) {
    // Never block an admin change because logging failed.
    console.warn(`[audit] write failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

export async function listAudit(): Promise<AuditEntryView[]> {
  const log = (await kvs.get<AuditEntry[]>(KEY)) ?? [];
  const ids = [...new Set(log.map((e) => e.accountId))].slice(0, 100);
  const names = new Map<string, string>();
  if (ids.length) {
    try {
      // GET /wiki/rest/api/user/bulk?accountId=a&accountId=b (scope read:confluence-user)
      const query = new URLSearchParams(ids.map((id) => ['accountId', id]));
      const res = await asUser().requestConfluence(route`/wiki/rest/api/user/bulk?${query}`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const body = (await res.json()) as { results?: Array<{ accountId?: string; publicName?: string; displayName?: string }> };
        for (const u of body.results ?? []) if (u.accountId) names.set(u.accountId, u.displayName || u.publicName || u.accountId);
      }
    } catch {
      // Names are a nicety; fall back to account IDs.
    }
  }
  return log.map((e) => ({ ...e, displayName: names.get(e.accountId) }));
}
