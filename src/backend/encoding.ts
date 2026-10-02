import { gunzipSync, gzipSync } from 'node:zlib';
import { fail } from './errors';
import { MAX_ENCODED_SPEC_BYTES, MB } from './limits';

// Specs travel gzip'd + base64 so large ones fit Forge's 5 MB response cap.
// JSON specs usually compress around 10x, so ~40 MB of JSON still fits.
export function encodeSpec(spec: unknown): string {
  return encodeJsonText(JSON.stringify(spec));
}

/** Same as encodeSpec for JSON that is already a string (AsyncAPI's stringified documents). */
export function encodeJsonText(json: string): string {
  const encoded = gzipSync(Buffer.from(json, 'utf8'), { level: 6 }).toString('base64');
  if (encoded.length > MAX_ENCODED_SPEC_BYTES) {
    fail('TOO_LARGE', 'errors.bundleTooLarge', { size: Math.round(MAX_ENCODED_SPEC_BYTES / MB) });
  }
  return encoded;
}

export function decodeSpec(encoded: string): Record<string, unknown> {
  return JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')) as Record<string, unknown>;
}
