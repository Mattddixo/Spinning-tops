import { randomBytes, randomUUID } from 'node:crypto';
import { webTrigger } from '@forge/api';
import { isValidRef, isValidRepo, originOf } from '../shared/git';
import type { GitAuthType, GitConnection, GitConnectionInput, GitProvider } from '../shared/types';
import { loadAndBundle } from './bundle';
import type { SecureContext } from './context';
import { fail } from './errors';
import { gitSource } from './sources/git';
import {
  deleteConnectionRecord,
  deleteToken,
  deleteWebhookSecret,
  getConnection,
  getConnections,
  getSettings,
  getToken,
  saveConnectionRecord,
  setToken,
  setWebhookSecret,
} from './store';

const MAX_CONNECTIONS = 20;
const MAX_REPOS = 100;

const AUTH_TYPES: Record<GitProvider, GitAuthType[]> = {
  github: ['bearer', 'none'],
  gitlab: ['private-token', 'bearer', 'none'],
  bitbucket: ['bearer', 'basic', 'none'],
  azure: ['pat', 'none'],
  swaggerhub: ['bearer', 'none'],
};

function cleanList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))].slice(0, max);
}

function validateRepoPattern(provider: GitProvider, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('/*')) {
    const owner = pattern.slice(0, -2);
    const segment = provider === 'azure' ? /^[A-Za-z0-9._ -]+$/ : /^[A-Za-z0-9._-]+$/;
    return owner.split('/').every((s) => segment.test(s) && s.trim() === s && s !== '.' && s !== '..');
  }
  return isValidRepo(provider, pattern);
}

