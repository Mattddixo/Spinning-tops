import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { repoAllowed } from '../shared/git';
import type { GitConnection } from '../shared/types';
import { ALL_REPOS, bumpRepoGeneration, getConnection, getWebhookSecret, isConnectionId } from './store';

// Git push webhooks. Web trigger URLs are public and Forge doesn't
// authenticate them, so every request is checked against the connection's
// own secret before anything in it is used:
//
//   GitHub        X-Hub-Signature-256: sha256=<HMAC-SHA256 of the body>
//   Bitbucket     X-Hub-Signature: sha256=<HMAC-SHA256 of the body>
//   GitLab        X-Gitlab-Token: <secret>
//   Azure DevOps  basic auth, with the secret as the password
//
// A valid push only marks that repo's cached specs as stale, so the worst a
// replayed request can do is cause one extra fetch.

export interface WebTriggerRequest {
  method?: string;
  headers?: Record<string, string[] | string | undefined>;
  body?: string;
  queryParameters?: Record<string, string[] | undefined>;
}

export interface WebTriggerResponse {
  statusCode: number;
  headers: Record<string, string[]>;
  body: string;
}

const MAX_BODY_CHARS = 10_000_000;

function reply(statusCode: number, message: string): WebTriggerResponse {
  return { statusCode, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ message }) };
}

function header(request: WebTriggerRequest, name: string): string | undefined {
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() !== name) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

// Hashing both sides first gives equal-length buffers, so timingSafeEqual can
// compare values of any length without leaking it.
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

function signatureMatches(signature: string | undefined, secret: string, body: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  return sameSecret(signature.toLowerCase(), expected);
}

function basicPassword(authorization: string | undefined): string | undefined {
  const match = /^Basic\s+(.+)$/i.exec(authorization ?? '');
  if (!match) return undefined;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon >= 0 ? decoded.slice(colon + 1) : undefined;
}

function authentic(connection: GitConnection, request: WebTriggerRequest, secret: string, body: string): boolean {
  switch (connection.provider) {
    case 'github':
      return signatureMatches(header(request, 'x-hub-signature-256'), secret, body);
    case 'bitbucket':
      return signatureMatches(header(request, 'x-hub-signature'), secret, body);
    case 'gitlab': {
      const token = header(request, 'x-gitlab-token');
      return token !== undefined && sameSecret(token, secret);
    }
    case 'azure': {
      const password = basicPassword(header(request, 'authorization'));
      return password !== undefined && sameSecret(password, secret);
    }
    default:
      return false;
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' && v.length <= 300 ? v : undefined);

/** The organization from an Azure DevOps URL: dev.azure.com/{org}/... or {org}.visualstudio.com. */
export function azureOrgFromUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.hostname === 'dev.azure.com') {
    const first = url.pathname.split('/').filter(Boolean)[0];
    try {
      return first ? decodeURIComponent(first) : undefined;
    } catch {
      return first;
    }
  }
  if (url.hostname.endsWith('.visualstudio.com')) return url.hostname.split('.')[0];
  return undefined;
}

/**
 * org/project/repo for an Azure DevOps git.push. The project and repo names
 * come from their own fields, since remote URLs vary (collection segments,
 * project left out when it matches the repo name); only the organization is
 * read from a URL.
 */
export function azurePushedRepo(payload: Json): string | undefined {
  const repo = isObject(payload.resource) && isObject(payload.resource.repository) ? payload.resource.repository : undefined;
  if (!repo) return undefined;
  const name = text(repo.name);
  const project = isObject(repo.project) ? text(repo.project.name) : undefined;
  const org = azureOrgFromUrl(text(repo.remoteUrl)) ?? azureOrgFromUrl(text(repo.url));
  return name && project && org ? `${org}/${project}/${name}` : undefined;
}

/**
 * Is this a push, and to which repo? `undefined` means "not a push" (pings and
 * other events are acknowledged and ignored); ALL_REPOS means a push whose
 * repo couldn't be read, so every repo on the connection is refreshed.
 */
function pushedRepo(connection: GitConnection, request: WebTriggerRequest, payload: Json): string | undefined {
  switch (connection.provider) {
    case 'github':
      return header(request, 'x-github-event') === 'push' && isObject(payload.repository) ? (text(payload.repository.full_name) ?? ALL_REPOS) : undefined;
    case 'bitbucket':
      return header(request, 'x-event-key') === 'repo:push' && isObject(payload.repository) ? (text(payload.repository.full_name) ?? ALL_REPOS) : undefined;
    case 'gitlab': {
      const event = header(request, 'x-gitlab-event');
      if (event !== 'Push Hook' && event !== 'Tag Push Hook') return undefined;
      return isObject(payload.project) ? (text(payload.project.path_with_namespace) ?? ALL_REPOS) : ALL_REPOS;
    }
    case 'azure': {
      if (payload.eventType !== 'git.push') return undefined;
      return azurePushedRepo(payload) ?? ALL_REPOS;
    }
    default:
      return undefined;
  }
}

export async function handleWebhook(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  try {
    if ((request.method ?? '').toUpperCase() !== 'POST') return reply(405, 'POST only');
    const id = request.queryParameters?.connection?.[0];
    // Unknown connection and missing secret get the same answer, so the URL
    // can't be used to find out which connections exist.
    const connection = isConnectionId(id) ? await getConnection(id) : undefined;
    const secret = connection?.webhookEnabled ? await getWebhookSecret(connection.id) : undefined;
    if (!connection || !secret) return reply(404, 'Not found');

    const body = request.body ?? '';
    if (body.length > MAX_BODY_CHARS) return reply(413, 'Payload too large');
    if (!authentic(connection, request, secret, body)) return reply(401, 'Signature or token does not match');

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return reply(400, 'Expected a JSON body');
    }
    if (!isObject(payload)) return reply(400, 'Expected a JSON body');

    const repo = pushedRepo(connection, request, payload);
    if (repo === undefined) return reply(200, 'Ignored: not a push event');
    // Pushes to repos the connection doesn't allow can't affect any macro.
    if (repo !== ALL_REPOS && !repoAllowed(repo, connection.repos)) return reply(200, 'Ignored: repository not allowed on this connection');
    await bumpRepoGeneration(connection.id, repo);
    return reply(200, repo === ALL_REPOS ? 'Refreshed all repositories on this connection' : `Refreshed ${repo}`);
  } catch (err) {
    console.error(`[webhook] failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return reply(500, 'Internal error');
  }
}
