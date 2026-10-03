import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call, ROOT_YAML, SIMPLE_YAML, seedGithub } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

beforeEach(resetForge);

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

  it('asks for a new token when the API host or provider changes', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    const saved = await call('adminSaveConnection', { connection: input });
    const id = saved.value.id as string;
    const moved = { ...input, id, token: undefined, apiBaseUrl: 'https://github.example.com/api/v3', webBaseUrl: 'https://github.example.com' };
    expect((await call('adminSaveConnection', { connection: moved })).error?.key).toBe('errors.tokenRequiredForNewHost');
    // The old token stays with the old host until a new one is given.
    expect(h.memory.secrets.get(`connection-token:${id}`)).toBe('ghp_new');
    expect((await call('adminSaveConnection', { connection: { ...moved, token: 'ghe_token' } })).ok).toBe(true);
    expect(h.memory.secrets.get(`connection-token:${id}`)).toBe('ghe_token');
    // Same host, no token: kept as before.
    expect((await call('adminSaveConnection', { connection: { ...moved, token: undefined, name: 'Renamed' } })).value.hasToken).toBe(true);
    // Switching to no auth on a new host drops the old token.
    const open = { ...moved, token: undefined, authType: 'none', apiBaseUrl: 'https://api.github.com', webBaseUrl: 'https://github.com' };
    expect((await call('adminSaveConnection', { connection: open })).value.hasToken).toBe(false);
    expect(h.memory.secrets.has(`connection-token:${id}`)).toBe(false);
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

describe('approved host lists', () => {
  const admin = () => response(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
  const tryItOut = { sourceType: 'inline', tryItOut: true };
  const proxy = (url: string) => call('proxyRequest', { request: { url, method: 'GET', headers: {} } }, { extension: { config: tryItOut } });
  const urlSource = (url: string) => call('loadSpec', {}, { extension: { config: { sourceType: 'url', url } } });

  beforeEach(async () => {
    await h.memory.kvs.set('settings', { tryItOutEnabled: true, urlSourcesEnabled: true });
    h.fetchMock.mockResolvedValue(response(200, SIMPLE_YAML, { 'Content-Type': 'application/yaml' }));
  });

  it('only lets Try it out call hosts on the Try it out list', async () => {
    expect((await proxy('https://api.example.com/v1')).ok).toBe(true);
    for (const url of ['https://docs.example.com/x', 'https://api.github.com/repos', 'https://api.example.com.evil.com/']) {
      const res = await proxy(url);
      expect(res.error).toMatchObject({ code: 'EGRESS_NOT_APPROVED', key: 'errors.hostNotForTryItOut', hintKey: 'hints.askAdminApproveTryItOutHost' });
    }
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only lets URL sources and $refs read hosts on the spec list', async () => {
    expect((await urlSource('https://docs.example.com/openapi.yaml')).ok).toBe(true);
    expect((await urlSource('https://api.example.com/openapi.yaml')).error?.key).toBe('errors.hostNotForSpecs');
    // An absolute $ref to a Try it out host is refused too.
    h.fetchMock.mockResolvedValue(response(200, ROOT_YAML.replace('./schemas/payment.yaml', 'https://api.example.com/x.yaml')));
    expect((await urlSource('https://docs.example.com/root.yaml')).error?.key).toBe('errors.hostNotForSpecs');
  });

  it("doesn't follow a redirect from a spec host to a host outside the spec list", async () => {
    h.fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('https://docs.example.com/') ? response(302, '', { Location: 'https://api.example.com/internal.yaml' }) : response(200, SIMPLE_YAML),
    );
    expect((await urlSource('https://docs.example.com/openapi.yaml')).error?.key).toBe('errors.hostNotForSpecs');
    expect(h.fetchMock.mock.calls.map(([u]) => String(u))).toEqual(['https://docs.example.com/openapi.yaml']);
  });

  it('refuses a cached URL spec once its host is removed from the spec list', async () => {
    expect((await urlSource('https://docs.example.com/openapi.yaml')).ok).toBe(true);
    expect((await urlSource('https://docs.example.com/openapi.yaml')).value.meta.fromCache).toBe(true);
    await h.memory.kvs.set('approved-hosts', { git: [], specs: [], apis: ['https://api.example.com'], syncedAt: 'x' });
    expect((await urlSource('https://docs.example.com/openapi.yaml')).error?.key).toBe('errors.hostNotForSpecs');
  });

  it('reads the approved host lists once per call, however many $refs are checked', async () => {
    const files: Record<string, string> = {
      'https://docs.example.com/root.yaml': `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /a: { get: { responses: { '200': { description: ok, content: { application/json: { schema: { $ref: 'https://docs.example.com/a.yaml' } } } } } } }
  /b: { get: { responses: { '200': { description: ok, content: { application/json: { schema: { $ref: 'https://docs.example.com/b.yaml' } } } } } } }
  /c: { get: { responses: { '200': { description: ok, content: { application/json: { schema: { $ref: 'https://docs.example.com/c.yaml' } } } } } } }
`,
      'https://docs.example.com/a.yaml': 'type: string',
      'https://docs.example.com/b.yaml': 'type: integer',
      'https://docs.example.com/c.yaml': 'type: boolean',
    };
    h.fetchMock.mockImplementation(async (url: string) => (files[url] ? response(200, files[url]) : response(404, 'nope')));
    const get = vi.spyOn(h.memory.kvs, 'get');
    const res = await urlSource('https://docs.example.com/root.yaml');
    expect(res.ok).toBe(true);
    expect(get.mock.calls.filter(([key]) => key === 'approved-hosts')).toHaveLength(1);
    // A new call reads it again (nothing is shared between calls).
    await urlSource('https://docs.example.com/root.yaml');
    expect(get.mock.calls.filter(([key]) => key === 'approved-hosts')).toHaveLength(2);
  });

  it('matches wildcards the way Forge does', async () => {
    await h.memory.kvs.set('approved-hosts', { git: [], specs: [], apis: ['*.corp.example'], syncedAt: 'x' });
    expect((await proxy('https://a.corp.example/x')).ok).toBe(true);
    expect((await proxy('https://corp.example/x')).error?.key).toBe('errors.hostNotForTryItOut');
  });

  it('refuses until the settings page has synced the lists', async () => {
    await h.memory.kvs.delete('approved-hosts');
    expect((await proxy('https://api.example.com/v1')).error).toMatchObject({ key: 'errors.hostsNotSynced', hintKey: 'hints.openSettingsToSync' });
    expect((await urlSource('https://docs.example.com/openapi.yaml')).error?.key).toBe('errors.hostsNotSynced');
  });

  it('lets only admins sync, and keeps only well-formed entries', async () => {
    h.userConfluence.mockImplementation(async () => response(200, { operations: [] }));
    expect((await call('adminSyncHosts', { hosts: { apis: ['https://x.example.com'] } })).error?.code).toBe('FORBIDDEN');
    h.userConfluence.mockImplementation(async () => admin());
    const res = await call('adminSyncHosts', {
      hosts: {
        git: ['https://api.github.com'],
        specs: ['HTTPS://Docs.Example.com', 'http://insecure.example.com', '*', 'javascript:alert(1)', 'https://*', ''],
        // Forms Atlassian Administration accepts: bare host, trailing path, https wildcard.
        apis: ['*.corp.example', 42, 'api.example.org', 'https://pay.example.org/v1/', 'https://*.example.net'],
      },
    });
    expect(res.value).toMatchObject({
      git: ['https://api.github.com'],
      specs: ['https://docs.example.com'],
      apis: ['*.corp.example', 'api.example.org', 'https://pay.example.org/v1/', 'https://*.example.net'],
    });
    // and they match as Forge would
    for (const url of ['https://api.example.org/x', 'https://pay.example.org/other', 'https://a.example.net/']) expect((await proxy(url)).ok).toBe(true);
  });
});
