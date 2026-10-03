import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForge, h, response, call, SIMPLE_YAML, seedGithub, gitConfig } from './helpers/forge';

vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());

import { webhookHandler } from '../src/index';

beforeEach(resetForge);

describe('Git webhooks', () => {
  const admin = () => response(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
  const push = { ref: 'refs/heads/main', repository: { full_name: 'acme/payments' } };
  const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const post = (headers: Record<string, string>, body: unknown, connection = 'c1') =>
    webhookHandler({
      method: 'POST',
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])),
      body: typeof body === 'string' ? body : JSON.stringify(body),
      queryParameters: { connection: [connection] },
    });
  const status = async (p: Promise<{ statusCode: number }>) => (await p).statusCode;

  async function enable(id = 'c1') {
    h.userConfluence.mockImplementation(async () => admin());
    const res = await call('adminEnableWebhook', { id });
    expect(res.ok).toBe(true);
    return res.value as { url: string; secret: string; connection: { webhookEnabled?: boolean } };
  }

  it('gives admins a URL and a one-time secret', async () => {
    await seedGithub();
    const { url, secret, connection } = await enable();
    expect(url).toBe('https://abc.hello.atlassian-dev.net/x1/trigger-git-webhook?connection=c1');
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(connection.webhookEnabled).toBe(true);
    expect(JSON.stringify((await call('adminGetState', {})).value)).not.toContain(secret);
    expect((await call('adminGetWebhookUrl', { id: 'c1' })).value.url).toBe(url);
    const log = (await call('adminGetAudit', {})).value as Array<{ action: string }>;
    expect(log[0].action).toBe('webhook.enable');
    h.userConfluence.mockImplementation(async () => response(200, { operations: [] }));
    expect((await call('adminEnableWebhook', { id: 'c1' })).error?.code).toBe('FORBIDDEN');
  });

  it('refreshes cached specs when GitHub reports a signed push', async () => {
    await seedGithub();
    const { secret } = await enable();
    h.fetchMock.mockImplementation(async () => response(200, SIMPLE_YAML));
    await call('loadSpec', {}, { extension: { config: gitConfig } });
    expect((await call('loadSpec', {}, { extension: { config: gitConfig } })).value.meta.fromCache).toBe(true);

    const body = JSON.stringify(push);
    const res = await post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, body) }, body);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBe('Refreshed acme/payments');
    expect((await call('loadSpec', {}, { extension: { config: gitConfig } })).value.meta.fromCache).toBe(false);
  });

  it('rejects bad signatures and hides unknown connections', async () => {
    await seedGithub();
    const { secret } = await enable();
    const body = JSON.stringify(push);
    expect(await status(post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign('wrong', body) }, body))).toBe(401);
    expect(await status(post({ 'X-GitHub-Event': 'push' }, body))).toBe(401);
    // signed for a different body
    expect(await status(post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, '{}') }, body))).toBe(401);
    expect(await status(post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, body) }, body, 'nope'))).toBe(404);
    expect(await status(post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, body) }, body, '../c1'))).toBe(404);
    expect((await webhookHandler({ method: 'GET', queryParameters: { connection: ['c1'] } })).statusCode).toBe(405);
  });

  it('ignores pings, other repos, and stops after the webhook is turned off', async () => {
    await seedGithub();
    const { secret } = await enable();
    const ping = JSON.stringify({ zen: 'hi' });
    const pinged = await post({ 'X-GitHub-Event': 'ping', 'X-Hub-Signature-256': sign(secret, ping) }, ping);
    expect(pinged.statusCode).toBe(200);
    expect(JSON.parse(pinged.body).message).toContain('not a push');
    const other = JSON.stringify({ repository: { full_name: 'evil/repo' } });
    const ignored = await post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, other) }, other);
    expect(JSON.parse(ignored.body).message).toContain('not allowed');
    expect([...h.memory.values.keys()].some((k) => k.startsWith('repo-generation:'))).toBe(false);

    expect((await call('adminDisableWebhook', { id: 'c1' })).ok).toBe(true);
    const body = JSON.stringify(push);
    expect(await status(post({ 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sign(secret, body) }, body))).toBe(404);
    expect(h.memory.secrets.has('webhook-secret:c1')).toBe(false);
  });

  it('checks GitLab tokens, Bitbucket signatures and Azure DevOps basic auth', async () => {
    await h.memory.kvs.set('connections', [
      { id: 'g1', name: 'GL', provider: 'gitlab', apiBaseUrl: 'https://gitlab.com/api/v4', webBaseUrl: 'https://gitlab.com', authType: 'none', repos: ['grp/*'], spaceKeys: [], hasToken: false, createdAt: 'x', updatedAt: 'x' },
      { id: 'b1', name: 'BB', provider: 'bitbucket', apiBaseUrl: 'https://api.bitbucket.org/2.0', webBaseUrl: 'https://bitbucket.org', authType: 'none', repos: ['ws/*'], spaceKeys: [], hasToken: false, createdAt: 'x', updatedAt: 'x' },
      { id: 'a1', name: 'AZ', provider: 'azure', apiBaseUrl: 'https://dev.azure.com', webBaseUrl: 'https://dev.azure.com', authType: 'none', repos: ['contoso/*'], spaceKeys: [], hasToken: false, createdAt: 'x', updatedAt: 'x' },
    ]);
    const gl = (await enable('g1')).secret;
    const bb = (await enable('b1')).secret;
    const az = (await enable('a1')).secret;

    const glBody = { project: { path_with_namespace: 'grp/api' } };
    expect(await status(post({ 'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': 'nope' }, glBody, 'g1'))).toBe(401);
    expect(JSON.parse((await post({ 'X-Gitlab-Event': 'Tag Push Hook', 'X-Gitlab-Token': gl }, glBody, 'g1')).body).message).toBe('Refreshed grp/api');

    const bbBody = JSON.stringify({ repository: { full_name: 'ws/api' } });
    expect(await status(post({ 'X-Event-Key': 'repo:push', 'X-Hub-Signature': sign('x', bbBody) }, bbBody, 'b1'))).toBe(401);
    expect(JSON.parse((await post({ 'X-Event-Key': 'repo:push', 'X-Hub-Signature': sign(bb, bbBody) }, bbBody, 'b1')).body).message).toBe('Refreshed ws/api');

    const azBody = { eventType: 'git.push', resource: { repository: { name: 'payments', project: { name: 'Fabrikam Fiber' }, remoteUrl: 'https://contoso@dev.azure.com/contoso/Fabrikam%20Fiber/_git/payments' } } };
    const basic = (pw: string) => `Basic ${Buffer.from(`anyone:${pw}`).toString('base64')}`;
    expect(await status(post({ Authorization: basic('wrong') }, azBody, 'a1'))).toBe(401);
    expect(JSON.parse((await post({ Authorization: basic(az) }, azBody, 'a1')).body).message).toBe('Refreshed contoso/Fabrikam Fiber/payments');
    // A push whose repo can't be read refreshes the whole connection.
    expect(JSON.parse((await post({ Authorization: basic(az) }, { eventType: 'git.push', resource: {} }, 'a1')).body).message).toBe('Refreshed all repositories on this connection');
    // Secrets are per connection.
    expect(await status(post({ 'X-Gitlab-Event': 'Push Hook', 'X-Gitlab-Token': bb }, glBody, 'g1'))).toBe(401);
  });

  it('keeps the webhook when a connection is edited, drops it on a provider change, and cleans up on delete', async () => {
    h.userConfluence.mockImplementation(async () => admin());
    const input = { name: 'Acme', provider: 'github', apiBaseUrl: 'https://api.github.com', webBaseUrl: 'https://github.com', authType: 'none', repos: ['acme/*'], spaceKeys: [] };
    const saved = await call('adminSaveConnection', { connection: input });
    const id = saved.value.id as string;
    await enable(id);
    const renamed = await call('adminSaveConnection', { connection: { ...input, id, name: 'Renamed' } });
    expect(renamed.value.webhookEnabled).toBe(true);
    const moved = await call('adminSaveConnection', { connection: { ...input, id, provider: 'gitlab', apiBaseUrl: 'https://gitlab.com/api/v4', webBaseUrl: 'https://gitlab.com' } });
    expect(moved.value.webhookEnabled).toBeUndefined();
    expect(h.memory.secrets.has(`webhook-secret:${id}`)).toBe(false);
    await enable(id);
    await call('adminDeleteConnection', { id });
    expect(h.memory.secrets.has(`webhook-secret:${id}`)).toBe(false);
  });

  it('refuses SwaggerHub connections', async () => {
    await h.memory.kvs.set('connections', [
      { id: 's1', name: 'SH', provider: 'swaggerhub', apiBaseUrl: 'https://api.swaggerhub.com', webBaseUrl: 'https://app.swaggerhub.com', authType: 'none', repos: ['acme/*'], spaceKeys: [], hasToken: false, createdAt: 'x', updatedAt: 'x' },
    ]);
    h.userConfluence.mockImplementation(async () => admin());
    expect((await call('adminEnableWebhook', { id: 's1' })).error?.key).toBe('errors.webhookUnsupported');
  });
});

