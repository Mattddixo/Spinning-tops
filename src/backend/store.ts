import { randomBytes } from 'node:crypto';
import { kvs, WhereConditions } from '@forge/kvs';
import { DEFAULT_SETTINGS, type AppSettings, type GitConnection } from '../shared/types';
import { oncePerInvocation, remainingMs } from './budget';

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
export async function listByPrefix<T>(
  prefix: string,
  max = 1000,
  options: { reserveMs?: number; onStopped?: () => void } = {},
): Promise<Array<{ key: string; value: T }>> {
  const out: Array<{ key: string; value: T }> = [];
  let cursor: string | undefined;
  do {
    // With a reserve set, stop early (keeping what's been read) rather than run out of time.
    if (cursor && options.reserveMs !== undefined && remainingMs() < options.reserveMs) {
      options.onStopped?.();
      break;
    }
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

const migrateConnectionsOnce = () => oncePerInvocation('migrate-connections', migrateLegacyConnections);

export async function getConnections(): Promise<GitConnection[]> {
  await migrateConnectionsOnce();
  const entries = await listByPrefix<GitConnection>(KEYS.connectionPrefix);
  return entries.map((e) => e.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}

// IDs come from macro settings, which page editors control, so check the shape
// before using one in a storage key.
export const isConnectionId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);

export async function getConnection(id: string): Promise<GitConnection | undefined> {
  if (!isConnectionId(id)) return undefined;
  await migrateConnectionsOnce();
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

// Per-repository generation, changed by Git webhooks so cached specs from that
// repo are ignored right away. A random value rather than a counter, so two
// pushes handled at once can't both write the same "next" number. ALL_REPOS
// is used when a webhook doesn't say which repo changed.
export const ALL_REPOS = '*';
const repoGenerationKey = (connectionId: string, repo: string) =>
  `repo-generation:${connectionId}:${repo.toLowerCase().replace(/[^a-z0-9._:\s#*-]/g, '_')}`;

/** Part of the cache key for a Git spec; changes whenever a webhook reports a push. */
export async function getRepoGeneration(connectionId: string, repo: string): Promise<string> {
  const [all, one] = await Promise.all([kvs.get<string | number>(repoGenerationKey(connectionId, ALL_REPOS)), kvs.get<string | number>(repoGenerationKey(connectionId, repo))]);
  return `${all ?? 0}.${one ?? 0}`;
}

export async function bumpRepoGeneration(connectionId: string, repo: string): Promise<void> {
  await kvs.set(repoGenerationKey(connectionId, repo), `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`);
}

const webhookSecretKey = (id: string) => `webhook-secret:${id}`;

export async function getWebhookSecret(id: string): Promise<string | undefined> {
  if (!isConnectionId(id)) return undefined;
  const value = await kvs.getSecret<string>(webhookSecretKey(id));
  return typeof value === 'string' && value ? value : undefined;
}

export async function setWebhookSecret(id: string, secret: string): Promise<void> {
  await kvs.setSecret(webhookSecretKey(id), secret);
}

export async function deleteWebhookSecret(id: string): Promise<void> {
  await kvs.deleteSecret(webhookSecretKey(id));
}
