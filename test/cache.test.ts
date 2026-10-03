import { describe, expect, it } from 'vitest';
import { splitForStorage } from '../src/backend/cache';

const storedBytes = (chunk: string) => Buffer.byteLength(JSON.stringify(chunk), 'utf8');

describe('splitForStorage', () => {
  it('keeps every stored chunk under the KVS limit, even for non-ASCII text and quotes', () => {
    const summary = JSON.stringify({ title: '支払いAPI', ops: Array.from({ length: 4000 }, (_, i) => ({ summary: `"説明" 🚀 ${i} ` + 'データ'.repeat(20) })) });
    const text = summary + 'A'.repeat(500_000);
    const chunks = splitForStorage(text);
    expect(chunks.join('')).toBe(text);
    expect(Math.max(...chunks.map(storedBytes))).toBeLessThanOrEqual(230_000);
    // 240 KiB is the real limit
    expect(Math.max(...chunks.map(storedBytes))).toBeLessThan(240 * 1024);
  });

  it('never splits a surrogate pair', () => {
    const text = '🚀'.repeat(150_000);
    const chunks = splitForStorage(text);
    expect(chunks.join('')).toBe(text);
    for (const c of chunks) expect(/^[\uDC00-\uDFFF]/.test(c)).toBe(false);
  });

  it('leaves plain ASCII in 200,000-character chunks', () => {
    expect(splitForStorage('x'.repeat(450_000)).map((c) => c.length)).toEqual([200_000, 200_000, 50_000]);
  });
});
