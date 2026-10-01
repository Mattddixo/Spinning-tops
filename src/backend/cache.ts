import { createHash } from 'node:crypto';
import { kvs } from '@forge/kvs';
import type { SpecSummary } from '../shared/types';
import { getCacheGeneration } from './store';

// Cache for Git/URL specs. KVS values max out at 240 KiB so big specs get
// chunked. Expired keys can stick around ~48h, so we also check fetchedAt.
const CHUNK_SIZE = 200_000;

export interface CachedSpec {
  spec: Record<string, unknown>;
  summary: SpecSummary;
  fileCount: number;
  warnings: string[];
  fetchedAt: string;
}

interface CacheHeader {
  chunks: number;
  fetchedAt: string;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function baseKey(cacheKey: string): Promise<string> {
  return `spec-cache:${await getCacheGeneration()}:${hash(cacheKey)}`;
}

export async function readCache(cacheKey: string, ttlMinutes: number): Promise<CachedSpec | undefined> {
  if (ttlMinutes <= 0) return undefined;
  try {
    const key = await baseKey(cacheKey);
    const header = await kvs.get<CacheHeader>(key);
    if (!header || Date.now() - Date.parse(header.fetchedAt) > ttlMinutes * 60_000) return undefined;
    const result = await kvs.batchGet<string>(Array.from({ length: header.chunks }, (_, i) => ({ key: `${key}:${i}` })));
    if (result.failedKeys.length || result.successfulKeys.length !== header.chunks) return undefined;
    const byKey = new Map(result.successfulKeys.map((item) => [item.key, item.value]));
    const json = Array.from({ length: header.chunks }, (_, i) => byKey.get(`${key}:${i}`) ?? '').join('');
    const cached = JSON.parse(json) as CachedSpec;
    return cached.fetchedAt === header.fetchedAt ? cached : undefined;
  } catch (err) {
    console.warn(`[cache] read failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return undefined;
  }
}

export async function writeCache(cacheKey: string, ttlMinutes: number, value: CachedSpec): Promise<void> {
  if (ttlMinutes <= 0) return;
  try {
    const key = await baseKey(cacheKey);
    const json = JSON.stringify(value);
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += CHUNK_SIZE) chunks.push(json.slice(i, i + CHUNK_SIZE));
    const ttl = { unit: 'MINUTES' as const, value: Math.max(ttlMinutes, 1) };
    // Chunks are written before the header so a reader never sees a header without data.
    for (let i = 0; i < chunks.length; i++) await kvs.set(`${key}:${i}`, chunks[i], { ttl });
    await kvs.set<CacheHeader>(key, { chunks: chunks.length, fetchedAt: value.fetchedAt }, { ttl });
  } catch (err) {
    console.warn(`[cache] write failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}
