import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { call, h, resetForge, response, SIMPLE_YAML } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

import { webhookHandler } from '../src/index';

// Payloads from each provider's documentation; see test/fixtures/README.md for sources.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

const connection = (id: string, provider: string, apiBaseUrl: string, repos: string[]) => ({
  id, name: id, provider, apiBaseUrl, webBaseUrl: apiBaseUrl, authType: 'none', repos, spaceKeys: [], hasToken: false, createdAt: 'x', updatedAt: 'x',
});

beforeEach(resetForge);

describe('Git push webhooks', () => {
  const admin = () => response(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
  const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const post = async (id: string, headers: Record<string, string>, body: string) => {
    const res = await webhookHandler({
      method: 'POST',
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])),
      body,
      queryParameters: { connection: [id] },
    });
    return { status: res.statusCode, message: JSON.parse(res.body).message as string };
  };

  beforeEach(async () => {
    await h.memory.kvs.set('connections', [
      connection('gh', 'github', 'https://api.github.com', ['Codertocat/*']),
      connection('gl', 'gitlab', 'https://gitlab.com/api/v4', ['mike/*']),
      connection('bb', 'bitbucket', 'https://api.bitbucket.org/2.0', ['workspace_slug/*']),
      connection('az', 'azure', 'https://dev.azure.com', ['fabrikam-fiber-inc/*']),
    ]);
    h.userConfluence.mockImplementation(async () => admin());
  });

  const enable = async (id: string) => (await call('adminEnableWebhook', { id })).value.secret as string;

  it('reads the repository from a GitHub push', async () => {
    const secret = await enable('gh');
    const body = fixture('github-push.json');
    expect(await post('gh', { 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, body) }, body)).toEqual({ status: 200, message: 'Refreshed Codertocat/Hello-World' });
  });

  it('reads the project from a GitLab Push Hook', async () => {
    const secret = await enable('gl');
    expect(await post('gl', { 'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': secret }, fixture('gitlab-push.json'))).toEqual({ status: 200, message: 'Refreshed mike/diaspora' });
  });

  it('reads the repository from a Bitbucket repo:push', async () => {
    const secret = await enable('bb');
    const body = fixture('bitbucket-push.json');
    expect(await post('bb', { 'X-Event-Key': 'repo:push', 'X-Hub-Signature': sign(secret, body) }, body)).toEqual({ status: 200, message: 'Refreshed workspace_slug/repoitory_slug' });
  });

  it('reads organization, project and repository from an Azure DevOps git.push', async () => {
    const secret = await enable('az');
    const auth = `Basic ${Buffer.from(`hook:${secret}`).toString('base64')}`;
    expect(await post('az', { Authorization: auth }, fixture('azure-push.json'))).toEqual({
      status: 200,
      message: 'Refreshed fabrikam-fiber-inc/Fabrikam-Fiber-Git/Fabrikam-Fiber-Git',
    });
  });
});

describe('Git provider responses', () => {
  it('uses the commit hash from a Bitbucket branch', async () => {
    await h.memory.kvs.set('connections', [connection('bb', 'bitbucket', 'https://api.bitbucket.org/2.0', ['atlassian/*'])]);
    const branch = json('bitbucket-branch.json');
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://api.bitbucket.org/2.0/repositories/atlassian/aui/refs/branches/master') return response(200, branch);
      if (url === `https://api.bitbucket.org/2.0/repositories/atlassian/aui/src/${branch.target.hash}/openapi.yaml`) return response(200, SIMPLE_YAML);
      return response(404, 'nope');
    });
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'git', gitConnectionId: 'bb', gitRepo: 'atlassian/aui', gitRef: 'master', gitPath: 'openapi.yaml' } } });
    expect(res.ok).toBe(true);
  });

  it("uses SwaggerHub's default version", async () => {
    await h.memory.kvs.set('connections', [connection('sh', 'swaggerhub', 'https://api.swaggerhub.com', ['acme/*'])]);
    h.fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://api.swaggerhub.com/apis/acme/payments/settings/default') return response(200, fixture('swaggerhub-default-version.json'));
      if (url === 'https://api.swaggerhub.com/apis/acme/payments/1.0.0?resolved=true') return response(200, { openapi: '3.0.3', info: { title: 'Payments', version: '1.0.0' }, paths: {} });
      return response(404, 'nope');
    });
    const res = await call('loadSpec', {}, { extension: { config: { sourceType: 'git', gitConnectionId: 'sh', gitRepo: 'acme/payments' } } });
    expect(res.ok).toBe(true);
    expect(res.value.summary.version).toBe('1.0.0');
  });
});

describe('Confluence v2 responses', () => {
  it('follows the attachment cursor and keeps only spec files', async () => {
    h.userConfluence.mockImplementation(async (path: string) =>
      response(200, path.includes('cursor=') ? json('confluence-attachments-page2.json') : json('confluence-attachments-page1.json')),
    );
    const res = await call('listAttachments', {});
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([
      { title: 'events.json', mediaType: 'application/json', fileSize: 900, version: 1 },
      { title: 'openapi.yaml', mediaType: 'application/yaml', fileSize: 2048, version: 3 },
    ]);
    const paths = h.userConfluence.mock.calls.map(([path]) => String(path));
    expect(paths).toEqual(['/wiki/api/v2/pages/123/attachments?limit=250', '/wiki/api/v2/pages/123/attachments?limit=250&cursor=eyJpZCI6ImF0dDIifQ%3D%3D']);
  });

  it('reads titles and macro bodies from a pages bulk response', async () => {
    await h.memory.kvs.set('api:777:201:m-201', {
      spaceId: '777', contentId: '201', contentType: 'page', localId: 'm-201', title: 'Billing', version: '1', kind: 'openapi-3.0',
      operationCount: 3, sourceType: 'attachment', sourceLabel: 'openapi.yaml', fingerprint: 'f', updatedAt: new Date().toISOString(),
    });
    h.userConfluence.mockImplementation(async () => response(200, json('confluence-pages-bulk.json')));
    const res = await call('listSpaceApis', {}, { extension: { type: 'confluence:spacePage', content: undefined, space: { key: 'ENG', id: '777' } } });
    expect(res.ok).toBe(true);
    expect(res.value.apis).toMatchObject([{ title: 'Billing', pageTitle: 'Billing API', contentId: '201' }]);
    expect(await h.memory.kvs.get('api:777:201:m-201')).toBeDefined();
  });
});
