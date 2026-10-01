import { expect, test, type Page } from '@playwright/test';

const SPEC = {
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
  },
  components: { schemas: { Payment: { type: 'object', properties: { amount: { type: 'integer' } } } } },
};

const SUMMARY = {
  kind: 'openapi-3.1',
  title: 'Payments API',
  version: '2.4.0',
  servers: ['https://api.example.com/v1'],
  tags: ['payments', 'refunds'],
  operations: [
    { method: 'GET', path: '/payments', summary: 'List payments', tags: ['payments'], deprecated: false },
    { method: 'POST', path: '/payments', summary: 'Create payment', tags: ['payments'], deprecated: false },
    { method: 'GET', path: '/refunds', summary: 'List refunds', tags: ['refunds'], deprecated: true },
  ],
};

type Setup = { config?: Record<string, unknown>; tryItOut?: boolean; loadError?: { code: string; message: string; detail?: string } };

async function installHarness(page: Page, setup: Setup = {}) {
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
      });
      const ok = (value: unknown) => ({ ok: true, value });
      w.__SPECPAGE_HARNESS__ = {
        context: { extension: { config: setup.config ?? {}, isEditing: false } },
        egress: [{ key: 'specpage-git-hosts', description: 'git', configured: [{ domain: 'https://api.github.com', type: ['FETCH_BACKEND_SIDE'] }] }],
        resolvers: {
          loadSpec: () =>
            setup.loadError
              ? { ok: false, error: setup.loadError }
              : ok({
                  spec: JSON.parse(JSON.stringify(spec)),
                  summary,
                  tryItOutAllowed: setup.tryItOut === true,
                  meta: { sourceLabel: 'acme/payments@main: openapi.yaml', sourceLink: 'https://github.com/acme/payments/blob/main/openapi.yaml', fetchedAt: new Date().toISOString(), fromCache: true, fileCount: 2, warnings: [] },
                }),
          proxyRequest: (payload: { request: { url: string; method: string } }) =>
            ok({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ echoed: payload.request.url, method: payload.request.method }), truncated: false }),
          listAttachments: () => ok([{ title: 'openapi.yaml', fileSize: 2048 }]),
          getEditorOptions: () => ok({ connections: [{ id: 'c1', name: 'Acme GitHub', provider: 'github', repos: ['acme/payments', 'acme/*'] }], urlSourcesEnabled: false, tryItOutEnabled: true }),
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
        },
      };
    },
    { spec: SPEC, summary: SUMMARY, setup },
  );
  return errors;
}

async function cspViolations(page: Page) {
  return page.evaluate(() => (window as unknown as { __CSP__: string[] }).__CSP__);
}

test('macro renders the spec under a strict CSP and signals readiness', async ({ page }) => {
  const errors = await installHarness(page, { config: { title: 'Payments' } });
  await page.goto('/macro.html');
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
  await expect(page.locator('.opblock-summary-path', { hasText: '/payments' }).first()).toBeVisible();
  await expect(page.getByText('OpenAPI 3.1')).toBeVisible();
  await expect(page.getByText('cached', { exact: false })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/macro-light.png', fullPage: true });
});

test('macro applies tag filters and hides deprecated operations', async ({ page }) => {
  await installHarness(page, { config: { includeTags: ['payments'], hideDeprecated: true } });
  await page.goto('/macro.html');
  await expect(page.locator('.opblock-summary-path', { hasText: '/payments' }).first()).toBeVisible();
  await expect(page.locator('.opblock-summary-path', { hasText: '/refunds' })).toHaveCount(0);
});

test('macro supports the dark theme', async ({ page }) => {
  const errors = await installHarness(page, {});
  await page.goto('/macro.html?mode=dark');
  await expect(page.locator('.opblock-summary-path').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark');
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/macro-dark.png', fullPage: true });
});

test('"Try it out" requests go through the backend proxy', async ({ page }) => {
  await installHarness(page, { tryItOut: true, config: { tryItOut: true } });
  await page.goto('/macro.html');
  const op = page.locator('.opblock-get').first();
  await op.locator('.opblock-summary').click();
  await op.getByRole('button', { name: 'Try it out' }).click();
  await op.getByRole('button', { name: 'Execute' }).click();
  await expect(op.locator('.response-col_status').filter({ hasText: '200' }).first()).toBeVisible();
  await expect(op.getByText('"echoed"', { exact: false }).first()).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __SPECPAGE_CALLS__: Array<{ fn: string; payload: { request?: { url: string; method: string } } }> }).__SPECPAGE_CALLS__);
  const proxied = calls.find((c) => c.fn === 'proxyRequest');
  expect(proxied?.payload.request).toMatchObject({ url: 'https://api.example.com/v1/payments', method: 'GET' });
  expect(await cspViolations(page)).toEqual([]);
});

