import { Parser, stringify } from '@asyncapi/parser';
import { expect, test, type Page } from '@playwright/test';
import { cspViolations, installHarness, proxyCalls } from './harness';

type Harness = { resolvers: Record<string, (payload: unknown) => unknown>; confluence?: unknown };
type ConfluenceCall = { path: string; method: string; headers: Record<string, string>; fields: Record<string, string>; files: Record<string, { name: string; text: string }> };

const confluenceCalls = (page: Page) => page.evaluate(() => (window as unknown as { __SPECPAGE_CONFLUENCE__?: ConfluenceCall[] }).__SPECPAGE_CONFLUENCE__ ?? []);
const submitted = (page: Page) => page.evaluate(() => (window as unknown as { __SPECPAGE_SUBMITTED__?: { config: Record<string, unknown> } }).__SPECPAGE_SUBMITTED__);

const ASYNC_YAML = `asyncapi: 3.0.0
info:
  title: Account Service
  version: 1.0.0
  description: Emits user events.
channels:
  userSignedup:
    address: user/signedup
    messages:
      UserSignedUp:
        payload:
          type: object
          properties:
            displayName: { type: string }
            email: { type: string, format: email }
operations:
  sendUserSignedup:
    action: send
    channel: { $ref: '#/channels/userSignedup' }
    messages:
      - $ref: '#/channels/userSignedup/messages/UserSignedUp'
`;

test('AsyncAPI documents render under the strict CSP', async ({ page }) => {
  // Same path as production: parsed and stringified in Node, rendered parser-free in the browser.
  const { document } = await new Parser().parse(ASYNC_YAML);
  const doc = JSON.parse(stringify(document!)!);
  const errors = await installHarness(page, {
    spec: doc,
    summary: { kind: 'asyncapi-3', title: 'Account Service', version: '1.0.0', servers: [], tags: [], operations: [{ method: 'SEND', path: 'user/signedup', tags: [], deprecated: false }] },
  });
  await page.goto('/macro.html');
  await expect(page.getByText('AsyncAPI 3')).toBeVisible();
  await expect(page.getByText('user/signedup').first()).toBeVisible();
  await expect(page.getByText('UserSignedUp').first()).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/asyncapi.png', fullPage: true });
});

test('the spec editor highlights problems inline and saves pasted specs', async ({ page }) => {
  const errors = await installHarness(page, {});
  await page.goto('/config.html');
  await page.getByRole('radio', { name: /Paste/ }).click();
  const editor = page.getByRole('textbox', { name: 'OpenAPI or Swagger document (YAML or JSON)' });
  await editor.click();
  await page.keyboard.insertText('openapi: 3.0.3\ninfo: { title: Pasted, version: "1" }\npaths:\n  /a: [\n');
  // YAML error (unclosed flow sequence) shows up as a lint mark.
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('openapi: 3.0.3\ninfo: { title: Pasted, version: "1" }\npaths: {}\n');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);
  await expect(page.locator('.sp-config-preview .swagger-ui')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await submitted(page))?.config).toMatchObject({ sourceType: 'inline', inlineSpec: 'openapi: 3.0.3\ninfo: { title: Pasted, version: "1" }\npaths: {}\n' });
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a pasted spec can be saved as a page attachment', async ({ page }) => {
  await installHarness(page, { config: { sourceType: 'inline', inlineSpec: '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}' } });
  await page.addInitScript(() => {
    const h = (window as unknown as { __SPECPAGE_HARNESS__: Harness }).__SPECPAGE_HARNESS__;
    h.confluence = () => ({ status: 200, body: { results: [{ title: 'openapi.json', version: { number: 1 } }] } });
  });
  await page.goto('/config.html');
  await page.getByRole('button', { name: 'Save as attachment' }).click();
  await expect(page.getByLabel('Attachment')).toHaveValue('openapi.json');
  const [upload] = await confluenceCalls(page);
  expect(upload).toMatchObject({ path: '/wiki/rest/api/content/123/child/attachment', method: 'PUT', fields: { minorEdit: 'true' } });
  expect(upload.headers['x-atlassian-token']).toBe('no-check');
  expect(upload.files.file).toMatchObject({ name: 'openapi.json', text: '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}' });
});

