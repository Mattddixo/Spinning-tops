import { MAX_BINARY_REQUEST_BYTES, type MacroConfig, type ProxyRequest, type ProxyResponse } from '../shared/types';
import { isLicensedUser, requireLicense, type SecureContext } from './context';
import { fail } from './errors';
import { externalFetchAny } from './http';
import { parseHttpsUrl } from './sources/url';
import { getSettings } from './store';

// Front-end invocation requests are capped at 500 KB by Forge. Base64 adds a
// third, so binary bodies get a smaller limit than text.
const MAX_TEXT_BODY = 400_000;
const MAX_TEXT_RESPONSE = 4_000_000;
// Responses are capped at 5 MB; base64 of 3 MB is 4 MB.
const MAX_BINARY_RESPONSE = 3_000_000;
const PROXY_TIMEOUT_MS = 20_000;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// hop-by-hop, ambient credentials, or set by the runtime
const BLOCKED_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'origin',
  'referer',
]);

const BLOCKED_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);

function decodeBinaryBody(b64: string): ArrayBuffer {
  // Rough size check before decoding so a huge string can't eat memory.
  if (b64.length > Math.ceil((MAX_BINARY_REQUEST_BYTES * 4) / 3) + 4) fail('TOO_LARGE', 'errors.requestTooLarge', { size: MAX_BINARY_REQUEST_BYTES / 1000 });
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > MAX_BINARY_REQUEST_BYTES) fail('TOO_LARGE', 'errors.requestTooLarge', { size: MAX_BINARY_REQUEST_BYTES / 1000 });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Try it out proxy. Calls from the iframe would hit CORS, so we send them from
// the backend. Needs: site setting on, macro setting on, licensed user, and the
// host approved by an admin.
export async function proxyRequest(ctx: SecureContext, config: MacroConfig, request: ProxyRequest): Promise<ProxyResponse> {
  requireLicense(ctx);
  const settings = await getSettings();
  if (!settings.tryItOutEnabled) fail('SOURCE_DISABLED', 'errors.tryItOutSiteOff', undefined, { hint: 'hints.askAdminEnableTryItOut' });
  if (config.tryItOut !== true) fail('SOURCE_DISABLED', 'errors.tryItOutMacroOff');
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.tryItOutLicensedOnly');

  const method = String(request?.method ?? '').toUpperCase();
  if (!METHODS.has(method)) fail('BAD_REQUEST', 'errors.methodUnsupported', { method: method || '(none)' });
  const url = parseHttpsUrl(request?.url);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request?.headers ?? {})) {
    const key = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(key) || key.startsWith('sec-') || typeof value !== 'string') continue;
    headers[name] = value.replace(/[\r\n]+/g, ' ');
  }

  let body: string | ArrayBuffer | undefined;
  if (typeof request?.bodyBase64 === 'string') {
    body = decodeBinaryBody(request.bodyBase64);
  } else if (typeof request?.body === 'string') {
    if (request.body.length > MAX_TEXT_BODY) fail('TOO_LARGE', 'errors.requestTooLarge', { size: MAX_TEXT_BODY / 1000 });
    body = request.body;
  }
  const canHaveBody = method !== 'GET' && method !== 'HEAD';

  const res = await externalFetchAny(url.toString(), {
    method,
    headers,
    body: canHaveBody ? body : undefined,
    // don't follow redirects to other hosts
    redirect: 'manual',
    timeoutMs: PROXY_TIMEOUT_MS,
    maxBytes: MAX_TEXT_RESPONSE,
    maxBinaryBytes: MAX_BINARY_RESPONSE,
  });

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (!BLOCKED_RESPONSE_HEADERS.has(key)) responseHeaders[key] = value;
  }
  const out: ProxyResponse = { status: res.status, statusText: res.statusText, headers: responseHeaders, truncated: res.truncated };
  if (res.base64 !== undefined) out.bodyBase64 = res.base64;
  else out.body = res.text ?? '';
  return out;
}