describe('Azure DevOps push payloads', () => {
  it('reads the repo from its own fields and the organization from the URL', async () => {
    const { azurePushedRepo } = await import('../src/backend/webhook');
    const push = (remoteUrl: string, project = 'Web', name = 'site') => ({ resource: { repository: { name, project: { name: project }, remoteUrl } } });
    expect(azurePushedRepo(push('https://dev.azure.com/contoso/Web/_git/site'))).toBe('contoso/Web/site');
    expect(azurePushedRepo(push('https://contoso@dev.azure.com/contoso/Web/_git/site'))).toBe('contoso/Web/site');
    // collection-style and project-less URLs from Azure's own samples
    expect(azurePushedRepo(push('https://contoso.visualstudio.com/DefaultCollection/_git/site'))).toBe('contoso/Web/site');
    expect(azurePushedRepo(push('https://contoso.visualstudio.com/_git/site', 'site'))).toBe('contoso/site/site');
    expect(azurePushedRepo(push('https://example.com/x'))).toBeUndefined();
    expect(azurePushedRepo({ resource: {} })).toBeUndefined();
    // Microsoft's documented git.push sample (trimmed): collection-style URLs everywhere.
    const documented = {
      eventType: 'git.push',
      resource: {
        repository: {
          id: 'f5f5f5f5-aaaa-bbbb-cccc-d6d6d6d6d6d6',
          name: 'Fabrikam-Fiber-Git',
          url: 'https://dev.azure.com/fabrikam-fiber-inc/DefaultCollection/_apis/repos/git/repositories/f5f5f5f5-aaaa-bbbb-cccc-d6d6d6d6d6d6',
          project: { id: 'a6a6a6a6-bbbb-cccc-dddd-e7e7e7e7e7e7', name: 'Fabrikam-Fiber-Git' },
          remoteUrl: 'https://dev.azure.com/fabrikam-fiber-inc/DefaultCollection/_git/Fabrikam-Fiber-Git',
        },
      },
      resourceContainers: { account: { id: 'bbbb1b1b-cc2c-dd3d-ee4e-ffffff5f5f5f', baseUrl: 'https://dev.azure.com/fabrikam-fiber-inc/' } },
    };
    expect(azurePushedRepo(documented)).toBe('fabrikam-fiber-inc/Fabrikam-Fiber-Git/Fabrikam-Fiber-Git');
    // Without URLs on the repository, the organization comes from resourceContainers.
    const { url: _u, remoteUrl: _r, ...bare } = documented.resource.repository;
    expect(azurePushedRepo({ ...documented, resource: { repository: bare } })).toBe('fabrikam-fiber-inc/Fabrikam-Fiber-Git/Fabrikam-Fiber-Git');
  });
});
