import type { GitProvider } from './types';

// Endpoints used:
//   GitHub/GHES: GET {api}/repos/{owner}/{repo}/contents/{path}?ref=  (Accept: application/vnd.github.raw+json)
//                GHES api base is https://HOST/api/v3
//   GitLab:      GET {api}/projects/{encoded project}/repository/files/{encoded path}/raw?ref=
//   Bitbucket:   GET {api}/repositories/{ws}/{repo}/src/{commit}/{path}
//                (commit must be a hash, so branch/tag names get looked up first)

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
};

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

export function isValidRepo(provider: GitProvider, repo: string): boolean {
  const segments = repo.split('/');
  if (segments.some((s) => !REPO_SEGMENT.test(s) || s === '.' || s === '..')) return false;
  return provider === 'gitlab' ? segments.length >= 2 : segments.length === 2;
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

export function isValidRef(ref: string): boolean {
  return ref.length <= 255 && /^[A-Za-z0-9._\-/]+$/.test(ref) && !ref.includes('..') && !ref.startsWith('/');
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

export function webFileUrl(provider: GitProvider, webBaseUrl: string, repo: string, path: string, ref?: string): string {
  const base = trimBase(webBaseUrl);
  const r = encodeSegments(ref || 'HEAD');
  switch (provider) {
    case 'github':
      return `${base}/${encodeSegments(repo)}/blob/${r}/${encodeSegments(path)}`;
    case 'gitlab':
      return `${base}/${encodeSegments(repo)}/-/blob/${r}/${encodeSegments(path)}`;
    case 'bitbucket':
      return `${base}/${encodeSegments(repo)}/src/${r}/${encodeSegments(path)}`;
  }
}

export interface ParsedGitLink {
  provider: GitProvider;
  host: string;
  repo: string;
  ref: string;
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
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const host = url.host.toLowerCase();

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

export function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
