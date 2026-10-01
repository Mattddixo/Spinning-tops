import type { MacroConfig, ProxyRequest, ProxyResponse } from '../shared/types';
import { isLicensedUser, requireLicense, type SecureContext } from './context';
import { fail } from './errors';
import { externalFetch } from './http';
import { parseHttpsUrl } from './sources/url';
import { getSettings } from './store';

/** Front-end invocation request payloads are capped at 500 KB by Forge. */
const MAX_REQUEST_BODY = 400_000;
const MAX_RESPONSE_BODY = 4_000_000;
const PROXY_TIMEOUT_MS = 20_000;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Headers that must never be forwarded (hop-by-hop, ambient credentials or set by the runtime). */
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

// Try it out proxy. Calls from the iframe would hit CORS, so we send them from
// the backend. Needs: site setting on, macro setting on, licensed user, and the
// host approved by an admin.
export async function proxyRequest(ctx: SecureContext, config: MacroConfig, request: ProxyRequest): Promise<ProxyResponse> {
  requireLicense(ctx);
  const settings = await getSettings();
  if (!settings.tryItOutEnabled) fail('SOURCE_DISABLED', '"Try it out" is turned off for this site.', 'A Confluence admin can enable it in SpecPage settings.');
  if (config.tryItOut !== true) fail('SOURCE_DISABLED', '"Try it out" is turned off for this macro.');
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', '"Try it out" is available to signed-in Confluence users only.');

  const method = String(request?.method ?? '').toUpperCase();
  if (!METHODS.has(method)) fail('BAD_REQUEST', `HTTP method ${method || '(none)'} is not supported.`);
  const url = parseHttpsUrl(request?.url);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request?.headers ?? {})) {
    const key = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(key) || key.startsWith('sec-') || typeof value !== 'string') continue;
    headers[name] = value.replace(/[\r\n]+/g, ' ');
  }

  const body = typeof request?.body === 'string' ? request.body : undefined;
  if (body && body.length > MAX_REQUEST_BODY) fail('TOO_LARGE', 'Request bodies are limited to 400 KB.');
  const canHaveBody = method !== 'GET' && method !== 'HEAD';

  const res = await externalFetch(url.toString(), {
    method,
    headers,
    body: canHaveBody ? body : undefined,
    // don't follow redirects to other hosts
    redirect: 'manual',
    timeoutMs: PROXY_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BODY,
  });

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (!BLOCKED_RESPONSE_HEADERS.has(key)) responseHeaders[key] = value;
  }
  return { status: res.status, statusText: res.statusText, headers: responseHeaders, body: res.text, truncated: res.truncated };
}
