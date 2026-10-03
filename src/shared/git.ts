import type { GitProvider } from './types';

// Endpoints used:
//   GitHub/GHES: GET {api}/repos/{owner}/{repo}/contents/{path}?ref=  (Accept: application/vnd.github.raw+json)
//                GHES api base is https://HOST/api/v3
//   GitLab:      GET {api}/projects/{encoded project}/repository/files/{encoded path}/raw?ref=
//   Bitbucket:   GET {api}/repositories/{ws}/{repo}/src/{commit}/{path}
//                (commit must be a hash, so branch/tag names get looked up first)
//   Azure DevOps: GET {api}/{org}/{project}/_apis/git/repositories/{repo}/items?path=
//                &versionDescriptor.version=&versionDescriptor.versionType=branch|tag|commit&api-version=7.1
//                (MicrosoftDocs/vsts-rest-api-specs, git 7.1). PATs go as Basic with an empty user.
//   SwaggerHub:  GET {api}/apis/{owner}/{api}/{version}?resolved=true, default version from
//                GET {api}/apis/{owner}/{api}/settings/default -> { version }. Key as Bearer.
//                (SmartBear/swaggerhub-cli). On-premise API base is https://HOST/v1.

export interface ProviderDefaults {
  label: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  repoHint: string;
  tokenHint: string;
}

export const PROVIDERS: Record<GitProvider, ProviderDefaults> = {
  github: {
    label: 'GitHub / GitHub Enterprise Server',
    apiBaseUrl: 'https://api.github.com',
    webBaseUrl: 'https://github.com',
    repoHint: 'owner/repository',
    tokenHint: 'Fine-grained personal access token with read-only "Contents" permission.',
  },
  gitlab: {
    label: 'GitLab (SaaS or self-managed)',
    apiBaseUrl: 'https://gitlab.com/api/v4',
    webBaseUrl: 'https://gitlab.com',
    repoHint: 'group/subgroup/project',
    tokenHint: 'Project or group access token with the read_repository scope.',
  },
  bitbucket: {
    label: 'Bitbucket Cloud',
    apiBaseUrl: 'https://api.bitbucket.org/2.0',
    webBaseUrl: 'https://bitbucket.org',
    repoHint: 'workspace/repository',
    tokenHint: 'Repository, project or workspace access token with the "repository" (read) scope.',
  },
  azure: {
    label: 'Azure DevOps',
    apiBaseUrl: 'https://dev.azure.com',
    webBaseUrl: 'https://dev.azure.com',
    repoHint: 'organization/project/repository',
    tokenHint: 'Personal access token with the Code (Read) scope.',
  },
  swaggerhub: {
    label: 'SwaggerHub',
    apiBaseUrl: 'https://api.swaggerhub.com',
    webBaseUrl: 'https://app.swaggerhub.com',
    repoHint: 'owner/api-name',
    tokenHint: 'SwaggerHub API key (from your account settings). Not needed for public APIs.',
  },
};

/** SwaggerHub serves whole API definitions, so there is no file path to pick. */
export const usesFilePath = (provider: GitProvider) => provider !== 'swaggerhub';

const SPEC_EXTENSIONS = ['.json', '.yaml', '.yml'];

export function isSpecFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return SPEC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Clean up a repo path. Rejects ../ escapes and anything that isn't .json/.yaml/.yml.
export function normaliseRepoPath(input: string): string | undefined {
  const trimmed = input.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('\\') || trimmed.includes('\0')) return undefined;
  const segments: string[] = [];
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const path = segments.join('/');
  if (!path || !isSpecFilename(path)) return undefined;
  return path;
}

const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;
// Azure DevOps project and repository names may contain spaces.
const AZURE_SEGMENT = /^[A-Za-z0-9._-](?:[A-Za-z0-9._ -]*[A-Za-z0-9._-])?$/;

export function isValidRepo(provider: GitProvider, repo: string): boolean {
  const segments = repo.split('/');
  const pattern = provider === 'azure' ? AZURE_SEGMENT : REPO_SEGMENT;
  if (segments.some((s) => !pattern.test(s) || s === '.' || s === '..')) return false;
  if (provider === 'gitlab') return segments.length >= 2;
  if (provider === 'azure') return segments.length === 3;
  return segments.length === 2;
}

// Entries are "acme/payments" or "acme/*".
export function repoAllowed(repo: string, allowList: string[]): boolean {
  const target = repo.toLowerCase();
  return allowList.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry === '*') return true;
    if (entry.endsWith('/*')) return target.startsWith(entry.slice(0, -1));
    return entry === target;
  });
}

