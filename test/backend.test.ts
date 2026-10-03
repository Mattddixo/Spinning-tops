import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKvs } from './helpers/memoryKvs';

const h = vi.hoisted(() => {
  class NotAllowedError extends Error {}
  return {
    memory: undefined as unknown as ReturnType<typeof import('./helpers/memoryKvs').createMemoryKvs>,
    fetchMock: vi.fn(),
    userConfluence: vi.fn(),
    appConfluence: vi.fn(),
    NotAllowedError,
  };
});

vi.mock('@forge/kvs', async () => {
  const actual = await vi.importActual<typeof import('@forge/kvs')>('@forge/kvs');
  return {
    WhereConditions: actual.WhereConditions,
    get kvs() {
      return h.memory.kvs;
    },
  };
});

// The real `route` is kept so the tests see the same escaping Forge does.
vi.mock('@forge/api', async () => {
  const actual = await vi.importActual<typeof import('@forge/api')>('@forge/api');
  return {
    route: actual.route,
    fetch: (...args: unknown[]) => h.fetchMock(...args),
    asUser: () => ({ requestConfluence: (path: { value: string }, init: unknown) => h.userConfluence(path.value, init) }),
    asApp: () => ({ requestConfluence: (path: { value: string }, init: unknown) => h.appConfluence(path.value, init) }),
    NotAllowedError: h.NotAllowedError,
  };
});

import { exportHandler, handler } from '../src/index';

const decode = (specGz: string) => JSON.parse(gunzipSync(Buffer.from(specGz, 'base64')).toString('utf8'));

function response(status: number, body: string | object | Buffer, headers: Record<string, string> = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const text = bytes.toString('utf8');
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { forEach: (cb: (v: string, k: string) => void) => map.forEach((v, k) => cb(v, k)), get: (k: string) => map.get(k.toLowerCase()) ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

type Account = 'licensed' | 'unlicensed' | 'anonymous';

async function call(
  functionKey: string,
  payload: unknown,
  opts: { account?: Account; extension?: Record<string, unknown>; license?: unknown; localId?: string } = {},
) {
  const account = opts.account ?? 'licensed';
  const accountId = account === 'anonymous' ? undefined : 'user-1';
  return handler(
    {
      call: { functionKey, payload: payload as Record<string, unknown> },
      context: {
        accountType: account,
        localId: opts.localId ?? 'macro-1',
        extension: { type: 'macro', content: { id: '123', type: 'page' }, space: { key: 'ENG', id: '777' }, ...opts.extension },
      },
    } as never,
    { principal: { accountId }, license: opts.license },
  ) as Promise<{ ok: boolean; value?: any; error?: { code: string; message: string; key?: string; params?: Record<string, unknown>; hintKey?: string; detail?: string } }>;
}

const ROOT_YAML = `openapi: 3.0.3
info: { title: Payments, version: '2.0' }
paths:
  /payments:
    get:
      summary: List payments
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: './schemas/payment.yaml' }
`;
const PAYMENT_YAML = `type: object
properties:
  id: { type: string }
`;

async function seedGithub(extra: Partial<Record<string, unknown>> = {}) {
  await h.memory.kvs.set('connections', [
    {
      id: 'c1',
      name: 'GitHub',
      provider: 'github',
      apiBaseUrl: 'https://api.github.com',
      webBaseUrl: 'https://github.com',
      authType: 'bearer',
      repos: ['acme/*'],
      spaceKeys: [],
      hasToken: true,
      createdAt: 'x',
      updatedAt: 'x',
      ...extra,
    },
  ]);
  await h.memory.kvs.setSecret('connection-token:c1', 'ghp_secret');
}

const gitConfig = { sourceType: 'git', gitConnectionId: 'c1', gitRepo: 'acme/payments', gitRef: 'main', gitPath: 'api/openapi.yaml' };

beforeEach(() => {
  h.memory = createMemoryKvs();
  h.fetchMock.mockReset();
  h.userConfluence.mockReset();
  h.appConfluence.mockReset();
});

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

describe('Try it out proxy', () => {
  const request = {
    url: 'https://api.example.com/v1/payments',
    method: 'post',
    headers: { Authorization: 'Bearer k', Cookie: 'session=1', Host: 'evil', 'Content-Type': 'application/json', 'X-Multi': 'a\r\nb' },
    body: '{"amount":1}',
  };
  const config = { sourceType: 'inline', tryItOut: true };

  it('is off until an admin enables it', async () => {
    const res = await call('proxyRequest', { request }, { extension: { config } });
    expect(res.error?.code).toBe('SOURCE_DISABLED');
  });

  it('requires the macro option and a licensed user', async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true });
    expect((await call('proxyRequest', { request }, { extension: { config: { tryItOut: false } } })).error?.code).toBe('SOURCE_DISABLED');
    expect((await call('proxyRequest', { request }, { account: 'unlicensed', extension: { config } })).error?.code).toBe('FORBIDDEN');
  });

  it('strips unsafe headers and does not follow redirects', async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true });
    h.fetchMock.mockResolvedValue(response(201, '{"id":"p1"}', { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1' }));
    const res = await call('proxyRequest', { request }, { extension: { config } });
    expect(res.ok).toBe(true);
    expect(res.value.status).toBe(201);
    expect(res.value.headers['set-cookie']).toBeUndefined();
    const [url, init] = h.fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/payments');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers).toEqual({ Authorization: 'Bearer k', 'Content-Type': 'application/json', 'X-Multi': 'a b' });
  });

  it('rejects non-https URLs and unknown methods', async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true });
    expect((await call('proxyRequest', { request: { ...request, url: 'http://api.example.com' } }, { extension: { config } })).error?.code).toBe('BAD_REQUEST');
    expect((await call('proxyRequest', { request: { ...request, method: 'CONNECT' } }, { extension: { config } })).error?.code).toBe('BAD_REQUEST');
  });
});

