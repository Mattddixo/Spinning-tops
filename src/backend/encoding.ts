import { gunzipSync, gzipSync } from 'node:zlib';
import { fail } from './errors';
import { MAX_ENCODED_SPEC_BYTES, MB } from './limits';

// Specs travel gzip'd + base64 so large ones fit Forge's 5 MB response cap.
// JSON specs usually compress around 10x, so ~40 MB of JSON still fits.
export function encodeSpec(spec: unknown): string {
  const encoded = gzipSync(Buffer.from(JSON.stringify(spec), 'utf8'), { level: 6 }).toString('base64');
  if (encoded.length > MAX_ENCODED_SPEC_BYTES) {
    fail('TOO_LARGE', 'errors.bundleTooLarge', { size: Math.round(MAX_ENCODED_SPEC_BYTES / MB) });
  }
  return encoded;
}

export function decodeSpec(encoded: string): Record<string, unknown> {
  return JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')) as Record<string, unknown>;
}