// Characters Git allows in ref names that stay unambiguous once URL-encoded
// (every provider URL encodes the ref). `+` and `@` cover tags like
// v1.0.0+build.5; `@{` can't occur because braces aren't allowed.
export function isValidRef(ref: string): boolean {
  return ref.length <= 255 && /^[A-Za-z0-9._\-/+@]+$/.test(ref) && !ref.includes('..') && !ref.startsWith('/');
}

const encodeSegments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

const trimBase = (url: string) => url.replace(/\/+$/, '');

export function githubContentsUrl(apiBaseUrl: string, repo: string, path: string, ref?: string): string {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return `${trimBase(apiBaseUrl)}/repos/${encodeSegments(repo)}/contents/${encodeSegments(path)}${query}`;
}

export function gitlabRawUrl(apiBaseUrl: string, repo: string, path: string, ref?: string): string {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return `${trimBase(apiBaseUrl)}/projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(path)}/raw${query}`;
}

export function bitbucketSrcUrl(apiBaseUrl: string, repo: string, commit: string, path: string): string {
  return `${trimBase(apiBaseUrl)}/repositories/${encodeSegments(repo)}/src/${encodeURIComponent(commit)}/${encodeSegments(path)}`;
}

export function bitbucketRefUrl(apiBaseUrl: string, repo: string, kind: 'branches' | 'tags', name: string): string {
  return `${trimBase(apiBaseUrl)}/repositories/${encodeSegments(repo)}/refs/${kind}/${encodeURIComponent(name)}`;
}

export function bitbucketRepoUrl(apiBaseUrl: string, repo: string): string {
  return `${trimBase(apiBaseUrl)}/repositories/${encodeSegments(repo)}`;
}

export type AzureVersionType = 'branch' | 'tag' | 'commit';

export function azureItemUrl(apiBaseUrl: string, repo: string, path: string, ref?: string, versionType: AzureVersionType = 'branch'): string {
  const [org, project, name] = repo.split('/');
  const query = new URLSearchParams({ path: `/${path}` });
  if (ref) {
    query.set('versionDescriptor.version', ref);
    query.set('versionDescriptor.versionType', versionType);
  }
  query.set('api-version', '7.1');
  return `${trimBase(apiBaseUrl)}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(name)}/items?${query}`;
}

const isCommitSha = (ref: string) => /^[0-9a-f]{40}$/i.test(ref);
export const azureVersionTypeFor = (ref: string): AzureVersionType => (isCommitSha(ref) ? 'commit' : 'branch');

export function swaggerhubApiUrl(apiBaseUrl: string, repo: string, version: string): string {
  // resolved=true inlines SwaggerHub domain references, which would otherwise be external URLs.
  return `${trimBase(apiBaseUrl)}/apis/${encodeSegments(repo)}/${encodeURIComponent(version)}?resolved=true`;
}

export function swaggerhubDefaultVersionUrl(apiBaseUrl: string, repo: string): string {
  return `${trimBase(apiBaseUrl)}/apis/${encodeSegments(repo)}/settings/default`;
}

// Azure's web UI marks the ref kind with a prefix: GB branch, GT tag, GC commit.
const AZURE_WEB_VERSION: Record<AzureVersionType, string> = { branch: 'GB', tag: 'GT', commit: 'GC' };

export function webFileUrl(
  provider: GitProvider,
  webBaseUrl: string,
  repo: string,
  path: string,
  ref?: string,
  azureVersionType?: AzureVersionType,
): string {
  const base = trimBase(webBaseUrl);
  const r = encodeSegments(ref || 'HEAD');
  switch (provider) {
    case 'github':
      return `${base}/${encodeSegments(repo)}/blob/${r}/${encodeSegments(path)}`;
    case 'gitlab':
      return `${base}/${encodeSegments(repo)}/-/blob/${r}/${encodeSegments(path)}`;
    case 'bitbucket':
      return `${base}/${encodeSegments(repo)}/src/${r}/${encodeSegments(path)}`;
    case 'azure': {
      const [org, project, name] = repo.split('/');
      const query = new URLSearchParams({ path: `/${path}` });
      if (ref) query.set('version', `${AZURE_WEB_VERSION[azureVersionType ?? azureVersionTypeFor(ref)]}${ref}`);
      return `${base}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(name)}?${query}`;
    }
    case 'swaggerhub':
      return `${base}/apis/${encodeSegments(repo)}${ref ? `/${encodeURIComponent(ref)}` : ''}`;
  }
}