describe('admin', () => {
  const admin = () => response(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
  const nonAdmin = () => response(200, { operations: [{ operation: 'create', targetType: 'page' }] });
  const input = {
    name: 'Acme GitHub',
    provider: 'github',
    apiBaseUrl: 'https://api.github.com/',
    webBaseUrl: 'https://github.com',
    authType: 'bearer',
    repos: ['acme/*', 'acme/*', ' '],
    spaceKeys: ['ENG', '~jdoe'],
    token: 'ghp_new',
  };

  it('requires a Confluence administrator', async () => {
    h.userConfluence.mockImplementation(async () => nonAdmin());
    expect((await call('adminGetState', {})).error?.code).toBe('FORBIDDEN');
    expect((await call('adminSaveSettings', { settings: { tryItOutEnabled: true } }, { account: 'anonymous' })).error?.code).toBe('FORBIDDEN');
  });

  it('stores tokens encrypted and never in connection metadata', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    const saved = await call('adminSaveConnection', { connection: input });
    expect(saved.ok).toBe(true);
    expect(saved.value.hasToken).toBe(true);
    expect(saved.value.repos).toEqual(['acme/*']);
    expect(saved.value.apiBaseUrl).toBe('https://api.github.com');
    expect(JSON.stringify(saved)).not.toContain('ghp_new');
    expect(JSON.stringify([...h.memory.values.values()])).not.toContain('ghp_new');
    expect(h.memory.secrets.get(`connection-token:${saved.value.id}`)).toBe('ghp_new');

    // Saving again without a token keeps the stored one.
    const updated = await call('adminSaveConnection', { connection: { ...input, id: saved.value.id, token: undefined, name: 'Renamed' } });
    expect(updated.value.hasToken).toBe(true);
    expect(updated.value.name).toBe('Renamed');

    const removed = await call('adminDeleteConnection', { id: saved.value.id });
    expect(removed.ok).toBe(true);
    expect(h.memory.secrets.size).toBe(0);
  });

  it('moves connections saved by an earlier version into one key each', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    await seedGithub();
    const saved = await call('adminSaveConnection', { connection: input });
    expect(saved.ok).toBe(true);
    expect(await h.memory.kvs.get('connections')).toBeUndefined();
    const state = await call('adminGetState', {});
    expect(state.value.connections.map((c: { id: string }) => c.id).sort()).toEqual([saved.value.id, 'c1'].sort());
    expect((await call('adminDeleteConnection', { id: '../c1' })).error?.code).toBe('NOT_FOUND');
  });

  it('validates connection input', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    expect((await call('adminSaveConnection', { connection: { ...input, apiBaseUrl: 'http://api.github.com' } })).error?.code).toBe('BAD_REQUEST');
    expect((await call('adminSaveConnection', { connection: { ...input, repos: ['../x'] } })).error?.code).toBe('BAD_REQUEST');
    expect((await call('adminSaveConnection', { connection: { ...input, authType: 'private-token' } })).error?.code).toBe('BAD_REQUEST');
    expect((await call('adminSaveConnection', { connection: { ...input, token: '' } })).error?.code).toBe('BAD_REQUEST');
  });

  it('sanitises settings', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    const res = await call('adminSaveSettings', { settings: { urlSourcesEnabled: 'yes', tryItOutEnabled: true, cacheTtlMinutes: 99999 } });
    expect(res.value).toEqual({ urlSourcesEnabled: false, tryItOutEnabled: true, cacheTtlMinutes: 1440 });
  });

  it('hides connections that are not enabled for the space from editors', async () => {
    await seedGithub({ spaceKeys: ['OPS'] });
    const res = await call('getEditorOptions', {});
    expect(res.value.connections).toEqual([]);
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

describe('size and time limits', () => {
  it('refuses attachments over the size limit before downloading them', async () => {
    h.userConfluence.mockImplementation(async (path: string) =>
      path.includes('/attachments?') ? response(200, { results: [{ id: 'att1', title: 'huge.yaml', fileSize: 25_000_000 }] }) : response(500, {}),
    );
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'attachment', attachment: 'huge.yaml' } } });
    expect(res.error).toMatchObject({ code: 'TOO_LARGE', key: 'errors.fileTooLarge', params: { name: 'huge.yaml', size: 20 } });
    expect(h.userConfluence.mock.calls.some(([path]) => String(path).includes('/download'))).toBe(false);
  });

  it('escapes attachment names in Confluence URLs', async () => {
    h.userConfluence.mockResolvedValue(response(200, { results: [] }));
    await call('loadSpec', {}, { extension: { config: { sourceType: 'attachment', attachment: 'my spec & v2.yaml' } } });
    expect(h.userConfluence.mock.calls[0][0]).toBe('/wiki/api/v2/pages/123/attachments?filename=my%20spec%20%26%20v2.yaml&limit=10');
  });

  it('stops cleanly when the invocation runs out of time', async () => {
    const { withBudget, timeoutWithinBudget } = await import('../src/backend/budget');
    await expect(withBudget(500, async () => timeoutWithinBudget(15_000))).rejects.toMatchObject({ error: { code: 'UPSTREAM_ERROR', key: 'errors.deadline' } });
    await expect(withBudget(10_000, async () => timeoutWithinBudget(15_000))).resolves.toBeLessThanOrEqual(10_000);
  });

  it('compresses specs and refuses ones too big for the response limit', async () => {
    const { encodeSpec, decodeSpec } = await import('../src/backend/encoding');
    const spec = { openapi: '3.0.0', info: { title: 'x', version: '1' }, paths: { '/a': { get: { description: 'a'.repeat(200_000) } } } };
    const encoded = encodeSpec(spec);
    expect(encoded.length).toBeLessThan(10_000);
    expect(decodeSpec(encoded)).toEqual(spec);

    // Random data barely compresses, so this lands well over the cap once base64'd.
    const noise = randomBytes(4_000_000).toString('base64');
    expect(() => encodeSpec({ noise })).toThrow(expect.objectContaining({ error: expect.objectContaining({ key: 'errors.bundleTooLarge' }) }));
  });

  it('drops cached Git specs when the repository generation changes', async () => {
    await seedGithub();
    h.fetchMock.mockResolvedValue(response(200, ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }')));
    await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect((await call('loadSpec', {}, { extension: { config: gitConfig } })).value.meta.fromCache).toBe(true);
    const { bumpRepoGeneration } = await import('../src/backend/store');
    await bumpRepoGeneration('c1', 'acme/payments');
    expect((await call('loadSpec', {}, { extension: { config: gitConfig } })).value.meta.fromCache).toBe(false);
  });
});

