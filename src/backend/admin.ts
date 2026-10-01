import { randomUUID } from 'node:crypto';
import { isValidRef, isValidRepo, originOf } from '../shared/git';
import type { GitAuthType, GitConnection, GitConnectionInput, GitProvider } from '../shared/types';
import { loadAndBundle } from './bundle';
import type { SecureContext } from './context';
import { fail } from './errors';
import { gitSource } from './sources/git';
import { deleteToken, getConnections, getSettings, getToken, saveConnections, setToken } from './store';

const MAX_CONNECTIONS = 20;
const MAX_REPOS = 100;

const AUTH_TYPES: Record<GitProvider, GitAuthType[]> = {
  github: ['bearer', 'none'],
  gitlab: ['private-token', 'bearer', 'none'],
  bitbucket: ['bearer', 'basic', 'none'],
};

function cleanList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))].slice(0, max);
}

function validateRepoPattern(provider: GitProvider, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('/*')) {
    const owner = pattern.slice(0, -2);
    return owner.split('/').every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..');
  }
  return isValidRepo(provider, pattern);
}

export async function saveConnection(input: GitConnectionInput): Promise<GitConnection> {
  const provider = input.provider;
  if (!['github', 'gitlab', 'bitbucket'].includes(provider)) fail('BAD_REQUEST', 'Choose a Git provider.');

  const name = (input.name ?? '').trim();
  if (!name || name.length > 80) fail('BAD_REQUEST', 'Enter a connection name of up to 80 characters.');

  const apiOrigin = originOf(input.apiBaseUrl ?? '');
  const webOrigin = originOf(input.webBaseUrl ?? '');
  if (!apiOrigin) fail('BAD_REQUEST', 'The API URL must start with https://');
  if (!webOrigin) fail('BAD_REQUEST', 'The web URL must start with https://');

  if (!AUTH_TYPES[provider].includes(input.authType)) fail('BAD_REQUEST', 'This authentication method is not supported for the chosen provider.');
  const username = (input.username ?? '').trim();
  if (input.authType === 'basic' && !username) fail('BAD_REQUEST', 'Enter the username (Atlassian account email) for Basic authentication.');

  const repos = cleanList(input.repos, MAX_REPOS);
  const badRepo = repos.find((r) => !validateRepoPattern(provider, r));
  if (badRepo) fail('BAD_REQUEST', `"${badRepo}" is not a valid repository or pattern.`);
  if (!repos.length) fail('BAD_REQUEST', 'Add at least one allowed repository (for example "acme/payments-api" or "acme/*").');

  const spaceKeys = cleanList(input.spaceKeys, 200);
  const badSpace = spaceKeys.find((k) => !/^~?[A-Za-z0-9_-]+$/.test(k));
  if (badSpace) fail('BAD_REQUEST', `"${badSpace}" is not a valid space key.`);

  const defaultRef = (input.defaultRef ?? '').trim();
  if (defaultRef && !isValidRef(defaultRef)) fail('BAD_REQUEST', `"${defaultRef}" is not a valid branch, tag or commit.`);

  const connections = await getConnections();
  const now = new Date().toISOString();
  const existing = input.id ? connections.find((c) => c.id === input.id) : undefined;
  if (input.id && !existing) fail('NOT_FOUND', 'That connection no longer exists.');
  if (!existing && connections.length >= MAX_CONNECTIONS) fail('BAD_REQUEST', `You can create up to ${MAX_CONNECTIONS} Git connections.`);

  const id = existing?.id ?? randomUUID();
  if (typeof input.token === 'string') {
    const token = input.token.trim();
    if (token) {
      if (token.length > 4096) fail('BAD_REQUEST', 'The access token is too long.');
      await setToken(id, token);
    } else {
      await deleteToken(id);
    }
  }
  const hasToken = Boolean(await getToken(id));
  if (input.authType !== 'none' && !hasToken) fail('BAD_REQUEST', 'Enter an access token for this connection.');

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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await saveConnections(existing ? connections.map((c) => (c.id === id ? connection : c)) : [...connections, connection]);
  return connection;
}

export async function deleteConnection(id: string): Promise<void> {
  const connections = await getConnections();
  if (!connections.some((c) => c.id === id)) fail('NOT_FOUND', 'That connection no longer exists.');
  await saveConnections(connections.filter((c) => c.id !== id));
  await deleteToken(id);
}

export async function testConnection(ctx: SecureContext, args: { id: string; repo: string; path: string; ref?: string }) {
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
