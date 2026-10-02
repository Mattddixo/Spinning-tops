// Shared Playwright harness: a fake Forge bridge configured per test, served
// under a strict CSP by e2e/serve.mjs.
import type { Page } from '@playwright/test';


export const SPEC = {
  openapi: '3.1.0',
  info: { title: 'Payments API', version: '2.4.0', description: 'Move money safely.' },
  servers: [{ url: 'https://api.example.com/v1' }],
  tags: [{ name: 'payments' }, { name: 'refunds' }],
  paths: {
    '/payments': {
      get: { tags: ['payments'], summary: 'List payments', operationId: 'listPayments', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['payments'],
        summary: 'Create payment',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/refunds': { get: { tags: ['refunds'], summary: 'List refunds', deprecated: true, responses: { '200': { description: 'OK' } } } },
    '/receipts': {
      post: {
        tags: ['payments'],
        summary: 'Upload receipt',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties: { note: { type: 'string' }, file: { type: 'string', format: 'binary' } } },
            },
          },
        },
        responses: { '200': { description: 'Receipt image', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } } },
      },
    },
  },
  components: { schemas: { Payment: { type: 'object', properties: { amount: { type: 'integer' } } } } },
};

export const SUMMARY = {
  kind: 'openapi-3.1',
  title: 'Payments API',
  version: '2.4.0',
  servers: ['https://api.example.com/v1'],
  tags: ['payments', 'refunds'],
  operations: [
    { method: 'GET', path: '/payments', summary: 'List payments', tags: ['payments'], deprecated: false },
    { method: 'POST', path: '/payments', summary: 'Create payment', tags: ['payments'], deprecated: false },
    { method: 'GET', path: '/refunds', summary: 'List refunds', tags: ['refunds'], deprecated: true },
    { method: 'POST', path: '/receipts', summary: 'Upload receipt', tags: ['payments'], deprecated: false },
  ],
};

export type Setup = {
  config?: Record<string, unknown>;
  isEditing?: boolean;
  tryItOut?: boolean;
  loadError?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  audit?: unknown[];
  /** Replaces the default summary (e.g. for AsyncAPI). */
  summary?: Record<string, unknown>;
  /** Extra fields for context.extension (autoConvertLink, content, space). */
  extension?: Record<string, unknown>;
  editorOptions?: Record<string, unknown>;
  attachments?: unknown[];
};

export async function installHarness(page: Page, setup: Setup = {}) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    // logged with the URL by the response handler instead
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    // ignore the browser's own favicon request
    if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  await page.addInitScript(
    ({ spec, summary, setup }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__CSP__ = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        (w.__CSP__ as string[]).push(`${e.violatedDirective} ${e.blockedURI}`);
        // Where it came from, to make failures quick to track down.
        console.warn(`[csp] ${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${e.sample}`);
      });
      const ok = (value: unknown) => ({ ok: true, value });
      // Same transport as the backend: gzip'd JSON, base64.
      const gzip = async (value: unknown) => {
        const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
      };
      w.__SPECPAGE_HARNESS__ = {
        context: { extension: { config: setup.config ?? {}, isEditing: setup.isEditing === true, content: { id: '123', type: 'page' }, ...setup.extension } },
        egress: [{ key: 'specpage-git-hosts', description: 'git', configured: [{ domain: 'https://api.github.com', type: ['FETCH_BACKEND_SIDE'] }] }],
        resolvers: {
          loadSpec: async () =>
            setup.loadError
              ? { ok: false, error: setup.loadError }
              : ok({
                  specGz: await gzip(setup.spec ?? spec),
                  summary: setup.summary ?? summary,
                  tryItOutAllowed: setup.tryItOut === true,
                  meta: {
                    sourceLabel: 'acme/payments@main: openapi.yaml',
                    sourceLink: 'https://github.com/acme/payments/blob/main/openapi.yaml',
                    fetchedAt: new Date().toISOString(),
                    fromCache: true,
                    fileCount: 2,
                    warnings: [],
                    serversResolvable: true,
                    ...setup.meta,
                  },
                }),
          proxyRequest: (payload: { request: { url: string; method: string } }) =>
            payload.request.url.endsWith('/receipts')
              ? // 1x1 transparent PNG
                ok({ status: 200, statusText: 'OK', headers: { 'content-type': 'image/png' }, bodyBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', truncated: false })
              : ok({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ echoed: payload.request.url, method: payload.request.method }), truncated: false }),
          listAttachments: () => ok(setup.attachments ?? [{ title: 'openapi.yaml', fileSize: 2048, version: 1 }]),
          getEditorOptions: () =>
            ok(
              setup.editorOptions ?? {
                connections: [{ id: 'c1', name: 'Acme GitHub', provider: 'github', webHost: 'github.com', repos: ['acme/payments', 'acme/*'] }],
                urlSourcesEnabled: false,
                tryItOutEnabled: true,
              },
            ),
          adminGetState: () =>
            ok({
              settings: { urlSourcesEnabled: false, tryItOutEnabled: false, cacheTtlMinutes: 10 },
              connections: [
                { id: 'c1', name: 'Acme GitHub', provider: 'github', apiBaseUrl: 'https://api.github.com', webBaseUrl: 'https://github.com', authType: 'bearer', repos: ['acme/*'], spaceKeys: [], hasToken: true, createdAt: 'x', updatedAt: 'x' },
              ],
            }),
          adminSaveConnection: (payload: { connection: Record<string, unknown> }) =>
            ok({ ...payload.connection, id: 'c2', hasToken: true, createdAt: 'x', updatedAt: 'x', token: undefined }),
          adminSaveSettings: (payload: { settings: unknown }) => ok(payload.settings),
          adminGetAudit: () => ok(setup.audit ?? []),
          adminRecordHostChange: () => ok({ recorded: true }),
        },
      };
    },
    { spec: SPEC, summary: SUMMARY, setup },
  );
  return errors;
}

export const EGRESS_ERROR = {
  code: 'EGRESS_NOT_APPROVED',
  key: 'errors.egressNotApproved',
  params: { host: 'api.github.com' },
  message: "SpecPage isn't allowed to contact api.github.com yet.",
  hintKey: 'hints.askAdminApproveHost',
  hint: 'A Confluence admin can approve this host in SpecPage settings.',
};

export type Call = { fn: string; payload: { request?: { url: string; method: string; headers: Record<string, string>; body?: string; bodyBase64?: string } } };
export const proxyCalls = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { __SPECPAGE_CALLS__: Call[] }).__SPECPAGE_CALLS__)).filter((c) => c.fn === 'proxyRequest');

export async function cspViolations(page: Page) {
  return page.evaluate(() => (window as unknown as { __CSP__: string[] }).__CSP__);
}