describe('Try it out with binary bodies', () => {
  const config = { sourceType: 'inline', tryItOut: true };
  beforeEach(async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true });
  });

  it('sends base64 bodies as bytes and returns binary responses as base64', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    h.fetchMock.mockResolvedValue(response(200, png, { 'Content-Type': 'image/png' }));
    const upload = Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n\r\n\u0000\u0001\u0002\r\n--b--\r\n', 'binary');
    const res = await call(
      'proxyRequest',
      { request: { url: 'https://api.example.com/upload', method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=b' }, bodyBase64: upload.toString('base64') } },
      { extension: { config } },
    );
    expect(res.ok).toBe(true);
    expect(res.value.body).toBeUndefined();
    expect(Buffer.from(res.value.bodyBase64, 'base64')).toEqual(png);
    const [, init] = h.fetchMock.mock.calls[0];
    expect(Buffer.from(init.body as ArrayBuffer)).toEqual(upload);
    expect(init.headers['Content-Type']).toBe('multipart/form-data; boundary=b');
  });

  it('rejects uploads over the request limit and oversized binary responses', async () => {
    const big = Buffer.alloc(400_000).toString('base64');
    const tooBig = await call('proxyRequest', { request: { url: 'https://api.example.com/upload', method: 'POST', headers: {}, bodyBase64: big } }, { extension: { config } });
    expect(tooBig.error).toMatchObject({ code: 'TOO_LARGE', key: 'errors.requestTooLarge' });
    expect(h.fetchMock).not.toHaveBeenCalled();

    h.fetchMock.mockResolvedValue(response(200, Buffer.alloc(3_500_000), { 'Content-Type': 'application/pdf' }));
    const huge = await call('proxyRequest', { request: { url: 'https://api.example.com/report', method: 'GET', headers: {} } }, { extension: { config } });
    expect(huge.error).toMatchObject({ code: 'TOO_LARGE', key: 'errors.responseTooLarge' });
  });
});

