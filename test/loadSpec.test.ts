import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call, ROOT_YAML, PAYMENT_YAML, SIMPLE_YAML, ASYNC_YAML, seedGithub, gitConfig, decode } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

import { exportHandler } from '../src/index';

beforeEach(resetForge);

describe('loadSpec from Git', () => {
  it('bundles relative $refs, authenticates, and caches', async () => {
    await seedGithub();
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/contents/api/openapi.yaml?ref=main')) return response(200, ROOT_YAML);
      if (url.endsWith('/contents/api/schemas/payment.yaml?ref=main')) return response(200, PAYMENT_YAML);
      return response(404, 'nope');
    });

    const first = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(first.ok).toBe(true);
    expect(first.value.summary.title).toBe('Payments');
    expect(first.value.meta.fileCount).toBe(2);
    expect(first.value.meta.fromCache).toBe(false);
    expect(first.value.meta.sourceLink).toBe('https://github.com/acme/payments/blob/main/api/openapi.yaml');
    const spec = decode(first.value.specGz);
    expect(spec.paths['/payments'].get.responses['200'].content['application/json'].schema).toEqual({ type: 'object', properties: { id: { type: 'string' } } });
    expect(JSON.stringify(spec)).not.toContain('payment.yaml');
    expect(first.value.spec).toBeUndefined();

    const [, init] = h.fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer ghp_secret', Accept: 'application/vnd.github.raw+json' });

    h.fetchMock.mockClear();
    const second = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(second.value.meta.fromCache).toBe(true);
    expect(h.fetchMock).not.toHaveBeenCalled();

    // Anonymous visitors cannot force a refresh past the cache.
    const anon = await call('loadSpec', { refresh: true }, { account: 'anonymous', extension: { config: gitConfig } });
    expect(anon.value.meta.fromCache).toBe(true);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('never returns the token to the browser', async () => {
    await seedGithub();
    h.fetchMock.mockResolvedValue(response(200, ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }')));
    const res = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(JSON.stringify(res)).not.toContain('ghp_secret');
  });

  it('enforces the repository allow-list and space restrictions', async () => {
    await seedGithub({ repos: ['acme/payments'], spaceKeys: ['OPS'] });
    const space = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(space.error?.code).toBe('FORBIDDEN');

    await seedGithub({ repos: ['acme/payments'] });
    const repo = await call('loadSpec', {}, { extension: { config: { ...gitConfig, gitRepo: 'acme/secrets' } } });
    expect(repo.error?.code).toBe('FORBIDDEN');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('blocks $refs that escape the repository or point at non-spec files', async () => {
    await seedGithub();
    h.fetchMock.mockResolvedValue(response(200, ROOT_YAML.replace('./schemas/payment.yaml', '../../.env')));
    const res = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(res.ok).toBe(false);
    expect(['BAD_REQUEST', 'INVALID_SPEC']).toContain(res.error?.code);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses external https $refs while URL sources are disabled', async () => {
    await seedGithub();
    h.fetchMock.mockResolvedValue(response(200, ROOT_YAML.replace('./schemas/payment.yaml', 'https://evil.example.com/x.yaml')));
    const res = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(res.error?.code).toBe('SOURCE_DISABLED');
  });

  it('reports hosts that an admin has not approved', async () => {
    await seedGithub();
    h.fetchMock.mockRejectedValue(new h.NotAllowedError('URL not included in the external fetch backend permissions'));
    const res = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(res.error).toMatchObject({ code: 'EGRESS_NOT_APPROVED', key: 'errors.egressNotApproved', params: { host: 'api.github.com' }, hintKey: 'hints.askAdminApproveHost' });
    expect(res.error?.message).toContain('api.github.com');
  });

  it('follows redirects but only sends the token to the original host', async () => {
    await seedGithub();
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('https://api.github.com/repos/acme/payments/')) return response(301, '', { Location: 'https://api.github.com/repositories/42/contents/api/openapi.yaml' });
      if (url.startsWith('https://api.github.com/repositories/42/')) return response(302, '', { Location: 'https://files.example.com/openapi.yaml' });
      if (url === 'https://files.example.com/openapi.yaml') return response(200, SIMPLE_YAML);
      return response(404, 'nope');
    });
    const res = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(res.ok).toBe(true);
    const calls = h.fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), auth: init.headers.Authorization, redirect: init.redirect }));
    expect(calls.every((c) => c.redirect === 'manual')).toBe(true);
    expect(calls.slice(0, 3).map((c) => c.auth)).toEqual(['Bearer ghp_secret', 'Bearer ghp_secret', undefined]);
  });

  it('refuses a redirect away from https', async () => {
    await seedGithub();
    h.fetchMock.mockResolvedValue(response(302, '', { Location: 'http://api.github.com/plain' }));
    const res = await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect(res.error?.key).toBe('errors.redirectNotHttps');
  });

  it('checks Bitbucket hex-looking names as branches before treating them as commits', async () => {
    await h.memory.kvs.set('connections', [
      { id: 'b1', name: 'BB', provider: 'bitbucket', apiBaseUrl: 'https://api.bitbucket.org/2.0', webBaseUrl: 'https://bitbucket.org', authType: 'none', repos: ['ws/*'], spaceKeys: [], hasToken: false, createdAt: 'x', updatedAt: 'x' },
    ]);
    const simple = ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }');
    const load = (gitRef: string) => call('loadSpec', {}, { extension: { config: { sourceType: 'git', gitConnectionId: 'b1', gitRepo: 'ws/api', gitRef, gitPath: 'openapi.yaml' } } });

    // A branch called "deadbeef" resolves to its head commit.
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/refs/branches/deadbeef')) return response(200, { target: { hash: 'f'.repeat(40) } });
      if (url.endsWith(`/src/${'f'.repeat(40)}/openapi.yaml`)) return response(200, simple);
      return response(404, 'nope');
    });
    expect((await load('deadbeef')).ok).toBe(true);

    // No branch or tag with that name: treated as a short commit hash.
    h.fetchMock.mockReset();
    h.fetchMock.mockImplementation(async (url: string) => (url.endsWith('/src/abc1234/openapi.yaml') ? response(200, simple) : response(404, 'nope')));
    expect((await load('abc1234')).ok).toBe(true);

    // A full hash skips the lookups.
    h.fetchMock.mockReset();
    h.fetchMock.mockImplementation(async (url: string) => (url.includes('/src/') ? response(200, simple) : response(404, 'nope')));
    expect((await load('a'.repeat(40))).ok).toBe(true);
    expect(h.fetchMock.mock.calls.every(([url]) => String(url).includes('/src/'))).toBe(true);
  });

  it('resolves Bitbucket branch names to commits', async () => {
    await h.memory.kvs.set('connections', [
      { id: 'b1', name: 'BB', provider: 'bitbucket', apiBaseUrl: 'https://api.bitbucket.org/2.0', webBaseUrl: 'https://bitbucket.org', authType: 'bearer', repos: ['ws/*'], spaceKeys: [], hasToken: true, createdAt: 'x', updatedAt: 'x' },
    ]);
    await h.memory.kvs.setSecret('connection-token:b1', 'bb-token');
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/repositories/ws/api/refs/branches/develop')) return response(200, { target: { hash: 'abc123def' } });
      if (url.endsWith('/repositories/ws/api/src/abc123def/openapi.yaml')) {
        return response(200, ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }'));
      }
      return response(404, 'nope');
    });
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'git', gitConnectionId: 'b1', gitRepo: 'ws/api', gitRef: 'develop', gitPath: 'openapi.yaml' } } });
    expect(res.ok).toBe(true);
  });
});

