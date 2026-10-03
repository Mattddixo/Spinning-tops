import { gunzipSync } from 'node:zlib';
import { vi } from 'vitest';
import { createMemoryKvs } from './memoryKvs';

// Shared Forge mocks for the backend tests. Each test file registers them with
//   vi.mock('@forge/api', async () => (await import('./helpers/forge')).forgeApiMock());
//   vi.mock('@forge/kvs', async () => (await import('./helpers/forge')).forgeKvsMock());
// and calls resetForge() in beforeEach. This module doesn't import the app at
// load time, so the mocks are in place before anything reaches @forge/api.

class NotAllowedError extends Error {}

export const h = {
  memory: undefined as unknown as ReturnType<typeof createMemoryKvs>,
  fetchMock: vi.fn(),
  userConfluence: vi.fn(),
  appConfluence: vi.fn(),
  NotAllowedError,
};

export async function forgeKvsMock() {
  const actual = await vi.importActual<typeof import('@forge/kvs')>('@forge/kvs');
  return {
    WhereConditions: actual.WhereConditions,
    get kvs() {
      return h.memory.kvs;
    },
  };
}

// The real `route` is kept so the tests see the same escaping Forge does.
export async function forgeApiMock() {
  const actual = await vi.importActual<typeof import('@forge/api')>('@forge/api');
  return {
    route: actual.route,
    fetch: (...args: unknown[]) => h.fetchMock(...args),
    asUser: () => ({ requestConfluence: (path: { value: string }, init: unknown) => h.userConfluence(path.value, init) }),
    asApp: () => ({ requestConfluence: (path: { value: string }, init: unknown) => h.appConfluence(path.value, init) }),
    NotAllowedError: h.NotAllowedError,
    webTrigger: { getUrl: async (key: string) => `https://abc.hello.atlassian-dev.net/x1/trigger-${key}` },
  };
}

export async function resetForge() {
  h.memory = createMemoryKvs();
  // As synced from the settings page: one Try it out host, one spec host.
  await h.memory.kvs.set('approved-hosts', { git: ['https://api.github.com'], specs: ['https://docs.example.com'], apis: ['https://api.example.com'], syncedAt: 'x' });
  h.fetchMock.mockReset();
  h.userConfluence.mockReset();
  h.appConfluence.mockReset();
}

export const decode = (specGz: string) => JSON.parse(gunzipSync(Buffer.from(specGz, 'base64')).toString('utf8'));

export function response(status: number, body: string | object | Buffer, headers: Record<string, string> = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const text = bytes.toString('utf8');
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { forEach: (cb: (v: string, k: string) => void) => map.forEach((v, k) => cb(v, k)), get: (k: string) => map.get(k.toLowerCase()) ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}


export type Account = 'licensed' | 'unlicensed' | 'anonymous';

export async function call(
  functionKey: string,
  payload: unknown,
  opts: { account?: Account; extension?: Record<string, unknown>; license?: unknown; localId?: string } = {},
) {
  const account = opts.account ?? 'licensed';
  const accountId = account === 'anonymous' ? undefined : 'user-1';
  const { handler } = await import('../../src/index');
  return handler(
    {
      call: { functionKey, payload: payload as Record<string, unknown> },
      context: {
        accountType: account,
        localId: opts.localId ?? 'macro-1',
        extension: { type: 'macro', content: { id: '123', type: 'page' }, space: { key: 'ENG', id: '777' }, ...opts.extension },
      },
    } as never,
    { principal: { accountId }, license: opts.license },
  ) as Promise<{ ok: boolean; value?: any; error?: { code: string; message: string; key?: string; params?: Record<string, unknown>; hintKey?: string; detail?: string } }>;
}


export const ROOT_YAML = `openapi: 3.0.3
info: { title: Payments, version: '2.0' }
paths:
  /payments:
    get:
      summary: List payments
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: './schemas/payment.yaml' }
`;
export const PAYMENT_YAML = `type: object
properties:
  id: { type: string }
`;

export async function seedGithub(extra: Partial<Record<string, unknown>> = {}) {
  await h.memory.kvs.set('connections', [
    {
      id: 'c1',
      name: 'GitHub',
      provider: 'github',
      apiBaseUrl: 'https://api.github.com',
      webBaseUrl: 'https://github.com',
      authType: 'bearer',
      repos: ['acme/*'],
      spaceKeys: [],
      hasToken: true,
      createdAt: 'x',
      updatedAt: 'x',
      ...extra,
    },
  ]);
  await h.memory.kvs.setSecret('connection-token:c1', 'ghp_secret');
}

export const gitConfig = { sourceType: 'git', gitConnectionId: 'c1', gitRepo: 'acme/payments', gitRef: 'main', gitPath: 'api/openapi.yaml' };

export const SIMPLE_YAML = ROOT_YAML.replace("{ $ref: './schemas/payment.yaml' }", '{ type: string }');

export const ASYNC_YAML = `asyncapi: 3.0.0
info:
  title: Account Service
  version: 1.0.0
channels:
  userSignedup:
    address: user/signedup
    messages:
      UserSignedUp:
        payload:
          type: object
          properties:
            email: { type: string, format: email }
operations:
  sendUserSignedup:
    action: send
    channel: { $ref: '#/channels/userSignedup' }
    messages:
      - $ref: '#/channels/userSignedup/messages/UserSignedUp'
`;
