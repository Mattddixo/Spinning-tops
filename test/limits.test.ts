import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call, ROOT_YAML, seedGithub, gitConfig } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

beforeEach(resetForge);

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
    // Only connections with a webhook read the generation.
    await seedGithub({ webhookEnabled: true });
    h.fetchMock.mockResolvedValue(response(200, ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }')));
    await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect((await call('loadSpec', {}, { extension: { config: gitConfig } })).value.meta.fromCache).toBe(true);
    const { bumpRepoGeneration } = await import('../src/backend/store');
    await bumpRepoGeneration('c1', 'acme/payments');
    expect((await call('loadSpec', {}, { extension: { config: gitConfig } })).value.meta.fromCache).toBe(false);
  });
});

describe('invocation-scoped work and time limits', () => {
  it('runs a once-per-invocation check once per call, and again in the next call', async () => {
    const { oncePerInvocation, withBudget } = await import('../src/backend/budget');
    const fn = vi.fn(async () => undefined);
    await withBudget(5_000, async () => {
      await oncePerInvocation('k', fn);
      await oncePerInvocation('k', fn);
    });
    await withBudget(5_000, () => oncePerInvocation('k', fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops paging storage early when time runs short, keeping what it read', async () => {
    const { listByPrefix } = await import('../src/backend/store');
    const { withBudget } = await import('../src/backend/budget');
    for (let i = 0; i < 250; i++) await h.memory.kvs.set(`api:1:${String(i).padStart(3, '0')}:m`, { i });
    let stopped = false;
    const read = await withBudget(1_000, () => listByPrefix('api:', 2001, { reserveMs: 5_000, onStopped: () => (stopped = true) }));
    expect(stopped).toBe(true);
    expect(read.length).toBe(100);
    // Without a reserve it reads everything.
    expect((await withBudget(1_000, () => listByPrefix('api:', 2001))).length).toBe(250);
  });
});