describe('loadSpec from attachments', () => {
  const attachmentConfig = { sourceType: 'attachment', attachment: 'openapi.yaml' };
  const confluence = async (path: string) => {
    if (path.includes('/attachments?filename=openapi.yaml')) return response(200, { results: [{ id: 'att9', title: 'openapi.yaml', fileSize: 400 }] });
    if (path.includes('/child/attachment/att9/download')) return response(200, ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }'));
    return response(404, {});
  };

  it('reads as the user for licensed users', async () => {
    h.userConfluence.mockImplementation(confluence);
    const res = await call('loadSpec', {}, { extension: { config: attachmentConfig } });
    expect(res.ok).toBe(true);
    expect(h.userConfluence).toHaveBeenCalled();
    expect(h.appConfluence).not.toHaveBeenCalled();
    expect(h.userConfluence.mock.calls[0][0]).toContain('/wiki/api/v2/pages/123/attachments');
  });

  it('reads as the app, scoped to the current page, for anonymous visitors', async () => {
    h.appConfluence.mockImplementation(confluence);
    const res = await call('loadSpec', {}, { account: 'anonymous', extension: { config: attachmentConfig } });
    expect(res.ok).toBe(true);
    expect(h.userConfluence).not.toHaveBeenCalled();
    expect(h.appConfluence.mock.calls.every((args) => String(args[0]).includes('/123/'))).toBe(true);
  });

  it('explains a missing attachment', async () => {
    h.userConfluence.mockResolvedValue(response(200, { results: [] }));
    const res = await call('loadSpec', {}, { extension: { config: attachmentConfig } });
    expect(res.error?.code).toBe('NOT_FOUND');
    expect(res.error?.message).toContain('openapi.yaml');
  });
});