describe('admin activity log', () => {
  const admin = () => response(200, { operations: [{ operation: 'administer', targetType: 'application' }] });

  it('records changes and shows who made them', async () => {
    h.userConfluence.mockImplementation(async (path: string) =>
      path.startsWith('/wiki/rest/api/user/bulk')
        ? response(200, { results: [{ accountId: 'user-1', displayName: 'Robin Admin' }] })
        : admin(),
    );
    await call('adminSaveSettings', { settings: { urlSourcesEnabled: false, tryItOutEnabled: true, cacheTtlMinutes: 10 } });
    await call('adminClearCache', {});
    await call('adminRecordHostChange', { action: 'host.approve', host: 'https://api.example.com', group: 'apis' });

    const res = await call('adminGetAudit', {});
    expect(res.ok).toBe(true);
    expect(res.value.map((e: { action: string }) => e.action)).toEqual(['host.approve', 'cache.clear', 'settings.update']);
    expect(res.value[0]).toMatchObject({ accountId: 'user-1', displayName: 'Robin Admin', target: 'https://api.example.com', changes: ['apis'] });
    expect(res.value[2].changes).toContain('tryItOutEnabled=true');

    // Repeated accountId params, not one comma-joined value.
    const bulk = h.userConfluence.mock.calls.map(([path]) => String(path)).find((p) => p.startsWith('/wiki/rest/api/user/bulk'));
    expect(bulk).toBe('/wiki/rest/api/user/bulk?accountId=user-1');
  });

  it('logs connection changes by field name only, never the token', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    const input = { name: 'Acme', provider: 'github', apiBaseUrl: 'https://api.github.com', webBaseUrl: 'https://github.com', authType: 'bearer', repos: ['acme/*'], spaceKeys: [], token: 'ghp_topsecret' };
    const saved = await call('adminSaveConnection', { connection: input });
    await call('adminSaveConnection', { connection: { ...input, id: saved.value.id, repos: ['acme/api'], token: 'ghp_rotated' } });
    const log = (await call('adminGetAudit', {})).value as Array<{ action: string; changes?: string[] }>;
    expect(log.map((e) => e.action)).toEqual(['connection.update', 'connection.create']);
    expect(log[0].changes).toEqual(['repos', 'token']);
    expect(JSON.stringify(log)).not.toContain('ghp_');
  });

  it('keeps every entry when several are written at once', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    const hosts = ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'];
    await Promise.all(hosts.map((host) => call('adminRecordHostChange', { action: 'host.approve', host, group: 'apis' })));
    const log = (await call('adminGetAudit', {})).value as Array<{ target: string }>;
    expect(log.map((e) => e.target).sort()).toEqual(hosts);
  });

  it('moves a log saved by an earlier version into per-entry keys', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    await h.memory.kvs.set('audit-log', [
      { at: '2026-01-02T00:00:00.000Z', accountId: 'user-1', action: 'cache.clear' },
      { at: '2026-01-01T00:00:00.000Z', accountId: 'user-1', action: 'settings.update' },
    ]);
    await call('adminClearCache', {});
    const log = (await call('adminGetAudit', {})).value as Array<{ action: string }>;
    expect(log.map((e) => e.action)).toEqual(['cache.clear', 'cache.clear', 'settings.update']);
    expect(await h.memory.kvs.get('audit-log')).toBeUndefined();
  });

  it('is admin-only and rejects unknown actions', async () => {
    h.userConfluence.mockImplementation(async () => response(200, { operations: [] }));
    expect((await call('adminGetAudit', {})).error?.code).toBe('FORBIDDEN');
    expect((await call('adminRecordHostChange', { action: 'host.approve', host: 'x', group: 'apis' })).error?.code).toBe('FORBIDDEN');
    h.userConfluence.mockImplementation(async () => admin());
    expect((await call('adminRecordHostChange', { action: 'settings.update', host: 'x', group: 'apis' })).error?.code).toBe('BAD_REQUEST');
  });
});