export async function saveConnection(input: GitConnectionInput): Promise<{ connection: GitConnection; changes: string[]; created: boolean }> {
  const provider = input.provider;
  if (!(provider in AUTH_TYPES)) fail('BAD_REQUEST', 'errors.providerRequired');

  const name = (input.name ?? '').trim();
  if (!name || name.length > 80) fail('BAD_REQUEST', 'errors.connectionNameInvalid');

  const apiOrigin = originOf(input.apiBaseUrl ?? '');
  const webOrigin = originOf(input.webBaseUrl ?? '');
  if (!apiOrigin) fail('BAD_REQUEST', 'errors.apiUrlInvalid');
  if (!webOrigin) fail('BAD_REQUEST', 'errors.webUrlInvalid');

  if (!AUTH_TYPES[provider].includes(input.authType)) fail('BAD_REQUEST', 'errors.authTypeInvalid');
  const username = (input.username ?? '').trim();
  if (input.authType === 'basic' && !username) fail('BAD_REQUEST', 'errors.usernameRequired');

  const repos = cleanList(input.repos, MAX_REPOS);
  const badRepo = repos.find((r) => !validateRepoPattern(provider, r));
  if (badRepo) fail('BAD_REQUEST', 'errors.repoPatternInvalid', { repo: badRepo });
  if (!repos.length) fail('BAD_REQUEST', 'errors.reposRequired');

  const spaceKeys = cleanList(input.spaceKeys, 200);
  const badSpace = spaceKeys.find((k) => !/^~?[A-Za-z0-9_-]+$/.test(k));
  if (badSpace) fail('BAD_REQUEST', 'errors.spaceKeyInvalid', { key: badSpace });

  const defaultRef = (input.defaultRef ?? '').trim();
  if (defaultRef && !isValidRef(defaultRef)) fail('BAD_REQUEST', 'errors.gitRefInvalid', { ref: defaultRef });

  const connections = await getConnections();
  const now = new Date().toISOString();
  const existing = input.id ? connections.find((c) => c.id === input.id) : undefined;
  if (input.id && !existing) fail('NOT_FOUND', 'errors.connectionGone');
  if (!existing && connections.length >= MAX_CONNECTIONS) fail('BAD_REQUEST', 'errors.tooManyConnections', { max: MAX_CONNECTIONS });

  const id = existing?.id ?? randomUUID();
  if (typeof input.token === 'string') {
    const token = input.token.trim();
    if (token) {
      if (token.length > 4096) fail('BAD_REQUEST', 'errors.tokenTooLong');
      await setToken(id, token);
    } else {
      await deleteToken(id);
    }
  }
  const hasToken = Boolean(await getToken(id));
  if (input.authType !== 'none' && !hasToken) fail('BAD_REQUEST', 'errors.tokenRequired');

  const connection: GitConnection = {
    id,
    name,
    provider,
    apiBaseUrl: (input.apiBaseUrl as string).trim().replace(/\/+$/, ''),
    webBaseUrl: (input.webBaseUrl as string).trim().replace(/\/+$/, ''),
    authType: input.authType,
    ...(input.authType === 'basic' ? { username } : {}),
    repos,
    spaceKeys,
    ...(defaultRef ? { defaultRef } : {}),
    hasToken,
    // Webhook settings only change through enableWebhook/disableWebhook. A
    // provider change turns the webhook off, since the check is per provider.
    ...(existing?.webhookEnabled && existing.provider === provider ? { webhookEnabled: true } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await saveConnectionRecord(connection);
  if (existing?.webhookEnabled && !connection.webhookEnabled) await deleteWebhookSecret(id);

  // What changed, for the audit log (field names only, never values).
  const changes: string[] = [];
  if (existing) {
    const fields: Array<keyof GitConnection> = ['name', 'provider', 'apiBaseUrl', 'webBaseUrl', 'authType', 'username', 'repos', 'spaceKeys', 'defaultRef'];
    for (const f of fields) if (JSON.stringify(existing[f] ?? null) !== JSON.stringify(connection[f] ?? null)) changes.push(f);
  }
  if (typeof input.token === 'string') changes.push(input.token.trim() ? 'token' : 'token-removed');
  return { connection, changes, created: !existing };
}

export async function deleteConnection(id: string): Promise<GitConnection> {
  const removed = await getConnection(String(id ?? ''));
  if (!removed) return fail('NOT_FOUND', 'errors.connectionGone');
  await deleteConnectionRecord(removed.id);
  await deleteToken(removed.id);
  await deleteWebhookSecret(removed.id);
  return removed;
}

// Providers whose push webhooks we can verify (see webhook.ts).
const WEBHOOK_PROVIDERS = new Set(['github', 'gitlab', 'bitbucket', 'azure']);
export const WEBHOOK_TRIGGER_KEY = 'git-webhook';

export async function webhookUrlFor(id: string): Promise<string> {
  const base = await webTrigger.getUrl(WEBHOOK_TRIGGER_KEY);
  const url = new URL(base);
  url.searchParams.set('connection', id);
  return url.toString();
}

/** Turn on push webhooks for a connection with a fresh secret. The secret is only returned here, once. */
export async function enableWebhook(id: string): Promise<{ connection: GitConnection; url: string; secret: string }> {
  const connection = await getConnection(String(id ?? ''));
  if (!connection) return fail('NOT_FOUND', 'errors.connectionGone');
  if (!WEBHOOK_PROVIDERS.has(connection.provider)) return fail('BAD_REQUEST', 'errors.webhookUnsupported');
  const secret = randomBytes(32).toString('hex');
  await setWebhookSecret(connection.id, secret);
  // updatedAt is part of the spec cache key, so changing it here (and when
  // turning off) starts the connection's cache afresh.
  const updated: GitConnection = { ...connection, webhookEnabled: true, updatedAt: new Date().toISOString() };
  await saveConnectionRecord(updated);
  return { connection: updated, url: await webhookUrlFor(connection.id), secret };
}

export async function disableWebhook(id: string): Promise<GitConnection> {
  const connection = await getConnection(String(id ?? ''));
  if (!connection) return fail('NOT_FOUND', 'errors.connectionGone');
  await deleteWebhookSecret(connection.id);
  const { webhookEnabled: _off, ...rest } = connection;
  const updated: GitConnection = { ...rest, updatedAt: new Date().toISOString() };
  await saveConnectionRecord(updated);
  return updated;
}

export async function testConnection(ctx: SecureContext, args: { id: string; repo: string; path?: string; ref?: string }) {
  const settings = await getSettings();
  const source = await gitSource(ctx, { connectionId: args.id, repo: args.repo, path: args.path, ref: args.ref }, { skipSpaceCheck: true });
  const bundled = await loadAndBundle(source, { allowExternalUrls: settings.urlSourcesEnabled });
  return {
    title: bundled.summary.title,
    version: bundled.summary.version,
    operationCount: bundled.summary.operations.length,
    fileCount: bundled.fileCount,
  };
}
