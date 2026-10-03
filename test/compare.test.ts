import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call, seedGithub, gitConfig } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

beforeEach(resetForge);

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
