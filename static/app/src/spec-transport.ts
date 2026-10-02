// The backend sends specs as gzip'd JSON in base64 (see backend/encoding.ts).
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export async function decodeSpec(specGz: string): Promise<Record<string, unknown>> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser is too old to display large specs (DecompressionStream is missing).');
  }
  const stream = new Blob([base64ToBytes(specGz)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text) as Record<string, unknown>;
}
