import { describe, expect, it } from 'vitest';
import {
  bitbucketSrcUrl,
  githubContentsUrl,
  gitlabRawUrl,
  isValidRef,
  isValidRepo,
  normaliseRepoPath,
  parseGitFileLink,
  repoAllowed,
  webFileUrl,
} from '../src/shared/git';

describe('normaliseRepoPath', () => {
  it('normalises and keeps spec files', () => {
    expect(normaliseRepoPath('/api/./openapi.yaml')).toBe('api/openapi.yaml');
    expect(normaliseRepoPath('api/v1/../v2/spec.JSON')).toBe('api/v2/spec.JSON');
  });

  it('rejects traversal, backslashes and non-spec files', () => {
    expect(normaliseRepoPath('../secrets.yaml')).toBeUndefined();
    expect(normaliseRepoPath('a/../../b.yaml')).toBeUndefined();
    expect(normaliseRepoPath('api\\spec.yaml')).toBeUndefined();
    expect(normaliseRepoPath('.env')).toBeUndefined();
    expect(normaliseRepoPath('config/secrets.txt')).toBeUndefined();
    expect(normaliseRepoPath('')).toBeUndefined();
  });
});

describe('repository rules', () => {
  it('validates repository names per provider', () => {
    expect(isValidRepo('github', 'acme/api')).toBe(true);
    expect(isValidRepo('github', 'acme/group/api')).toBe(false);
    expect(isValidRepo('gitlab', 'acme/group/api')).toBe(true);
    expect(isValidRepo('github', 'acme/..')).toBe(false);
    expect(isValidRepo('bitbucket', 'ws/repo name')).toBe(false);
  });

  it('matches allow-list entries and wildcards case-insensitively', () => {
    expect(repoAllowed('Acme/API', ['acme/api'])).toBe(true);
    expect(repoAllowed('acme/payments', ['acme/*'])).toBe(true);
    expect(repoAllowed('acmeco/payments', ['acme/*'])).toBe(false);
    expect(repoAllowed('other/x', ['acme/*'])).toBe(false);
    expect(repoAllowed('any/thing', ['*'])).toBe(true);
    expect(repoAllowed('acme/api', [])).toBe(false);
  });

  it('validates refs', () => {
    expect(isValidRef('main')).toBe(true);
    expect(isValidRef('release/2.1')).toBe(true);
    expect(isValidRef('a..b')).toBe(false);
    expect(isValidRef('bad ref')).toBe(false);
  });
});

describe('API URL builders', () => {
  it('builds GitHub contents URLs with encoded segments', () => {
    expect(githubContentsUrl('https://api.github.com/', 'acme/api', 'docs/open api.yaml', 'release/1')).toBe(
      'https://api.github.com/repos/acme/api/contents/docs/open%20api.yaml?ref=release%2F1',
    );
    expect(githubContentsUrl('https://ghe.example.com/api/v3', 'acme/api', 'a.json')).toBe(
      'https://ghe.example.com/api/v3/repos/acme/api/contents/a.json',
    );
  });

  it('builds GitLab raw file URLs with fully encoded project and path', () => {
    expect(gitlabRawUrl('https://gitlab.com/api/v4', 'group/sub/proj', 'specs/api.yaml', 'main')).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fsub%2Fproj/repository/files/specs%2Fapi.yaml/raw?ref=main',
    );
  });

  it('builds Bitbucket src URLs', () => {
    expect(bitbucketSrcUrl('https://api.bitbucket.org/2.0', 'ws/repo', 'abc123', 'api/spec.yaml')).toBe(
      'https://api.bitbucket.org/2.0/repositories/ws/repo/src/abc123/api/spec.yaml',
    );
  });

  it('builds web links', () => {
    expect(webFileUrl('gitlab', 'https://gitlab.com', 'g/p', 'a.yaml', 'main')).toBe('https://gitlab.com/g/p/-/blob/main/a.yaml');
    expect(webFileUrl('github', 'https://github.com', 'o/r', 'a.yaml')).toBe('https://github.com/o/r/blob/HEAD/a.yaml');
  });
});

describe('parseGitFileLink', () => {
  it('parses GitHub blob and raw links', () => {
    expect(parseGitFileLink('https://github.com/acme/api/blob/main/docs/openapi.yaml')).toEqual({
      provider: 'github',
      host: 'github.com',
      repo: 'acme/api',
      ref: 'main',
      path: 'docs/openapi.yaml',
    });
    expect(parseGitFileLink('https://raw.githubusercontent.com/acme/api/refs/heads/dev/openapi.json')).toMatchObject({
      repo: 'acme/api',
      ref: 'dev',
      path: 'openapi.json',
    });
  });

  it('parses GitLab and Bitbucket links', () => {
    expect(parseGitFileLink('https://gitlab.example.com/group/sub/proj/-/blob/main/api/spec.yaml')).toMatchObject({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      repo: 'group/sub/proj',
      path: 'api/spec.yaml',
    });
    expect(parseGitFileLink('https://bitbucket.org/ws/repo/src/main/spec.yaml')).toMatchObject({ provider: 'bitbucket', repo: 'ws/repo' });
  });

  it('rejects non-https and unrelated links', () => {
    expect(parseGitFileLink('http://github.com/a/b/blob/main/x.yaml')).toBeUndefined();
    expect(parseGitFileLink('https://example.com/docs')).toBeUndefined();
    expect(parseGitFileLink('not a url')).toBeUndefined();
  });
});