const SIMPLE_YAML = ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }');

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

const ASYNC_YAML = `asyncapi: 3.0.0
info:
  title: Account Service
  version: 1.0.0
channels:
  userSignedup:
    address: user/signedup
    messages:
      UserSignedUp:
        payload:
          type: object
          properties:
            email: { type: string, format: email }
operations:
  sendUserSignedup:
    action: send
    channel: { $ref: '#/channels/userSignedup' }
    messages:
      - $ref: '#/channels/userSignedup/messages/UserSignedUp'
`;

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

  it('refuses guests and files too big to edit', async () => {
    expect((await call('readAttachment', { filename: 'openapi.yaml' }, { account: 'anonymous' })).error?.code).toBe('FORBIDDEN');
    h.userConfluence.mockImplementation(confluence(3_000_000));
    expect((await call('readAttachment', { filename: 'openapi.yaml' })).error?.key).toBe('errors.editTooLarge');
  });
});

describe('space API list', () => {
  const inline = { sourceType: 'inline', inlineSpec: SIMPLE_YAML, title: 'Payments API' };
  const spacePage = { type: 'confluence:spacePage', content: undefined, space: { key: 'ENG', id: '777' } };

  it('records each saved macro once, and skips previews', async () => {
    await call('loadSpec', {}, { extension: { config: inline } });
    const entry = (await h.memory.kvs.get('api:777:123:macro-1')) as Record<string, unknown>;
    expect(entry).toMatchObject({ spaceId: '777', contentId: '123', contentType: 'page', localId: 'macro-1', title: 'Payments API', kind: 'openapi-3.0', operationCount: 1, sourceLabel: '' });

    const before = entry.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await call('loadSpec', {}, { extension: { config: inline } });
    expect(((await h.memory.kvs.get('api:777:123:macro-1')) as Record<string, unknown>).updatedAt).toBe(before);

    await call('loadSpec', { preview: { ...inline, title: 'Draft' } }, { localId: 'macro-2' });
    expect(await h.memory.kvs.get('api:777:123:macro-2')).toBeUndefined();
  });

  it('lists what the reader can see and prunes deleted pages and removed macros', async () => {
    const entry = (contentId: string, title: string) => ({
      spaceId: '777', contentId, contentType: 'page', localId: `m-${contentId}`, title, version: '1', kind: 'openapi-3.0',
      operationCount: 3, sourceType: 'attachment', sourceLabel: 'openapi.yaml', fingerprint: 'f', updatedAt: new Date().toISOString(),
    });
    await h.memory.kvs.set('api:777:201:m-201', entry('201', 'Billing'));
    await h.memory.kvs.set('api:777:202:m-202', entry('202', 'Macro removed'));
    await h.memory.kvs.set('api:777:203:m-203', entry('203', 'Restricted'));
    await h.memory.kvs.set('api:777:204:m-204', entry('204', 'Deleted'));
    await h.memory.kvs.set('api:888:205:m-205', entry('205', 'Other space'));

    const adf = (withMacro: boolean) => JSON.stringify({ type: 'doc', content: withMacro ? [{ type: 'extension', attrs: { extensionKey: 'abc/def/static/specpage-viewer', localId: 'x' } }] : [] });
    h.userConfluence.mockImplementation(async () =>
      response(200, { results: [{ id: '201', title: 'Billing page', body: { atlas_doc_format: { value: adf(true) } } }, { id: '202', title: 'Old page', body: { atlas_doc_format: { value: adf(false) } } }] }),
    );
    h.appConfluence.mockImplementation(async () => response(200, { results: [{ id: '203', title: 'Secret' }] }));

    const res = await call('listSpaceApis', {}, { extension: spacePage });
    expect(res.ok).toBe(true);
    expect(res.value.spaceKey).toBe('ENG');
    expect(res.value.apis.map((a: { title: string; pageTitle: string }) => `${a.title} @ ${a.pageTitle}`)).toEqual(['Billing @ Billing page']);

    const userPath = String(h.userConfluence.mock.calls[0][0]);
    expect(userPath).toBe('/wiki/api/v2/pages?id=201%2C202%2C203%2C204&limit=250&body-format=atlas_doc_format');
    expect(String(h.appConfluence.mock.calls[0][0])).toBe('/wiki/api/v2/pages?id=203%2C204&limit=250');
    expect([...h.memory.values.keys()].filter((k) => k.startsWith('api:')).sort()).toEqual(['api:777:201:m-201', 'api:777:203:m-203', 'api:888:205:m-205']);
  });

  it('needs a licensed user', async () => {
    expect((await call('listSpaceApis', {}, { account: 'anonymous', extension: spacePage })).error?.key).toBe('errors.catalogLicensedOnly');
  });
});

