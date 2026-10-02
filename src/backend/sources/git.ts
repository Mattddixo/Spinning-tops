import {
  bitbucketRefUrl,
  bitbucketRepoUrl,
  bitbucketSrcUrl,
  githubContentsUrl,
  gitlabRawUrl,
  isValidRef,
  isValidRepo,
  normaliseRepoPath,
  repoAllowed,
  webFileUrl,
} from '../../shared/git';
import type { GitConnection } from '../../shared/types';
import type { SecureContext } from '../context';
import { fail } from '../errors';
import { externalFetch, upstreamError } from '../http';
import { MAX_SOURCE_BYTES, MB } from '../limits';
import { getConnection, getRepoGeneration, getToken } from '../store';
import { syntheticPath, syntheticUrl, type SpecSource } from './types';

export interface GitTarget {
  connectionId?: string;
  repo?: string;
  ref?: string;
  path?: string;
}

function authHeaders(connection: GitConnection, token: string | undefined): Record<string, string> {
  if (!token || connection.authType === 'none') return {};
  switch (connection.authType) {
    case 'bearer':
      return { Authorization: `Bearer ${token}` };
    case 'private-token':
      return { 'PRIVATE-TOKEN': token };
    case 'basic': {
      const user = connection.username ?? '';
      return { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` };
    }
  }
}

/** Validate a page editor's Git selection against the admin's connection rules. */
export async function resolveGitTarget(ctx: SecureContext, target: GitTarget, options: { skipSpaceCheck?: boolean } = {}) {
  if (!target.connectionId || !target.repo || !target.path) {
    fail('NOT_CONFIGURED', 'errors.gitNotConfigured');
  }
  const connection = await getConnection(target.connectionId as string);
  if (!connection) {
    return fail('NOT_FOUND', 'errors.gitConnectionMissing', undefined, { hint: 'hints.restoreConnection' });
  }
  if (!options.skipSpaceCheck && connection.spaceKeys.length && (!ctx.spaceKey || !connection.spaceKeys.includes(ctx.spaceKey))) {
    fail('FORBIDDEN', 'errors.gitConnectionSpace', { name: connection.name });
  }
  const repo = (target.repo as string).trim().replace(/^\/+|\/+$/g, '');
  if (!isValidRepo(connection.provider, repo)) fail('BAD_REQUEST', 'errors.gitRepoInvalid', { repo });
  if (!repoAllowed(repo, connection.repos)) {
    fail('FORBIDDEN', 'errors.gitRepoNotAllowed', { repo, name: connection.name }, { hint: 'hints.askAdminAddRepo' });
  }
  const path = normaliseRepoPath(target.path as string);
  if (!path) fail('BAD_REQUEST', 'errors.gitPathInvalid');
  const ref = (target.ref ?? '').trim() || connection.defaultRef?.trim() || '';
  if (ref && !isValidRef(ref)) fail('BAD_REQUEST', 'errors.gitRefInvalid', { ref });
  return { connection, repo, path: path as string, ref };
}

async function resolveBitbucketCommit(connection: GitConnection, headers: Record<string, string>, repo: string, ref: string) {
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref;
  let name = ref;
  if (!name) {
    const res = await externalFetch(bitbucketRepoUrl(connection.apiBaseUrl, repo), { headers });
    if (res.status !== 200) upstreamError(repo, res.status, res.statusText);
    name = (JSON.parse(res.text) as { mainbranch?: { name?: string } }).mainbranch?.name ?? '';
    if (!name) fail('NOT_FOUND', 'errors.gitMainBranchUnknown', { repo });
  }
  for (const kind of ['branches', 'tags'] as const) {
    const res = await externalFetch(bitbucketRefUrl(connection.apiBaseUrl, repo, kind, name), { headers });
    if (res.status === 200) {
      const hash = (JSON.parse(res.text) as { target?: { hash?: string } }).target?.hash;
      if (hash) return hash;
    } else if (res.status !== 404) {
      upstreamError(`${repo}@${name}`, res.status, res.statusText);
    }
  }
  return fail('NOT_FOUND', 'errors.gitRefNotFound', { ref: name, repo });
}

export async function gitSource(
  ctx: SecureContext,
  target: GitTarget,
  options: { skipSpaceCheck?: boolean } = {},
): Promise<SpecSource> {
  const { connection, repo, path, ref } = await resolveGitTarget(ctx, target, options);
  const token = await getToken(connection.id);
  if (!token && connection.authType !== 'none') {
    fail('FORBIDDEN', 'errors.gitNoToken', { name: connection.name }, { hint: 'hints.askAdminAddToken' });
  }
  const headers = authHeaders(connection, token);
  let bitbucketCommit: string | undefined;

  async function readFile(filePath: string): Promise<string> {
    const what = `${repo}/${filePath}`;
    let url: string;
    let extra: Record<string, string> = {};
    switch (connection.provider) {
      case 'github':
        url = githubContentsUrl(connection.apiBaseUrl, repo, filePath, ref || undefined);
        extra = { Accept: 'application/vnd.github.raw+json' };
        break;
      case 'gitlab':
        url = gitlabRawUrl(connection.apiBaseUrl, repo, filePath, ref || undefined);
        break;
      case 'bitbucket':
        bitbucketCommit ??= await resolveBitbucketCommit(connection, headers, repo, ref);
        url = bitbucketSrcUrl(connection.apiBaseUrl, repo, bitbucketCommit, filePath);
        break;
    }
    const res = await externalFetch(url, { headers: { ...headers, ...extra } });
    if (res.status !== 200) upstreamError(what, res.status, res.statusText);
    if (res.truncated) fail('TOO_LARGE', 'errors.fileTooLarge', { name: what, size: MAX_SOURCE_BYTES / MB });
    return res.text;
  }

  return {
    label: `${repo}${ref ? `@${ref}` : ''}: ${path}`,
    link: webFileUrl(connection.provider, connection.webBaseUrl, repo, path, ref || undefined),
    // The repo generation is bumped by Git webhooks, which invalidates cached copies immediately.
    cacheKey: JSON.stringify(['git', connection.id, connection.updatedAt, await getRepoGeneration(connection.id, repo), repo, ref, path]),
    baseUrl: syntheticUrl('repo', path),
    async read(url: string) {
      const filePath = normaliseRepoPath(syntheticPath(url));
      if (!filePath) fail('BAD_REQUEST', 'errors.gitRefOutsideRepo', { ref: syntheticPath(url) });
      return readFile(filePath as string);
    },
  };
}
