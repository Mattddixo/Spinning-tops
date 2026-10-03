import { asUser, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { randomBytes } from 'node:crypto';
import type { AuditAction, AuditEntry, AuditEntryView } from '../shared/types';
import { listByPrefix } from './store';

// Admin activity log: who changed settings, connections or approved hosts.
// Each entry is its own key, audit:<inverted time>-<random>, so entries
// written at the same moment (say, three hosts approved together) can't
// overwrite each other, and key order is newest first. Older entries beyond
// MAX_ENTRIES are pruned after each write.
const PREFIX = 'audit:';
const LEGACY_KEY = 'audit-log';
const MAX_ENTRIES = 200;
const MAX_TIME = 9_999_999_999_999;

// Entries written in the same millisecond by one invocation still sort in
// write order.
let lastKeyTime = 0;
const nextKeyTime = (now: number) => (lastKeyTime = Math.max(now, lastKeyTime + 1));

const entryKey = (at: number) => `${PREFIX}${String(MAX_TIME - at).padStart(13, '0')}-${randomBytes(4).toString('hex')}`;

// Earlier versions kept the whole log in one array. Spread it out once.
async function migrateLegacyLog(): Promise<void> {
  const legacy = await kvs.get<AuditEntry[]>(LEGACY_KEY);
  if (!legacy) return;
  for (const entry of legacy) await kvs.set(entryKey(Date.parse(entry.at) || Date.now()), entry);
  await kvs.delete(LEGACY_KEY);
}

async function readLog(): Promise<Array<{ key: string; value: AuditEntry }>> {
  await migrateLegacyLog();
  const entries = await listByPrefix<AuditEntry>(PREFIX, MAX_ENTRIES + 100);
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export async function recordAudit(accountId: string | undefined, action: AuditAction, target?: string, changes?: string[]): Promise<void> {
  if (!accountId) return;
  try {
    const now = Date.now();
    const entry: AuditEntry = { at: new Date(now).toISOString(), accountId, action };
    if (target) entry.target = target.slice(0, 200);
    if (changes?.length) entry.changes = changes.slice(0, 20);
    await kvs.set(entryKey(nextKeyTime(now)), entry);
    const log = await readLog();
    await Promise.all(log.slice(MAX_ENTRIES).map(({ key }) => kvs.delete(key)));
  } catch (err) {
    // Never block an admin change because logging failed.
    console.warn(`[audit] write failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

export async function listAudit(): Promise<AuditEntryView[]> {
  const log = (await readLog()).slice(0, MAX_ENTRIES).map((e) => e.value);
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
