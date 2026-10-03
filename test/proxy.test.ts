import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

beforeEach(resetForge);

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
