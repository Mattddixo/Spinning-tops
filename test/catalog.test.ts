import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call, SIMPLE_YAML } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

beforeEach(resetForge);

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
    await h.memory.kvs.set('api:777:204:m-204', { ...entry('204', 'Deleted'), updatedAt: new Date(Date.now() - 200 * 86_400_000).toISOString() });
    await h.memory.kvs.set('api:888:205:m-205', entry('205', 'Other space'));

    const adf = (withMacro: boolean) => JSON.stringify({ type: 'doc', content: withMacro ? [{ type: 'extension', attrs: { extensionKey: 'abc/def/static/specpage-viewer', localId: 'x' } }] : [] });
    h.userConfluence.mockImplementation(async () =>
      response(200, { results: [{ id: '201', title: 'Billing page', body: { atlas_doc_format: { value: adf(true) } } }, { id: '202', title: 'Old page', body: { atlas_doc_format: { value: adf(false) } } }] }),
    );

    const res = await call('listSpaceApis', {}, { extension: spacePage });
    expect(res.ok).toBe(true);
    expect(res.value.spaceKey).toBe('ENG');
    expect(res.value.apis.map((a: { title: string; pageTitle: string }) => `${a.title} @ ${a.pageTitle}`)).toEqual(['Billing @ Billing page']);

    const userPath = String(h.userConfluence.mock.calls[0][0]);
    expect(userPath).toBe('/wiki/api/v2/pages?id=201%2C202%2C203%2C204&limit=250&body-format=atlas_doc_format');
    // Restricted pages are never checked as the app or deleted because a reader can't see them;
    // only an entry nobody has viewed for 90 days (204) is pruned.
    expect(h.appConfluence).not.toHaveBeenCalled();
    expect([...h.memory.values.keys()].filter((k) => k.startsWith('api:')).sort()).toEqual(['api:777:201:m-201', 'api:777:203:m-203', 'api:888:205:m-205']);
  });

  it('keeps hidden entries for 90 days, and says when the space list is cut short', async () => {
    const entry = (contentId: string, daysAgo: number) => ({
      spaceId: '777', contentId, contentType: 'page', localId: `m-${contentId}`, title: contentId, version: '1', kind: 'openapi-3.0',
      operationCount: 1, sourceType: 'attachment', sourceLabel: 'x.yaml', fingerprint: 'f', updatedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    });
    await h.memory.kvs.set('api:777:301:m-301', entry('301', 60));
    await h.memory.kvs.set('api:777:302:m-302', entry('302', 100));
    h.userConfluence.mockImplementation(async () => response(200, { results: [] }));
    const res = await call('listSpaceApis', {}, { extension: spacePage });
    expect(res.value).toMatchObject({ apis: [], truncated: false });
    expect(await h.memory.kvs.get('api:777:301:m-301')).toBeDefined();
    expect(await h.memory.kvs.get('api:777:302:m-302')).toBeUndefined();

    for (let i = 0; i < 1001; i++) await h.memory.kvs.set(`api:777:${4000 + i}:m`, entry(String(4000 + i), 1));
    expect((await call('listSpaceApis', {}, { extension: spacePage })).value.truncated).toBe(true);
  });

  it('needs a licensed user', async () => {
    expect((await call('listSpaceApis', {}, { account: 'anonymous', extension: spacePage })).error?.key).toBe('errors.catalogLicensedOnly');
  });
});

describe('site-wide API catalog', () => {
  const globalPage = { type: 'confluence:globalPage', content: undefined, space: undefined };
  const entry = (spaceId: string, contentId: string, title: string, spaceKey?: string) => ({
    spaceId, ...(spaceKey ? { spaceKey } : {}), contentId, contentType: 'page', localId: `m-${contentId}`, title, version: '1', kind: 'openapi-3.0',
    operationCount: 1, sourceType: 'attachment', sourceLabel: 'openapi.yaml', fingerprint: 'f', updatedAt: new Date().toISOString(),
  });
  const adf = JSON.stringify({ type: 'doc', content: [{ type: 'extension', attrs: { extensionKey: 'a/b/static/specpage-viewer' } }] });

  it('lists APIs from every space the reader can see', async () => {
    await h.memory.kvs.set('api:777:301:m-301', entry('777', '301', 'Payments', 'ENG'));
    await h.memory.kvs.set('api:888:302:m-302', entry('888', '302', 'Accounts', 'OPS'));
    await h.memory.kvs.set('api:999:303:m-303', entry('999', '303', 'Hidden', 'HR'));
    h.userConfluence.mockImplementation(async () =>
      response(200, { results: [{ id: '301', title: 'Pay page', body: { atlas_doc_format: { value: adf } } }, { id: '302', title: 'Acct page', body: { atlas_doc_format: { value: adf } } }] }),
    );
    const res = await call('listSiteApis', {}, { extension: globalPage });
    expect(res.ok).toBe(true);
    expect(res.value.truncated).toBe(false);
    expect(res.value.apis.map((a: { title: string; spaceKey: string }) => `${a.title} (${a.spaceKey})`)).toEqual(['Accounts (OPS)', 'Payments (ENG)']);
    // Hidden from this reader (restricted), so kept for others.
    expect(await h.memory.kvs.get('api:999:303:m-303')).toBeDefined();
    // The site list doesn't download page bodies.
    expect(h.userConfluence.mock.calls.map(([path]) => String(path)).some((p) => p.includes('body-format'))).toBe(false);
  });

  it('records the space key with each entry', async () => {
    await call('loadSpec', {}, { extension: { config: { sourceType: 'inline', inlineSpec: SIMPLE_YAML } } });
    expect(((await h.memory.kvs.get('api:777:123:macro-1')) as Record<string, unknown>).spaceKey).toBe('ENG');
  });

  it('needs a licensed user', async () => {
    expect((await call('listSiteApis', {}, { account: 'unlicensed', extension: globalPage })).error?.key).toBe('errors.catalogLicensedOnly');
    expect(h.userConfluence).not.toHaveBeenCalled();
  });
});