describe('access rules', () => {
  it('rejects unsaved preview config from non-licensed users', async () => {
    const res = await call('loadSpec', { preview: { sourceType: 'inline', inlineSpec: ROOT_YAML } }, { account: 'anonymous' });
    expect(res.error?.code).toBe('FORBIDDEN');
  });

  it('renders inline previews for editors', async () => {
    const inline = ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }');
    const res = await call('loadSpec', { preview: { sourceType: 'inline', inlineSpec: inline } });
    expect(res.ok).toBe(true);
  });

  it('stops when the subscription is inactive', async () => {
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'inline', inlineSpec: ROOT_YAML } }, license: { active: false } });
    expect(res.error?.code).toBe('LICENSE_INACTIVE');
  });

  it('asks for configuration when the macro is new', async () => {
    const res = await call('loadSpec', {});
    expect(res.error?.code).toBe('NOT_CONFIGURED');
  });
});

describe('PDF / Word export', () => {
  it('returns an endpoint table', async () => {
    const adf = (await exportHandler({
      exportType: 'pdf',
      config: { sourceType: 'inline', inlineSpec: ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }') } as never,
      context: { extension: { content: { id: '123', type: 'page' } } },
    })) as { type: string; content: Array<{ type: string }> };
    expect(adf.type).toBe('doc');
    expect(adf.content.map((n) => n.type)).toEqual(['heading', 'table', 'paragraph']);
  });

  it('returns a warning panel instead of failing the export', async () => {
    const adf = (await exportHandler({ exportType: 'pdf', config: {}, context: {} })) as { content: Array<{ type: string }> };
    expect(adf.content[0].type).toBe('panel');
  });
});