test('"Try it out" is hidden when not allowed', async ({ page }) => {
  await installHarness(page, { tryItOut: false });
  await page.goto('/macro.html');
  const op = page.locator('.opblock-get').first();
  await op.locator('.opblock-summary').click();
  await expect(op.getByRole('button', { name: 'Try it out' })).toHaveCount(0);
});

test('macro shows friendly errors with retry', async ({ page }) => {
  await installHarness(page, { loadError: { code: 'EGRESS_NOT_APPROVED', message: 'SpecPage is not allowed to contact api.github.com yet.', detail: 'A Confluence admin can approve this host in SpecPage settings.' } });
  await page.goto('/macro.html');
  await expect(page.getByText('SpecPage is not allowed to contact api.github.com yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('config modal previews a Git source and saves clean config with search text', async ({ page }) => {
  const errors = await installHarness(page, {});
  await page.goto('/config.html');
  await page.getByRole('radio', { name: /Git repository/ }).click();
  await page.getByLabel('Paste a link to the file (optional)').fill('https://github.com/acme/payments/blob/main/api/openapi.yaml');
  await page.getByRole('button', { name: 'Fill in' }).click();
  await expect(page.getByLabel('Repository')).toHaveValue('acme/payments');
  await expect(page.getByLabel('File path')).toHaveValue('api/openapi.yaml');
  await expect(page.locator('.sp-config-preview .opblock-summary-path').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.getByRole('checkbox', { name: 'refunds' }).check();
  await expect(page.getByText('Showing 1 of 3 operations.')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  const submitted = await page.evaluate(() => (window as unknown as { __SPECPAGE_SUBMITTED__: { config: Record<string, unknown> } }).__SPECPAGE_SUBMITTED__);
  expect(submitted.config).toMatchObject({
    sourceType: 'git',
    gitConnectionId: 'c1',
    gitRepo: 'acme/payments',
    gitRef: 'main',
    gitPath: 'api/openapi.yaml',
    includeTags: ['refunds'],
  });
  expect(submitted.config.searchText).toContain('GET /refunds');
  expect(submitted.config.searchText).not.toContain('Create payment');
  expect(JSON.stringify(submitted.config)).not.toContain('null');
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/config.png', fullPage: true });
});

test('config modal validates before saving', async ({ page }) => {
  await installHarness(page, {});
  await page.goto('/config.html');
  await page.getByRole('radio', { name: /URL/ }).isDisabled();
  await page.getByRole('radio', { name: /Paste/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sp-config-footer .sp-error-text')).toHaveText('Paste an OpenAPI or Swagger document.');
  const submitted = await page.evaluate(() => (window as unknown as { __SPECPAGE_SUBMITTED__?: unknown }).__SPECPAGE_SUBMITTED__);
  expect(submitted).toBeUndefined();
});

test('admin page lists connections and approves the Git host on save', async ({ page }) => {
  const errors = await installHarness(page, {});
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'SpecPage settings' })).toBeVisible();
  await expect(page.getByText('Acme GitHub')).toBeVisible();
  await expect(page.getByText('Host approved')).toBeVisible();

  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByLabel('Provider').selectOption('gitlab');
  await expect(page.getByLabel('API URL')).toHaveValue('https://gitlab.com/api/v4');
  await page.getByLabel('Name').fill('Acme GitLab');
  await page.getByLabel('API URL').fill('https://gitlab.acme.com/api/v4');
  await page.getByLabel('Access token').fill('glpat-secret');
  await page.getByLabel('Allowed repositories').fill('platform/payments');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('Connection saved and https://gitlab.acme.com approved.')).toBeVisible();

  const egress = await page.evaluate(() => (window as unknown as { __SPECPAGE_HARNESS__: { egress: Array<{ key: string; configured: Array<{ domain: string }> }> } }).__SPECPAGE_HARNESS__.egress);
  expect(egress.find((g) => g.key === 'specpage-git-hosts')?.configured.map((c) => c.domain)).toEqual(['https://api.github.com', 'https://gitlab.acme.com']);
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/admin.png', fullPage: true });
});
