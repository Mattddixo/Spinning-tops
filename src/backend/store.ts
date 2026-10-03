import { kvs, WhereConditions } from '@forge/kvs';
import { DEFAULT_SETTINGS, type AppSettings, type GitConnection } from '../shared/types';

/**
 * Forge KVS layout (per installation):
 *   settings              AppSettings
 *   connection:<id>       GitConnection (no token). One key each, so two admins
 *                         saving different connections can't overwrite each other.
 *   connection-token:<id> secret, stored with kvs.setSecret (encrypted)
 *   cache-generation      number, bumped to invalidate every cached spec
 *   connections           legacy: all connections in one array (migrated on read)
 */
const KEYS = {
  settings: 'settings',
  connection: (id: string) => `connection:${id}`,
  connectionPrefix: 'connection:',
  legacyConnections: 'connections',
  token: (id: string) => `connection-token:${id}`,
  cacheGeneration: 'cache-generation',
};

/** Every value whose key starts with `prefix`, following query pages. */
export async function listByPrefix<T>(prefix: string, max = 1000): Promise<Array<{ key: string; value: T }>> {
  const out: Array<{ key: string; value: T }> = [];
  let cursor: string | undefined;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany<T>();
    out.push(...page.results.map((r) => ({ key: r.key, value: r.value })));
    cursor = page.nextCursor;
  } while (cursor && out.length < max);
  return out;
}

export function sanitiseSettings(input: Partial<AppSettings> | undefined): AppSettings {
  const ttl = Number(input?.cacheTtlMinutes);
  return {
    urlSourcesEnabled: input?.urlSourcesEnabled === true,
    tryItOutEnabled: input?.tryItOutEnabled === true,
    cacheTtlMinutes: Number.isFinite(ttl) ? Math.min(Math.max(Math.round(ttl), 0), 1440) : DEFAULT_SETTINGS.cacheTtlMinutes,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await kvs.get<Partial<AppSettings>>(KEYS.settings);
  return stored ? sanitiseSettings({ ...DEFAULT_SETTINGS, ...stored }) : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const clean = sanitiseSettings(settings);
  await kvs.set(KEYS.settings, clean);
  return clean;
}

// Earlier versions kept every connection in one array. Move them to their own
// keys the first time they're read; writing first means a retry is harmless.
async function migrateLegacyConnections(): Promise<void> {
  const legacy = await kvs.get<GitConnection[]>(KEYS.legacyConnections);
  if (!legacy) return;
  for (const c of legacy) if (c?.id) await kvs.set(KEYS.connection(c.id), c);
  await kvs.delete(KEYS.legacyConnections);
}

export async function getConnections(): Promise<GitConnection[]> {
  await migrateLegacyConnections();
  const entries = await listByPrefix<GitConnection>(KEYS.connectionPrefix);
  return entries.map((e) => e.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}

// IDs come from macro settings, which page editors control, so check the shape
// before using one in a storage key.
const isConnectionId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);

export async function getConnection(id: string): Promise<GitConnection | undefined> {
  if (!isConnectionId(id)) return undefined;
  await migrateLegacyConnections();
  return (await kvs.get<GitConnection>(KEYS.connection(id))) ?? undefined;
}

export async function saveConnectionRecord(connection: GitConnection): Promise<void> {
  await kvs.set(KEYS.connection(connection.id), connection);
}

export async function deleteConnectionRecord(id: string): Promise<void> {
  await kvs.delete(KEYS.connection(id));
}

export async function getToken(id: string): Promise<string | undefined> {
  const value = await kvs.getSecret<string>(KEYS.token(id));
  return typeof value === 'string' && value ? value : undefined;
}

export async function setToken(id: string, token: string): Promise<void> {
  await kvs.setSecret(KEYS.token(id), token);
}

export async function deleteToken(id: string): Promise<void> {
  await kvs.deleteSecret(KEYS.token(id));
}

export async function getCacheGeneration(): Promise<number> {
  return (await kvs.get<number>(KEYS.cacheGeneration)) ?? 0;
}

export async function bumpCacheGeneration(): Promise<number> {
  const next = (await getCacheGeneration()) + 1;
  await kvs.set(KEYS.cacheGeneration, next);
  return next;
}

// Per-repository generation, bumped by Git webhooks so cached specs from that
// repo are ignored right away.
const repoGenerationKey = (connectionId: string, repo: string) =>
  `repo-generation:${connectionId}:${repo.toLowerCase().replace(/[^a-z0-9._:\s#-]/g, '_')}`;

export async function getRepoGeneration(connectionId: string, repo: string): Promise<number> {
  return (await kvs.get<number>(repoGenerationKey(connectionId, repo))) ?? 0;
}

export async function bumpRepoGeneration(connectionId: string, repo: string): Promise<number> {
  const next = (await getRepoGeneration(connectionId, repo)) + 1;
  await kvs.set(repoGenerationKey(connectionId, repo), next);
  return next;
}