describe('relative server URLs', () => {
  const relativeSpec = ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }').replace('paths:', "servers:\n  - url: /v1\npaths:");

  it('warns "Try it out" users when servers cannot be resolved', async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true });
    const config = { sourceType: 'inline', inlineSpec: relativeSpec, tryItOut: true };
    const res = await call('loadSpec', {}, { extension: { config } });
    expect(res.value.meta.serversResolvable).toBe(false);
    expect(res.value.meta.warnings.map((w: { key: string }) => w.key)).toContain('warnings.relativeServers');

    // A server URL in the macro settings fixes it, so no warning.
    const fixed = await call('loadSpec', {}, { extension: { config: { ...config, serverUrl: 'https://api.example.com' } } });
    expect(fixed.value.meta.warnings.map((w: { key: string }) => w.key)).not.toContain('warnings.relativeServers');

    // Readers without Try it out don't need to hear about it.
    const reader = await call('loadSpec', {}, { account: 'anonymous', extension: { config } });
    expect(reader.value.meta.warnings).toEqual([]);
  });

  it('resolves them against the spec URL for URL sources', async () => {
    await h.memory.kvs.set('settings', { urlSourcesEnabled: true });
    h.fetchMock.mockResolvedValue(response(200, relativeSpec));
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'url', url: 'https://docs.example.com/specs/openapi.yaml' } } });
    expect(res.ok).toBe(true);
    expect(res.value.meta.serversResolvable).toBe(true);
    expect(decode(res.value.specGz).servers).toEqual([{ url: 'https://docs.example.com/v1' }]);
    expect(res.value.meta.warnings).toContainEqual(expect.objectContaining({ key: 'warnings.serversResolved', params: { base: 'https://docs.example.com' } }));
  });

  it('applies the server override to PDF exports', async () => {
    const adf = (await exportHandler({
      exportType: 'pdf',
      config: { sourceType: 'inline', inlineSpec: relativeSpec, serverUrl: 'https://staging.example.com' } as never,
      context: { extension: { content: { id: '123', type: 'page' } } },
    })) as unknown;
    expect(JSON.stringify(adf)).toContain('https://staging.example.com');
    expect(JSON.stringify(adf)).not.toContain('"/v1"');
  });
});