describe('comparing versions', () => {
  const v1 = `openapi: 3.0.3
info: { title: Payments, version: '1.0' }
paths:
  /payments:
    get: { responses: { '200': { description: ok } } }
  /refunds:
    get: { responses: { '200': { description: ok } } }
`;
  const v2 = `openapi: 3.0.3
info: { title: Payments, version: '2.0' }
paths:
  /payments:
    get:
      parameters: [{ name: account, in: query, required: true, schema: { type: string } }]
      responses: { '200': { description: ok } }
`;

  it('compares a Git spec with another ref', async () => {
    await seedGithub();
    h.fetchMock.mockImplementation(async (url: string) => response(200, new URL(url).searchParams.get('ref') === 'v1.0' ? v1 : v2));
    const res = await call('compareSpec', { target: { gitRef: 'v1.0' } }, { extension: { config: gitConfig } });
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({ baseVersion: '1.0', headVersion: '2.0', counts: { breaking: 2, warning: 0, info: 0 }, truncated: false });
    expect(res.value.changes.map((c: { code: string }) => c.code).sort()).toEqual(['operationRemoved', 'requiredParameterAdded']);
    expect(res.value.baseLabel).toContain('@v1.0');

    // Both versions use the macro's spec cache, so repeating the comparison fetches nothing.
    h.fetchMock.mockClear();
    await call('compareSpec', { target: { gitRef: 'v1.0' } }, { extension: { config: gitConfig } });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing, invalid or identical ref', async () => {
    await seedGithub();
    const run = (target: unknown) => call('compareSpec', { target }, { extension: { config: gitConfig } });
    expect((await run({})).error?.key).toBe('errors.compareRefRequired');
    expect((await run({ gitRef: '../x' })).error?.key).toBe('errors.gitRefInvalid');
    expect((await run({ gitRef: 'main' })).error?.key).toBe('errors.compareSameRef');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('compares an attachment with its previous version by default', async () => {
    h.userConfluence.mockImplementation(async (path: string) => {
      if (path.includes('/attachments?filename=openapi.yaml')) return response(200, { results: [{ id: 'att9', title: 'openapi.yaml', version: { number: 3 } }] });
      if (path.includes('/child/attachment/att9/download?version=2')) return response(200, v1);
      if (path.includes('/child/attachment/att9/download')) return response(200, v2);
      return response(404, {});
    });
    const res = await call('compareSpec', { target: {} }, { extension: { config: { sourceType: 'attachment', attachment: 'openapi.yaml' } } });
    expect(res.ok).toBe(true);
    expect(res.value.baseLabel).toBe('openapi.yaml (v2)');
    expect(res.value.counts.breaking).toBe(2);
  });

  it('checks attachment versions and sources that have no history', async () => {
    h.userConfluence.mockImplementation(async () => response(200, { results: [{ id: 'att9', title: 'openapi.yaml', version: { number: 1 } }] }));
    const attachment = { extension: { config: { sourceType: 'attachment', attachment: 'openapi.yaml' } } };
    expect((await call('compareSpec', { target: {} }, attachment)).error?.key).toBe('errors.compareNoOlderVersion');
    expect((await call('compareSpec', { target: { attachmentVersion: 1.5 } }, attachment)).error?.key).toBe('errors.compareVersionInvalid');
    expect((await call('compareSpec', { target: { attachmentVersion: '2' } }, attachment)).error?.key).toBe('errors.compareVersionInvalid');
    const inline = { extension: { config: { sourceType: 'inline', inlineSpec: v1 } } };
    expect((await call('compareSpec', { target: {} }, inline)).error?.key).toBe('errors.compareUnsupportedSource');
  });

  it('is for licensed users only', async () => {
    await seedGithub();
    for (const account of ['anonymous', 'unlicensed'] as const) {
      const res = await call('compareSpec', { target: { gitRef: 'v1.0' } }, { account, extension: { config: gitConfig } });
      expect(res.error?.code).toBe('FORBIDDEN');
    }
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});
