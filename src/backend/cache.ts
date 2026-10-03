import { createHash } from 'node:crypto';
import { kvs } from '@forge/kvs';
import type { Notice, SpecSummary } from '../shared/types';
import { getCacheGeneration } from './store';

// Cache for Git/URL specs. KVS values max out at 240 KiB so big specs get
// chunked. Expired keys can stick around ~48h, so we also check fetchedAt.
const CHUNK_SIZE = 200_000;
// The limit is in bytes of the stored (JSON-encoded) value, so non-ASCII text
// and escaped quotes count extra. Leaves headroom under 240 KiB.
const MAX_CHUNK_BYTES = 230_000;

const storedBytes = (chunk: string) => Buffer.byteLength(JSON.stringify(chunk), 'utf8');

/** Split text into pieces whose stored size fits a KVS value. */
export function splitForStorage(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    for (;;) {
      // Don't split a surrogate pair between chunks.
      if (end < text.length && end > start + 1 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      if (storedBytes(text.slice(start, end)) <= MAX_CHUNK_BYTES || end - start <= 1) break;
      end = start + Math.max(1, Math.floor((end - start) * 0.75));
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
// Bump when CachedSpec changes shape so older entries are ignored, not misread.
const FORMAT = 'v2';

export interface CachedSpec {
  specGz: string;
  summary: SpecSummary;
  fileCount: number;
  warnings: Notice[];
  serversResolvable: boolean;
  fetchedAt: string;
  sourceLink?: string;
}

interface CacheHeader {
  chunks: number;
  fetchedAt: string;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function baseKey(cacheKey: string): Promise<string> {
  return `spec-cache:${FORMAT}:${await getCacheGeneration()}:${hash(cacheKey)}`;
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
    const cached = JSON.parse(json) as Partial<CachedSpec> | null;
    const valid =
      cached !== null &&
      typeof cached === 'object' &&
      typeof cached.specGz === 'string' &&
      typeof cached.summary === 'object' &&
      cached.summary !== null &&
      Array.isArray(cached.warnings) &&
      cached.fetchedAt === header.fetchedAt;
    return valid ? (cached as CachedSpec) : undefined;
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
    const chunks = splitForStorage(json);
    const ttl = { unit: 'MINUTES' as const, value: Math.max(ttlMinutes, 1) };
    // Chunks are written (side by side) before the header, so a reader never sees a header without data.
    await Promise.all(chunks.map((chunk, i) => kvs.set(`${key}:${i}`, chunk, { ttl })));
    await kvs.set<CacheHeader>(key, { chunks: chunks.length, fetchedAt: value.fetchedAt }, { ttl });
  } catch (err) {
    console.warn(`[cache] write failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}