describe('Azure DevOps connections', () => {
  beforeEach(async () => {
    await h.memory.kvs.set('connections', [
      { id: 'a1', name: 'Contoso', provider: 'azure', apiBaseUrl: 'https://dev.azure.com', webBaseUrl: 'https://dev.azure.com', authType: 'pat', repos: ['contoso/*'], spaceKeys: [], hasToken: true, createdAt: 'x', updatedAt: 'x' },
    ]);
    await h.memory.kvs.setSecret('connection-token:a1', 'pat-secret');
  });
  const config = { sourceType: 'git', gitConnectionId: 'a1', gitRepo: 'contoso/Fabrikam Fiber/payments', gitRef: 'v2.0', gitPath: 'api/openapi.yaml' };

  it('sends the PAT as Basic auth and falls back from branch to tag once', async () => {
    h.fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get('versionDescriptor.versionType') === 'branch') return response(404, 'TF401175: The version descriptor could not be resolved');
      if (u.searchParams.get('path') === '/api/openapi.yaml') return response(200, ROOT_YAML);
      if (u.searchParams.get('path') === '/api/schemas/payment.yaml') return response(200, PAYMENT_YAML);
      return response(404, 'nope');
    });
    const res = await call('loadSpec', {}, { extension: { config } });
    expect(res.ok).toBe(true);
    expect(res.value.meta.fileCount).toBe(2);
    const urls = h.fetchMock.mock.calls.map(([url]) => new URL(url as string));
    // branch (404), then tag for the root, then tag straight away for the $ref
    expect(urls.map((u) => u.searchParams.get('versionDescriptor.versionType'))).toEqual(['branch', 'tag', 'tag']);
    expect(urls[0].pathname).toBe('/contoso/Fabrikam%20Fiber/_apis/git/repositories/payments/items');
    const [, init] = h.fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(':pat-secret').toString('base64')}`);
    // v2.0 turned out to be a tag, so the web link uses GT, also when served from cache.
    const tagLink = 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/payments?path=%2Fapi%2Fopenapi.yaml&version=GTv2.0';
    expect(res.value.meta.sourceLink).toBe(tagLink);
    const cached = await call('loadSpec', {}, { extension: { config } });
    expect(cached.value.meta.fromCache).toBe(true);
    expect(cached.value.meta.sourceLink).toBe(tagLink);
  });

  it('treats a full SHA as a commit', async () => {
    h.fetchMock.mockResolvedValue(response(200, SIMPLE_YAML));
    const sha = 'a'.repeat(40);
    await call('loadSpec', {}, { extension: { config: { ...config, gitRef: sha } } });
    expect(new URL(h.fetchMock.mock.calls[0][0] as string).searchParams.get('versionDescriptor.versionType')).toBe('commit');
  });

  it('only allows PAT or no auth for Azure connections', async () => {
    h.userConfluence.mockImplementation(async () => response(200, { operations: [{ operation: 'administer', targetType: 'application' }] }));
    const base = { name: 'Contoso', provider: 'azure', apiBaseUrl: 'https://dev.azure.com', webBaseUrl: 'https://dev.azure.com', repos: ['contoso/Fabrikam Fiber/*'], spaceKeys: [], token: 'pat' };
    expect((await call('adminSaveConnection', { connection: { ...base, authType: 'pat' } })).ok).toBe(true);
    expect((await call('adminSaveConnection', { connection: { ...base, authType: 'bearer' } })).error?.code).toBe('BAD_REQUEST');
  });
});

describe('SwaggerHub connections', () => {
  beforeEach(async () => {
    await h.memory.kvs.set('connections', [
      { id: 's1', name: 'SwaggerHub', provider: 'swaggerhub', apiBaseUrl: 'https://api.swaggerhub.com', webBaseUrl: 'https://app.swaggerhub.com', authType: 'bearer', repos: ['acme/*'], spaceKeys: [], hasToken: true, createdAt: 'x', updatedAt: 'x' },
    ]);
    await h.memory.kvs.setSecret('connection-token:s1', 'sh-key');
  });

  it('looks up the default version and asks for the resolved definition', async () => {
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://api.swaggerhub.com/apis/acme/payments/settings/default') return response(200, { version: '2.1.0' });
      if (url === 'https://api.swaggerhub.com/apis/acme/payments/2.1.0?resolved=true') return response(200, JSON.stringify({ openapi: '3.0.3', info: { title: 'Payments', version: '2.1.0' }, paths: {} }));
      return response(404, 'nope');
    });
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'git', gitConnectionId: 's1', gitRepo: 'acme/payments' } } });
    expect(res.ok).toBe(true);
    expect(res.value.summary.version).toBe('2.1.0');
    expect(res.value.meta.sourceLink).toBe('https://app.swaggerhub.com/apis/acme/payments');
    for (const [, init] of h.fetchMock.mock.calls) expect(init.headers.Authorization).toBe('Bearer sh-key');
  });

  it('skips the lookup when a version is set', async () => {
    h.fetchMock.mockResolvedValue(response(200, JSON.stringify({ openapi: '3.0.3', info: { title: 'Payments', version: '1.0.0' }, paths: {} })));
    await call('loadSpec', {}, { extension: { config: { sourceType: 'git', gitConnectionId: 's1', gitRepo: 'acme/payments', gitRef: '1.0.0' } } });
    expect(h.fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://api.swaggerhub.com/apis/acme/payments/1.0.0?resolved=true']);
  });
});

describe('pasted links (macro autoconvert)', () => {
  const link = 'https://github.com/acme/payments/blob/main/api/openapi.yaml';

  it('shows the linked spec before the macro is configured, without listing it', async () => {
    await seedGithub();
    h.fetchMock.mockResolvedValue(response(200, SIMPLE_YAML));
    const res = await call('loadSpec', {}, { extension: { config: {}, autoConvertLink: link } });
    expect(res.ok).toBe(true);
    expect(res.value.meta.autoConverted).toEqual({ sourceType: 'git', gitConnectionId: 'c1', gitRepo: 'acme/payments', gitRef: 'main', gitPath: 'api/openapi.yaml' });
    expect(h.fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/payments/contents/api/openapi.yaml?ref=main');
    expect([...h.memory.values.keys()].filter((k) => k.startsWith('api:'))).toEqual([]);
  });

  it('explains when no connection covers the link', async () => {
    await seedGithub({ repos: ['other/*'] });
    const res = await call('loadSpec', {}, { extension: { config: {}, autoConvertLink: link } });
    expect(res.error).toMatchObject({ code: 'NOT_CONFIGURED', key: 'errors.autoConvertNoConnection', params: { repo: 'acme/payments', host: 'github.com' } });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('respects space restrictions', async () => {
    await seedGithub({ spaceKeys: ['OPS'] });
    const res = await call('loadSpec', {}, { extension: { config: {}, autoConvertLink: link } });
    expect(res.error?.key).toBe('errors.autoConvertNoConnection');
  });

  it('uses saved settings once there are some', async () => {
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'inline', inlineSpec: SIMPLE_YAML }, autoConvertLink: link } });
    expect(res.value.meta.autoConverted).toBeUndefined();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

describe('AsyncAPI', () => {
  it('parses on the backend and sends the stringified document', async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true });
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'inline', inlineSpec: ASYNC_YAML, tryItOut: true } } });
    expect(res.ok).toBe(true);
    expect(res.value.summary.kind).toBe('asyncapi-3');
    expect(res.value.summary.operations.map((o: { method: string; path: string }) => `${o.method} ${o.path}`)).toEqual(['SEND user/signedup']);
    expect(res.value.tryItOutAllowed).toBe(false);
    const doc = decode(res.value.specGz);
    expect(doc['x-parser-spec-stringified']).toBe(true);
    expect(doc.info.title).toBe('Account Service');
  }, 20_000);

  it('reports validation errors with their location', async () => {
    const broken = ASYNC_YAML.replace("channel: { $ref: '#/channels/userSignedup' }", 'channel: 42');
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'inline', inlineSpec: broken } } });
    expect(res.error).toMatchObject({ code: 'INVALID_SPEC', key: 'errors.asyncapiInvalid' });
    expect(res.error?.detail).toContain('operations');
  }, 20_000);

  it('exports channels and operations to PDF', async () => {
    const adf = await exportHandler({ exportType: 'pdf', config: { sourceType: 'inline', inlineSpec: ASYNC_YAML } as never, context: { extension: { content: { id: '123', type: 'page' } } } });
    expect(JSON.stringify(adf)).toContain('user/signedup');
  }, 20_000);
});

describe('editing attachments from the macro settings', () => {
  const confluence = (fileSize: number) => async (path: string) => {
    if (path.includes('/attachments?')) return response(200, { results: [{ id: 'att9', title: 'openapi.yaml', fileSize, version: { number: 4 } }] });
    if (path.includes('/download')) return response(200, SIMPLE_YAML);
    return response(404, {});
  };

  it('returns the raw text and version to licensed users', async () => {
    h.userConfluence.mockImplementation(confluence(400));
    const res = await call('readAttachment', { filename: 'openapi.yaml' });
    expect(res.value).toEqual({ text: SIMPLE_YAML, version: 4 });
    const list = await call('listAttachments', {});
    expect(list.value[0]).toMatchObject({ title: 'openapi.yaml', version: 4 });
  });

  it('lists spec attachments beyond the first page', async () => {
    h.userConfluence.mockImplementation(async (path: string) => {
      if (path.includes('cursor=page2')) return response(200, { results: [{ id: 'a2', title: 'zeta.yaml', version: { number: 1 } }] });
      return response(200, {
        results: [{ id: 'a1', title: 'alpha.json', version: { number: 2 } }, { id: 'x', title: 'photo.png' }],
        // A hostile or odd next link only contributes its cursor; the path is rebuilt.
        _links: { next: '/wiki/api/v2/pages/999/attachments?cursor=page2&limit=250' },
      });
    });
    const list = await call('listAttachments', {});
    expect(list.value.map((a: { title: string }) => a.title)).toEqual(['alpha.json', 'zeta.yaml']);
    const paths = h.userConfluence.mock.calls.map(([p]) => String(p));
    expect(paths[1]).toBe('/wiki/api/v2/pages/123/attachments?limit=250&cursor=page2');
  });

  it('refuses guests and files too big to edit', async () => {
    expect((await call('readAttachment', { filename: 'openapi.yaml' }, { account: 'anonymous' })).error?.code).toBe('FORBIDDEN');
    h.userConfluence.mockImplementation(confluence(3_000_000));
    expect((await call('readAttachment', { filename: 'openapi.yaml' })).error?.key).toBe('errors.editTooLarge');
  });
});