test('attachments can be uploaded, edited and saved as new versions, with a conflict check', async ({ page }) => {
  const errors = await installHarness(page, { config: { sourceType: 'attachment', attachment: 'openapi.yaml' } });
  // Uploading a file that's already attached asks before adding a version.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __SPECPAGE_HARNESS__: Harness; __LIST_VERSION__: number };
    w.__LIST_VERSION__ = 4;
    const h = w.__SPECPAGE_HARNESS__;
    h.resolvers.listAttachments = () => ({ ok: true, value: [{ title: 'openapi.yaml', fileSize: 2048, version: w.__LIST_VERSION__ }, { title: 'new-api.yaml', fileSize: 10, version: 1 }] });
    h.resolvers.readAttachment = () => ({ ok: true, value: { text: 'openapi: 3.0.3\ninfo: { title: Old, version: "1" }\npaths: {}\n', version: 4 } });
    h.confluence = (_path: string, init: { files: Record<string, { name: string }> }) => ({ status: 200, body: { results: [{ title: init.files.file.name, version: { number: 6 } }] } });
  });
  await page.goto('/config.html');

  // Upload a new file and select it.
  await page.locator('input[type=file]').setInputFiles({ name: 'new-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from('openapi: 3.0.3\n') });
  await expect(page.getByText('new-api.yaml uploaded.')).toBeVisible();
  expect(dialogs).toEqual(['"new-api.yaml" is already attached. Upload it as a new version?']);
  await expect(page.getByLabel('Attachment')).toHaveValue('new-api.yaml');

  // Edit the original; someone else saves v5 in the meantime.
  await page.getByLabel('Attachment').selectOption('openapi.yaml');
  await page.getByRole('button', { name: 'Edit file' }).click();
  const editor = page.getByRole('textbox', { name: 'Contents of openapi.yaml' });
  await expect(editor).toContainText('title: Old');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('# edited\n');
  await page.evaluate(() => ((window as unknown as { __LIST_VERSION__: number }).__LIST_VERSION__ = 5));
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(page.getByText('Someone saved a newer version of openapi.yaml (v5)', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.getByText('Saved openapi.yaml as version 6.')).toBeVisible();

  const uploads = (await confluenceCalls(page)).filter((c) => c.method === 'PUT');
  expect(uploads.map((u) => u.files.file.name)).toEqual(['new-api.yaml', 'openapi.yaml']);
  expect(uploads[1].files.file.text).toContain('# edited');
  expect(uploads[1].fields.comment).toBe('Edited in SpecPage');
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('SwaggerHub connections ask for a version instead of a file path', async ({ page }) => {
  await installHarness(page, {
    editorOptions: { connections: [{ id: 's1', name: 'SwaggerHub', provider: 'swaggerhub', webHost: 'app.swaggerhub.com', repos: ['acme/*'] }], urlSourcesEnabled: false, tryItOutEnabled: false },
  });
  await page.goto('/config.html');
  await page.getByRole('radio', { name: /Git or SwaggerHub/ }).click();
  await page.getByLabel('Paste a link to the file (optional)').fill('https://app.swaggerhub.com/apis/acme/payments/1.2.0');
  await page.getByRole('button', { name: 'Fill in' }).click();
  await expect(page.getByLabel('Connection')).toHaveValue('s1');
  await expect(page.getByLabel('Repository')).toHaveValue('acme/payments');
  await expect(page.getByLabel('Version')).toHaveValue('1.2.0');
  await expect(page.getByLabel('File path')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await submitted(page))?.config).toMatchObject({ sourceType: 'git', gitConnectionId: 's1', gitRepo: 'acme/payments', gitRef: '1.2.0' });
});

test('a macro inserted by pasting a link opens with the settings filled in', async ({ page }) => {
  await installHarness(page, { extension: { autoConvertLink: 'https://github.com/acme/payments/blob/main/api/openapi.yaml' } });
  await page.goto('/config.html');
  await expect(page.getByText('Filled in from the link you pasted.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Repository')).toHaveValue('acme/payments');
  await expect(page.getByLabel('File path')).toHaveValue('api/openapi.yaml');
  await expect(page.getByLabel('Branch, tag or commit')).toHaveValue('main');
});

const OAUTH_SPEC = (flows: Record<string, unknown>) => ({
  openapi: '3.0.3',
  info: { title: 'Secure API', version: '1' },
  servers: [{ url: 'https://api.example.com' }],
  components: { securitySchemes: { oauth: { type: 'oauth2', flows } } },
  security: [{ oauth: [] }],
  paths: { '/me': { get: { summary: 'Who am I', responses: { '200': { description: 'OK' } } } } },
});
const OAUTH_SUMMARY = { kind: 'openapi-3.0', title: 'Secure API', version: '1', servers: ['https://api.example.com'], tags: [], operations: [{ method: 'GET', path: '/me', tags: [], deprecated: false }] };

test('OAuth client credentials get a token through the proxy and use it', async ({ page }) => {
  await installHarness(page, {
    tryItOut: true,
    config: { tryItOut: true },
    spec: OAUTH_SPEC({ clientCredentials: { tokenUrl: 'https://auth.example.com/token', scopes: {} } }),
    summary: OAUTH_SUMMARY,
  });
  await page.addInitScript(() => {
    const h = (window as unknown as { __SPECPAGE_HARNESS__: Harness }).__SPECPAGE_HARNESS__;
    const fallback = h.resolvers.proxyRequest;
    h.resolvers.proxyRequest = (payload) => {
      const request = (payload as { request: { url: string } }).request;
      if (request.url === 'https://auth.example.com/token') {
        return { ok: true, value: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'tok-123', token_type: 'bearer' }), truncated: false } };
      }
      return fallback(payload);
    };
  });
  await page.goto('/macro.html');
  await page.getByRole('button', { name: 'Authorize' }).first().click();
  await page.locator('#client_id_clientCredentials').fill('my-client');
  await page.locator('#client_secret_clientCredentials').fill('my-secret');
  await page.getByRole('button', { name: 'Apply given OAuth2 credentials' }).click();
  await expect(page.getByRole('button', { name: 'Remove authorization' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  const op = page.locator('.opblock-get').first();
  await op.locator('.opblock-summary').click();
  await op.getByRole('button', { name: 'Try it out' }).click();
  await op.getByRole('button', { name: 'Execute' }).click();
  await expect(op.locator('.response-col_status').filter({ hasText: '200' }).first()).toBeVisible();

  const [token, call] = await proxyCalls(page);
  expect(token.payload.request).toMatchObject({ url: 'https://auth.example.com/token', method: 'POST' });
  expect(token.payload.request?.body).toContain('grant_type=client_credentials');
  expect(token.payload.request?.headers.Authorization).toBe(`Basic ${Buffer.from('my-client:my-secret').toString('base64')}`);
  expect(call.payload.request?.headers.Authorization).toBe('Bearer tok-123');
});

test('readers can paste a token for sign-in flows that need a pop-up', async ({ page }) => {
  await installHarness(page, {
    tryItOut: true,
    config: { tryItOut: true },
    spec: OAUTH_SPEC({ authorizationCode: { authorizationUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token', scopes: {} } }),
    summary: OAUTH_SUMMARY,
  });
  await page.goto('/macro.html');
  await page.getByLabel('OAuth access token (optional)').fill('Bearer pasted-token');
  const op = page.locator('.opblock-get').first();
  await op.locator('.opblock-summary').click();
  await op.getByRole('button', { name: 'Try it out' }).click();
  await op.getByRole('button', { name: 'Execute' }).click();
  await expect(op.locator('.response-col_status').filter({ hasText: '200' }).first()).toBeVisible();
  const [call] = await proxyCalls(page);
  expect(call.payload.request?.headers.Authorization).toBe('Bearer pasted-token');
});

test('the token box only appears when the spec uses OAuth and Try it out is on', async ({ page }) => {
  await installHarness(page, { tryItOut: true, config: { tryItOut: true } });
  await page.goto('/macro.html');
  await expect(page.locator('.opblock-summary').first()).toBeVisible();
  await expect(page.getByLabel('OAuth access token (optional)')).toHaveCount(0);
});

test('the space page lists API docs and filters them', async ({ page }) => {
  const errors = await installHarness(page, { extension: { type: 'confluence:spacePage', space: { key: 'ENG', id: '777' } } });
  await page.addInitScript(() => {
    const h = (window as unknown as { __SPECPAGE_HARNESS__: Harness }).__SPECPAGE_HARNESS__;
    const api = (contentId: string, title: string, pageTitle: string, kind: string, sourceType: string, sourceLabel: string) => ({
      spaceId: '777', contentId, contentType: 'page', localId: `m${contentId}`, title, pageTitle, version: '2.0', kind,
      operationCount: 12, sourceType, sourceLabel, fingerprint: 'f', updatedAt: new Date().toISOString(),
    });
    h.resolvers.listSpaceApis = () => ({
      ok: true,
      value: {
        spaceKey: 'ENG',
        apis: [api('1', 'Billing API', 'Billing', 'openapi-3.1', 'git', 'acme/billing@main: openapi.yaml'), api('2', 'Events', 'Event bus', 'asyncapi-3', 'attachment', 'events.yaml')],
      },
    });
  });
  await page.goto('/space.html');
  await expect(page.getByRole('heading', { name: 'API docs in this space' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Billing API' })).toBeVisible();
  await expect(page.getByText('AsyncAPI 3')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter by API, page or source' }).fill('events');
  await expect(page.getByText('Showing 1 of 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Billing API' })).toHaveCount(0);
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/space.png', fullPage: true });
});
