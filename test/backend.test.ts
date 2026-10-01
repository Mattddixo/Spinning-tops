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

vi.mock('@forge/kvs', () => ({
  get kvs() {
    return h.memory.kvs;
  },
}));

vi.mock('@forge/api', () => ({
  fetch: (...args: unknown[]) => h.fetchMock(...args),
  asUser: () => ({ requestConfluence: (...args: unknown[]) => h.userConfluence(...args) }),
  asApp: () => ({ requestConfluence: (...args: unknown[]) => h.appConfluence(...args) }),
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), ''),
  NotAllowedError: h.NotAllowedError,
}));

import { exportHandler, handler } from '../src/index';

function response(status: number, body: string | object, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { forEach: (cb: (v: string, k: string) => void) => map.forEach((v, k) => cb(v, k)), get: (k: string) => map.get(k.toLowerCase()) ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

type Account = 'licensed' | 'unlicensed' | 'anonymous';

async function call(functionKey: string, payload: unknown, opts: { account?: Account; extension?: Record<string, unknown>; license?: unknown } = {}) {
  const account = opts.account ?? 'licensed';
  const accountId = account === 'anonymous' ? undefined : 'user-1';
  return handler(
    {
      call: { functionKey, payload: payload as Record<string, unknown> },
      context: {
        accountType: account,
        extension: { type: 'macro', content: { id: '123', type: 'page' }, space: { key: 'ENG' }, ...opts.extension },
      },
    } as never,
    { principal: { accountId }, license: opts.license },
  ) as Promise<{ ok: boolean; value?: any; error?: { code: string; message: string; detail?: string } }>;
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
    expect(JSON.stringify(first.value.spec)).not.toContain('payment.yaml');

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
    expect(res.error?.code).toBe('EGRESS_NOT_APPROVED');
    expect(res.error?.message).toContain('api.github.com');
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
