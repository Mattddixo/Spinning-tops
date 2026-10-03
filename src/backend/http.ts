import { fetch, NotAllowedError, type RequestInit } from '@forge/api';
import { timeoutWithinBudget } from './budget';
import { AppFailure, fail } from './errors';

export const DEFAULT_TIMEOUT_MS = 15_000;
const MB = 1_000_000;

export interface FetchedText {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: string;
  truncated: boolean;
}

export interface FetchedAny extends Omit<FetchedText, 'text'> {
  text?: string;
  base64?: string;
}

function looksLikeEgressDenial(err: unknown): boolean {
  if (err instanceof NotAllowedError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /egress|allow ?list|not allowed|URL not included/i.test(message);
}

// Content types we hand back as text; everything else goes back as base64.
export function isTextual(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const type = contentType.split(';')[0].trim().toLowerCase();
  return (
    type.startsWith('text/') ||
    type.endsWith('+json') ||
    type.endsWith('+xml') ||
    type.endsWith('+yaml') ||
    [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/x-www-form-urlencoded',
      'application/yaml',
      'application/x-yaml',
      'application/graphql',
      'application/problem+json',
    ].includes(type)
  );
}

type Init = RequestInit & {
  timeoutMs?: number;
  maxBytes?: number;
  /** Called before following a redirect; throw to stop. */
  beforeRedirect?: (next: URL) => Promise<void>;
};

const MAX_REDIRECTS = 5;
// Headers that carry a Git token. Only sent to the origin they were meant for.
const CREDENTIAL_HEADERS = new Set(['authorization', 'private-token']);

function withoutCredentials(headers: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((headers ?? {}) as Record<string, string>)) if (!CREDENTIAL_HEADERS.has(k.toLowerCase())) out[k] = v;
  return out;
}

async function send(url: string, init: Init) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes: _maxBytes, beforeRedirect, ...rest } = init;
  const host = new URL(url).host;
  const timeout = timeoutWithinBudget(timeoutMs);
  const signal = AbortSignal.timeout(timeout);
  try {
    if (rest.redirect === 'manual') return await fetch(url, { ...rest, signal });
    // Follow redirects ourselves so a token never goes to another origin, and
    // only to https.
    const origin = new URL(url).origin;
    let current = url;
    let headers = rest.headers;
    for (let hop = 0; ; hop++) {
      const response = await fetch(current, { ...rest, headers, redirect: 'manual', signal });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || response.status === 304 || !location) return response;
      if (hop >= MAX_REDIRECTS) return fail('UPSTREAM_ERROR', 'errors.tooManyRedirects', { host });
      const next = new URL(location, current);
      if (next.protocol !== 'https:') return fail('UPSTREAM_ERROR', 'errors.redirectNotHttps', { host });
      await beforeRedirect?.(next);
      if (next.origin !== origin) headers = withoutCredentials(headers);
      current = next.toString();
    }
  } catch (err) {
    if (err instanceof AppFailure) throw err;
    if (looksLikeEgressDenial(err)) {
      return fail('EGRESS_NOT_APPROVED', 'errors.egressNotApproved', { host }, { hint: 'hints.askAdminApproveHost' });
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail('UPSTREAM_ERROR', 'errors.timeout', { host, seconds: Math.round(timeout / 1000) });
    }
    return fail('UPSTREAM_ERROR', 'errors.connectFailed', { host }, { detail: err instanceof Error ? err.message : undefined });
  }
}

function collectHeaders(response: { headers: { forEach: (cb: (v: string, k: string) => void) => void } }) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function checkDeclaredSize(host: string, headers: Record<string, string>, maxBytes: number) {
  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes * 2) {
    fail('TOO_LARGE', 'errors.responseTooLarge', { host, size: Math.round(declared / MB) });
  }
}

// Outbound fetch. Only works for hosts an admin has approved.
export async function externalFetch(url: string, init: Init = {}): Promise<FetchedText> {
  const maxBytes = init.maxBytes ?? 20 * MB;
  const host = new URL(url).host;
  const response = await send(url, init);
  const headers = collectHeaders(response);
  checkDeclaredSize(host, headers, maxBytes);
  let text = await response.text();
  let truncated = false;
  if (text.length > maxBytes) {
    text = text.slice(0, maxBytes);
    truncated = true;
  }
  return { status: response.status, statusText: response.statusText, headers, text, truncated };
}

/** Like externalFetch, but non-text responses come back base64 encoded (used by Try it out). */
export async function externalFetchAny(url: string, init: Init & { maxBinaryBytes?: number } = {}): Promise<FetchedAny> {
  const maxBytes = init.maxBytes ?? 4 * MB;
  const maxBinary = init.maxBinaryBytes ?? 3 * MB;
  const host = new URL(url).host;
  const response = await send(url, init);
  const headers = collectHeaders(response);
  checkDeclaredSize(host, headers, Math.max(maxBytes, maxBinary));
  const base = { status: response.status, statusText: response.statusText, headers };

  if (isTextual(headers['content-type'])) {
    let text = await response.text();
    let truncated = false;
    if (text.length > maxBytes) {
      text = text.slice(0, maxBytes);
      truncated = true;
    }
    return { ...base, text, truncated };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  // A cut-off image or PDF is just a broken file, so refuse instead of truncating.
  if (bytes.length > maxBinary) fail('TOO_LARGE', 'errors.responseTooLarge', { host, size: Math.round((bytes.length / MB) * 10) / 10 });
  return { ...base, base64: bytes.toString('base64'), truncated: false };
}

export function upstreamError(what: string, status: number, statusText: string): never {
  if (status === 401 || status === 403) {
    return fail('FORBIDDEN', 'errors.upstreamForbidden', { what, status }, { hint: 'hints.checkToken' });
  }
  if (status === 404) {
    return fail('NOT_FOUND', 'errors.upstreamNotFound', { what }, { hint: 'hints.checkRepoPath' });
  }
  return fail('UPSTREAM_ERROR', 'errors.upstreamFailed', { what, status }, { detail: statusText || undefined });
}
