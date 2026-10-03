import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeSpec } from '../src/spec-transport';

describe('base64', () => {
  it('round-trips every byte value, across chunk boundaries', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256);
    const b64 = bytesToBase64(bytes);
    expect(b64).toBe(Buffer.from(bytes).toString('base64'));
    expect(base64ToBytes(b64)).toEqual(bytes);
  });
});

describe('decodeSpec', () => {
  it('reads gzip-compressed JSON the way the backend sends it', async () => {
    const spec = { openapi: '3.1.0', info: { title: 'Café ☕', version: '1' }, paths: {} };
    await expect(decodeSpec(gzipSync(JSON.stringify(spec)).toString('base64'))).resolves.toEqual(spec);
  });
});
