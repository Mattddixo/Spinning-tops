import { describe, expect, it } from 'vitest';
import type { ConnectionOption, MacroConfig } from '../../../src/shared/types';
import { cleanConfig, isHttpsUrl, MAX_INLINE, sourceKey, validateSource } from '../src/config/logic';
import { t } from './helpers/i18n';

const connections = [
  { id: 'gh', name: 'GitHub', provider: 'github' },
  { id: 'sh', name: 'SwaggerHub', provider: 'swaggerhub' },
] as ConnectionOption[];

const validate = (config: MacroConfig) => validateSource(t, config, connections, 'en_US');

describe('isHttpsUrl', () => {
  it('accepts https URLs with a host and nothing else', () => {
    expect(isHttpsUrl(' https://api.example.com/openapi.yaml ')).toBe(true);
    expect(isHttpsUrl('HTTPS://example.com')).toBe(true);
    expect(isHttpsUrl('http://example.com')).toBe(false);
    expect(isHttpsUrl('https:///path')).toBe(false);
    expect(isHttpsUrl('https://exa mple.com')).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
  });
});

describe('cleanConfig', () => {
  it('keeps only the fields for the chosen source, trimmed', () => {
    const config: MacroConfig = {
      sourceType: 'git',
      gitConnectionId: 'gh',
      gitRepo: ' acme/api ',
      gitRef: '',
      gitPath: ' openapi.yaml',
      url: 'https://left.over.example.com',
      attachment: 'old.yaml',
      inlineSpec: 'openapi: 3.0.0',
    };
    expect(cleanConfig(config)).toEqual({ sourceType: 'git', gitConnectionId: 'gh', gitRepo: 'acme/api', gitPath: 'openapi.yaml' });
  });

  it('drops empty values, which Forge rejects, but keeps false booleans', () => {
    const config = {
      sourceType: 'url',
      url: 'https://example.com/a.json',
      title: '  ',
      serverUrl: undefined,
      includeTags: [],
      includePaths: null,
      showModels: false,
      tryItOut: true,
      maxHeight: 0,
      docExpansion: 'none',
    } as unknown as MacroConfig;
    expect(cleanConfig(config)).toEqual({ sourceType: 'url', url: 'https://example.com/a.json', showModels: false, tryItOut: true, docExpansion: 'none' });
  });

  it('keeps a positive max height and the search text', () => {
    expect(cleanConfig({ sourceType: 'attachment', attachment: 'a.yaml', maxHeight: 600, searchText: 'pets' })).toEqual({
      sourceType: 'attachment',
      attachment: 'a.yaml',
      maxHeight: 600,
      searchText: 'pets',
    });
  });
});

describe('validateSource', () => {
  it('asks for a source first', () => {
    expect(validate({})).toBe('Choose where the spec comes from.');
  });

  it('checks attachments', () => {
    expect(validate({ sourceType: 'attachment' })).toBe('Choose an attachment.');
    expect(validate({ sourceType: 'attachment', attachment: 'openapi.yaml' })).toBeUndefined();
  });

  it('checks Git connection, repository, ref and path in that order', () => {
    expect(validate({ sourceType: 'git', gitConnectionId: 'missing' })).toBe('Choose a Git connection.');
    expect(validate({ sourceType: 'git', gitConnectionId: 'gh', gitRepo: 'no-owner' })).toBe('Enter a repository like owner/repository.');
    expect(validate({ sourceType: 'git', gitConnectionId: 'gh', gitRepo: 'acme/api', gitRef: 'bad ref' })).toBe(
      "The branch, tag or commit has characters that aren't allowed.",
    );
    expect(validate({ sourceType: 'git', gitConnectionId: 'gh', gitRepo: 'acme/api' })).toBe('Enter the path to a .yaml, .yml or .json file.');
    expect(validate({ sourceType: 'git', gitConnectionId: 'gh', gitRepo: 'acme/api', gitRef: 'main', gitPath: 'docs/openapi.yaml' })).toBeUndefined();
  });

  it('needs no file path for SwaggerHub', () => {
    expect(validate({ sourceType: 'git', gitConnectionId: 'sh', gitRepo: 'acme/petstore' })).toBeUndefined();
  });

  it('only accepts https URLs', () => {
    expect(validate({ sourceType: 'url', url: 'http://example.com/a.yaml' })).toBe('Enter a URL starting with https://');
    expect(validate({ sourceType: 'url', url: 'https://example.com/a.yaml' })).toBeUndefined();
  });

  it('limits pasted specs and formats the limit for the locale', () => {
    expect(validate({ sourceType: 'inline', inlineSpec: '  ' })).toBe('Paste an OpenAPI or Swagger document.');
    expect(validate({ sourceType: 'inline', inlineSpec: 'x'.repeat(MAX_INLINE) })).toBeUndefined();
    expect(validate({ sourceType: 'inline', inlineSpec: 'x'.repeat(MAX_INLINE + 1) })).toBe('Pasted specs are limited to 100,000 characters.');
  });
});

describe('sourceKey', () => {
  it('changes with the source but not with display settings', () => {
    const base: MacroConfig = { sourceType: 'url', url: 'https://example.com/a.yaml' };
    expect(sourceKey({ ...base, title: 'Docs', showModels: false })).toBe(sourceKey(base));
    expect(sourceKey({ ...base, url: 'https://example.com/b.yaml' })).not.toBe(sourceKey(base));
  });
});
