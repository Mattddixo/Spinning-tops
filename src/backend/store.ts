import { kvs } from '@forge/kvs';
import { DEFAULT_SETTINGS, type AppSettings, type GitConnection } from '../shared/types';

/**
 * Forge KVS layout (per installation):
 *   settings              AppSettings
 *   connections           GitConnection[] (no tokens)
 *   connection-token:<id> secret, stored with kvs.setSecret (encrypted)
 *   cache-generation      number, bumped to invalidate every cached spec
 */
const KEYS = {
  settings: 'settings',
  connections: 'connections',
  token: (id: string) => `connection-token:${id}`,
  cacheGeneration: 'cache-generation',
};

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

export async function getConnections(): Promise<GitConnection[]> {
  return (await kvs.get<GitConnection[]>(KEYS.connections)) ?? [];
}

export async function getConnection(id: string): Promise<GitConnection | undefined> {
  return (await getConnections()).find((c) => c.id === id);
}

export async function saveConnections(connections: GitConnection[]): Promise<void> {
  await kvs.set(KEYS.connections, connections);
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
