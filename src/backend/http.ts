import { fetch, NotAllowedError, type RequestInit } from '@forge/api';
import { AppFailure, fail } from './errors';

/** Forge invocations are stopped after 25 s, so outbound calls must finish well before that. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Front-end invocation responses are capped at 5 MB; keep headroom for the response envelope. */
export const MAX_SPEC_BYTES = 4_500_000;

export interface FetchedText {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: string;
  truncated: boolean;
}

function looksLikeEgressDenial(err: unknown): boolean {
  if (err instanceof NotAllowedError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /egress|allow ?list|not allowed|URL not included/i.test(message);
}

// Outbound fetch. Only works for hosts an admin has approved.
export async function externalFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedText> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_SPEC_BYTES, ...rest } = init;
  const host = new URL(url).host;
  let response;
  try {
    response = await fetch(url, { ...rest, redirect: rest.redirect ?? 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof AppFailure) throw err;
    if (looksLikeEgressDenial(err)) {
      return fail(
        'EGRESS_NOT_APPROVED',
        `SpecPage is not allowed to contact ${host} yet.`,
        'A Confluence admin can approve this host in SpecPage settings.',
      );
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return fail('UPSTREAM_ERROR', `${host} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    return fail('UPSTREAM_ERROR', `Could not connect to ${host}.`, err instanceof Error ? err.message : undefined);
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes * 4) {
    return fail('TOO_LARGE', `The response from ${host} is too large (${Math.round(declared / 1_000_000)} MB).`);
  }

  let text = await response.text();
  let truncated = false;
  if (text.length > maxBytes) {
    text = text.slice(0, maxBytes);
    truncated = true;
  }
  return { status: response.status, statusText: response.statusText, headers, text, truncated };
}

/** Map an upstream HTTP status to an app error with a useful message. */
export function upstreamError(what: string, status: number, statusText: string): never {
  if (status === 401 || status === 403) {
    return fail('FORBIDDEN', `Access to ${what} was denied (HTTP ${status}).`, 'Check that the access token is valid and can read this repository.');
  }
  if (status === 404) {
    return fail('NOT_FOUND', `${what} was not found (HTTP 404).`, 'Check the repository, branch and file path.');
  }
  return fail('UPSTREAM_ERROR', `Could not load ${what} (HTTP ${status}${statusText ? ` ${statusText}` : ''}).`);
}
