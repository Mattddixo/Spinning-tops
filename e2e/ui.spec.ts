import { expect, test } from '@playwright/test';
import { buildSearchText, filterSpec, summarizeSpec } from '../src/shared/spec';
import { cspViolations, EGRESS_ERROR, installHarness, proxyCalls, SPEC } from './harness';

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
  const [proxied] = await proxyCalls(page);
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
  await installHarness(page, { loadError: EGRESS_ERROR });
  await page.goto('/macro.html');
  await expect(page.getByText("SpecPage isn't allowed to contact api.github.com yet.")).toBeVisible();
  await expect(page.getByText('A Confluence admin can approve this host in SpecPage settings.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('config modal previews a Git source and saves clean config with search text', async ({ page }) => {
  const errors = await installHarness(page, {});
  await page.goto('/config.html');
  await page.getByRole('radio', { name: /Git or SwaggerHub/ }).click();
  await page.getByLabel('Paste a link to the file (optional)').fill('https://github.com/acme/payments/blob/main/api/openapi.yaml');
  await page.getByRole('button', { name: 'Fill in' }).click();
  await expect(page.getByLabel('Repository')).toHaveValue('acme/payments');
  await expect(page.getByLabel('File path')).toHaveValue('api/openapi.yaml');
  await expect(page.locator('.sp-config-preview .opblock-summary-path').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Display' }).click();
  await page.getByRole('checkbox', { name: 'refunds' }).check();
  await expect(page.getByText('Showing 1 of 4 operations.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

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
  await page.getByRole('button', { name: 'Save', exact: true }).click();
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

test('"Try it out" uses the server URL override', async ({ page }) => {
  await installHarness(page, { tryItOut: true, config: { tryItOut: true, serverUrl: 'https://staging.example.com/v2' } });
  await page.goto('/macro.html');
  const op = page.locator('.opblock-get').first();
  await op.locator('.opblock-summary').click();
  await op.getByRole('button', { name: 'Try it out' }).click();
  await op.getByRole('button', { name: 'Execute' }).click();
  await expect(op.locator('.response-col_status').filter({ hasText: '200' }).first()).toBeVisible();
  const [proxied] = await proxyCalls(page);
  expect(proxied?.payload.request?.url).toBe('https://staging.example.com/v2/payments');
});

test('"Try it out" sends multipart uploads as bytes and shows binary responses', async ({ page }) => {
  const errors = await installHarness(page, { tryItOut: true, config: { tryItOut: true } });
  await page.goto('/macro.html');
  const op = page.locator('.opblock-post', { hasText: '/receipts' });
  await op.locator('.opblock-summary').click();
  await op.getByRole('button', { name: 'Try it out' }).click();
  await op.locator('input[type=file]').setInputFiles({ name: 'receipt.txt', mimeType: 'text/plain', buffer: Buffer.from('hello receipt') });
  await op.getByRole('button', { name: 'Execute' }).click();
  await expect(op.locator('.response-col_status').filter({ hasText: '200' }).first()).toBeVisible();
  // Swagger UI renders image responses as an <img> from a blob: URL.
  await expect(op.locator('.response-col_description img').first()).toBeVisible();

  const [proxied] = await proxyCalls(page);
  const request = proxied?.payload.request;
  expect(request?.body).toBeUndefined();
  const contentType = Object.entries(request?.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  const sent = Buffer.from(request?.bodyBase64 ?? '', 'base64').toString('utf8');
  expect(sent).toContain('filename="receipt.txt"');
  expect(sent).toContain('hello receipt');
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('macro tells readers when relative servers block "Try it out"', async ({ page }) => {
  await installHarness(page, {
    tryItOut: true,
    config: { tryItOut: true },
    meta: {
      serversResolvable: false,
      warnings: [
        { key: 'warnings.relativeServers', message: 'relative' },
        { key: 'warnings.mergedFiles', params: { count: 2 }, message: 'Merged 2 files referenced with $ref.' },
      ],
    },
  });
  await page.goto('/macro.html');
  await expect(page.getByText("The spec's server URLs are relative", { exact: false })).toBeVisible();
  // Maintenance notes are for editors only.
  await expect(page.getByText('Merged 2 files', { exact: false })).toHaveCount(0);
});

test('macro flags stale search text while the page is being edited', async ({ page }) => {
  await installHarness(page, { isEditing: true, config: { sourceType: 'git', searchText: 'Payments API · v2.4.0 · GET /payments' } });
  await page.goto('/macro.html');
  await expect(page.locator('.opblock-summary-path').first()).toBeVisible();
  await expect(page.getByText('Confluence search still uses the old endpoint list', { exact: false })).toBeVisible();
});

test('macro does not flag search text that matches the spec', async ({ page }) => {
  const config = { sourceType: 'git', includeTags: ['refunds'] };
  const searchText = buildSearchText(summarizeSpec(filterSpec(SPEC, config), 'openapi-3.1'));
  await installHarness(page, { isEditing: true, config: { ...config, searchText } });
  await page.goto('/macro.html');
  // /refunds is deprecated, which Swagger UI renders with a different path class.
  await expect(page.locator('.opblock-summary').first()).toBeVisible();
  await expect(page.getByText('Confluence search still uses', { exact: false })).toHaveCount(0);
});

test('config modal saves a server URL and validates it', async ({ page }) => {
  await installHarness(page, { config: { sourceType: 'attachment', attachment: 'openapi.yaml', tryItOut: true } });
  await page.goto('/config.html');
  await expect(page.locator('.sp-config-preview .opblock-summary-path').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Display' }).click();
  const field = page.getByLabel('Server URL for "Try it out" (optional)');
  await field.fill('http://insecure.example.com');
  await expect(page.getByText('Enter a full URL starting with https://')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __SPECPAGE_SUBMITTED__?: unknown }).__SPECPAGE_SUBMITTED__)).toBeUndefined();

  await field.fill('https://staging.example.com');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const submitted = await page.evaluate(() => (window as unknown as { __SPECPAGE_SUBMITTED__: { config: Record<string, unknown> } }).__SPECPAGE_SUBMITTED__);
  expect(submitted.config).toMatchObject({ serverUrl: 'https://staging.example.com', tryItOut: true });
});

test('admin activity log lists changes and records host approvals', async ({ page }) => {
  const errors = await installHarness(page, {
    audit: [
      { at: '2026-09-30T10:00:00Z', accountId: 'a1', displayName: 'Robin Admin', action: 'connection.update', target: 'Acme GitHub', changes: ['repos', 'token'] },
      { at: '2026-09-29T10:00:00Z', accountId: 'a2', action: 'host.approve', target: 'https://api.example.com', changes: ['apis'] },
    ],
  });
  await page.goto('/admin.html');
  const activity = page.getByRole('region', { name: 'Activity' });
  await expect(activity.getByText('Updated connection: Acme GitHub: repos, token')).toBeVisible();
  await expect(activity.getByText('Robin Admin')).toBeVisible();
  await expect(activity.getByText('Approved host: https://api.example.com (API hosts for "Try it out")')).toBeVisible();

  await page.getByLabel('Add to Spec hosts').fill('specs.example.com');
  await page.getByLabel('Add to Spec hosts').press('Enter');
  await expect(page.locator('code', { hasText: 'https://specs.example.com' })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __SPECPAGE_CALLS__: Array<{ fn: string; payload: unknown }> }).__SPECPAGE_CALLS__);
  expect(calls.filter((c) => c.fn === 'adminRecordHostChange').map((c) => c.payload)).toEqual([
    { action: 'host.approve', host: 'https://specs.example.com', group: 'specs' },
  ]);
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