export interface ParsedGitLink {
  provider: GitProvider;
  host: string;
  repo: string;
  /** Empty means the default branch (or SwaggerHub's default version). */
  ref: string;
  /** Empty for SwaggerHub. */
  path: string;
}

// Parse a pasted file link. Assumes the ref is one segment; branches with a
// slash in them need fixing by hand.
export function parseGitFileLink(link: string): ParsedGitLink | undefined {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  const host = url.host.toLowerCase();

  // https://app.swaggerhub.com/apis/{owner}/{api}/{version} (also apis-docs/)
  if (host.endsWith('swaggerhub.com') && (parts[0] === 'apis' || parts[0] === 'apis-docs') && parts.length >= 3) {
    return { provider: 'swaggerhub', host, repo: `${parts[1]}/${parts[2]}`, ref: parts[3] ?? '', path: '' };
  }

  // https://dev.azure.com/{org}/{project}/_git/{repo}?path=/openapi.yaml&version=GBmain
  if (host === 'dev.azure.com' && parts.length === 4 && parts[2] === '_git') {
    const path = (url.searchParams.get('path') ?? '').replace(/^\/+/, '');
    if (!path) return undefined;
    const version = url.searchParams.get('version') ?? '';
    // GB = branch, GT = tag, GC = commit
    const ref = /^G[BTC]/.test(version) ? version.slice(2) : '';
    return { provider: 'azure', host, repo: `${parts[0]}/${parts[1]}/${parts[3]}`, ref, path };
  }

  if (host === 'raw.githubusercontent.com' && parts.length >= 4) {
    const [owner, repo, ...rest] = parts;
    let ref = rest.shift() as string;
    if (ref === 'refs' && (rest[0] === 'heads' || rest[0] === 'tags') && rest.length >= 3) {
      rest.shift();
      ref = rest.shift() as string;
    }
    return { provider: 'github', host: 'github.com', repo: `${owner}/${repo}`, ref, path: rest.join('/') };
  }

  const gitlabMarker = parts.indexOf('-');
  if (gitlabMarker >= 2 && (parts[gitlabMarker + 1] === 'blob' || parts[gitlabMarker + 1] === 'raw')) {
    const repo = parts.slice(0, gitlabMarker).join('/');
    const rest = parts.slice(gitlabMarker + 2);
    if (rest.length < 2) return undefined;
    return { provider: 'gitlab', host, repo, ref: rest[0], path: rest.slice(1).join('/') };
  }

  if (host === 'bitbucket.org' && parts.length >= 5 && parts[2] === 'src') {
    return { provider: 'bitbucket', host, repo: `${parts[0]}/${parts[1]}`, ref: parts[3], path: parts.slice(4).join('/') };
  }

  if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'raw')) {
    return { provider: 'github', host, repo: `${parts[0]}/${parts[1]}`, ref: parts[3], path: parts.slice(4).join('/') };
  }

  return undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Pick the connection a pasted link belongs to: same provider, same web host,
 * and the repository is on its allow-list. The host has to match so a
 * github.com link never loads a same-named repo from an Enterprise server.
 */
export function matchConnection<T extends { provider: GitProvider; repos: string[]; webHost: string }>(link: ParsedGitLink, connections: T[]): T | undefined {
  return connections.find((c) => c.provider === link.provider && c.webHost === link.host && repoAllowed(link.repo, c.repos));
}

export function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * Advisory check (used for warnings in the UI): is `url` covered by one of
 * these approved host entries? Follows the rules of Forge's egress matcher,
 * which the backend uses for the real check: https only, entries may be a
 * bare host, an origin, or carry a path (ignored); a port must match; and
 * `*.example.com` covers subdomains but not example.com itself.
 */
export function hostCovered(url: string, entries: string[]): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:') return false;
  return entries.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry || entry === '*' || /^[a-z][a-z0-9+.-]*:\/\//.test(entry) && !entry.startsWith('https://')) return false;
    const hostPart = entry.replace(/^https:\/\//, '').split('/')[0];
    if (hostPart.startsWith('*.')) {
      const suffix = hostPart.slice(1);
      return target.host.endsWith(suffix) && target.host.length > suffix.length;
    }
    return target.host === hostPart;
  });
}
