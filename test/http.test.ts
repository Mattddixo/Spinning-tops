import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, resetForge, response } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

import { withBudget } from '../src/backend/budget';
import { externalFetch, externalFetchAny, upstreamError } from '../src/backend/http';

beforeEach(resetForge);

// The AppError carried by a failed call, or undefined if it succeeded.
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return (err as { error?: { code: string; key: string; params?: Record<string, unknown>; hintKey?: string; detail?: string } }).error;
  }
  return undefined;
}

const URL_ = 'https://api.example.com/spec.yaml';

describe('externalFetch errors', () => {
  it('gives up after five redirects', async () => {
    h.fetchMock.mockImplementation(async (url: string) => response(302, '', { Location: `${url}x` }));
    expect(await failure(externalFetch(URL_))).toMatchObject({ code: 'UPSTREAM_ERROR', key: 'errors.tooManyRedirects', params: { host: 'api.example.com' } });
    // The first request plus five redirects.
    expect(h.fetchMock).toHaveBeenCalledTimes(6);
  });

  it('times out with the host and the limit in seconds', async () => {
    // Wait for the abort signal the request was given, like a stalled server.
    h.fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    );
    expect(await failure(externalFetch(URL_, { timeoutMs: 500 }))).toMatchObject({ key: 'errors.timeout', params: { host: 'api.example.com', seconds: 1 } });
  });

  it('keeps the timeout inside what is left of the invocation', async () => {
    h.fetchMock.mockResolvedValue(response(200, 'ok'));
    expect(await failure(withBudget(500, () => externalFetch(URL_)))).toMatchObject({ key: 'errors.deadline' });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('explains an egress denial, whichever way Forge reports it', async () => {
    h.fetchMock.mockRejectedValueOnce(new h.NotAllowedError('blocked'));
    expect(await failure(externalFetch(URL_))).toMatchObject({ code: 'EGRESS_NOT_APPROVED', key: 'errors.egressNotApproved', hintKey: 'hints.askAdminApproveHost' });
    h.fetchMock.mockRejectedValueOnce(new Error('URL not included in the external fetch backend permissions'));
    expect(await failure(externalFetch(URL_))).toMatchObject({ code: 'EGRESS_NOT_APPROVED' });
  });

  it('reports other network failures as a connection problem', async () => {
    h.fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.example.com'));
    expect(await failure(externalFetch(URL_))).toMatchObject({ key: 'errors.connectFailed', detail: 'getaddrinfo ENOTFOUND api.example.com' });
  });
});

describe('response size limits', () => {
  it('refuses a response that declares more than twice the cap, before reading it', async () => {
    const res = response(200, 'small', { 'Content-Length': String(5_000_001) });
    const text = vi.spyOn(res, 'text');
    h.fetchMock.mockResolvedValue(res);
    expect(await failure(externalFetch(URL_, { maxBytes: 2_500_000 }))).toMatchObject({ code: 'TOO_LARGE', key: 'errors.responseTooLarge', params: { size: 5 } });
    expect(text).not.toHaveBeenCalled();
  });

  it('cuts text off at the cap and says so', async () => {
    h.fetchMock.mockResolvedValue(response(200, 'abcdefghij'));
    expect(await externalFetch(URL_, { maxBytes: 4 })).toMatchObject({ text: 'abcd', truncated: true });
    h.fetchMock.mockResolvedValue(response(200, 'abcd'));
    expect(await externalFetch(URL_, { maxBytes: 4 })).toMatchObject({ text: 'abcd', truncated: false });
  });

  it('refuses binary responses over the cap instead of returning a broken file', async () => {
    h.fetchMock.mockResolvedValue(response(200, Buffer.alloc(11), { 'Content-Type': 'image/png' }));
    expect(await failure(externalFetchAny(URL_, { maxBinaryBytes: 10 }))).toMatchObject({ code: 'TOO_LARGE', key: 'errors.responseTooLarge' });
    h.fetchMock.mockResolvedValue(response(200, Buffer.from([1, 2, 3]), { 'Content-Type': 'image/png' }));
    expect(await externalFetchAny(URL_, { maxBinaryBytes: 10 })).toMatchObject({ base64: 'AQID', truncated: false });
  });
});

describe('upstreamError', () => {
  it('points at the token for 401 and 403, and at the path for 404', async () => {
    for (const status of [401, 403]) {
      expect(await failure((async () => upstreamError('acme/api/openapi.yaml', status, 'Forbidden'))())).toMatchObject({ code: 'FORBIDDEN', key: 'errors.upstreamForbidden', hintKey: 'hints.checkToken' });
    }
    expect(await failure((async () => upstreamError('acme/api/openapi.yaml', 404, 'Not Found'))())).toMatchObject({ code: 'NOT_FOUND', key: 'errors.upstreamNotFound', hintKey: 'hints.checkRepoPath' });
  });

  it('passes other statuses through with the status text as detail', async () => {
    expect(await failure((async () => upstreamError('acme/api', 502, 'Bad Gateway'))())).toMatchObject({ key: 'errors.upstreamFailed', params: { status: 502 }, detail: 'Bad Gateway' });
    expect((await failure((async () => upstreamError('acme/api', 500, ''))()))?.detail).toBeUndefined();
  });
});
