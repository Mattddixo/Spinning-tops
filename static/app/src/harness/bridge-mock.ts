// Fake @forge/bridge for the Playwright harness build (vite --mode harness).
// Tests configure it through window.__SPECPAGE_HARNESS__.
type Handler = (payload: unknown) => unknown;

type ConfluenceHandler = (path: string, init: { method: string; fields: Record<string, string>; files: Record<string, { name: string; type: string; text: string }> }) => {
  status: number;
  body?: unknown;
};

interface HarnessConfig {
  context?: Record<string, unknown>;
  resolvers?: Record<string, Handler>;
  /** Stands in for the Confluence REST API behind requestConfluence (uploads). */
  confluence?: ConfluenceHandler;
  egress?: Array<{ key: string; description: string; configured: Array<{ domain: string; type: string[] }> }>;
}

declare global {
  interface Window {
    __SPECPAGE_HARNESS__?: HarnessConfig;
    __SPECPAGE_CALLS__?: Array<{ fn: string; payload: unknown }>;
    __SPECPAGE_SUBMITTED__?: unknown;
    __SPECPAGE_CONFLUENCE__?: Array<{ path: string; method: string; headers: Record<string, string>; fields: Record<string, string>; files: Record<string, { name: string; type: string; text: string }> }>;
  }
}

const harness = (): HarnessConfig => window.__SPECPAGE_HARNESS__ ?? {};

export async function invoke(functionKey: string, payload?: unknown) {
  (window.__SPECPAGE_CALLS__ ??= []).push({ fn: functionKey, payload });
  const handler = harness().resolvers?.[functionKey];
  if (!handler) return { ok: false, error: { code: 'INTERNAL', message: `No harness resolver for ${functionKey}` } };
  return handler(payload);
}

export const makeInvoke = () => invoke;

export async function requestConfluence(path: string, init: RequestInit = {}): Promise<Response> {
  const fields: Record<string, string> = {};
  const files: Record<string, { name: string; type: string; text: string }> = {};
  if (init.body instanceof FormData) {
    for (const [key, value] of init.body.entries()) {
      if (typeof value === 'string') fields[key] = value;
      else files[key] = { name: value.name, type: value.type, text: await value.text() };
    }
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  (window.__SPECPAGE_CONFLUENCE__ ??= []).push({ path, method, headers, fields, files });
  const handler = harness().confluence;
  const result = handler ? handler(path, { method, fields, files }) : { status: 404, body: { message: 'no harness handler' } };
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
}

export const view = {
  getContext: async () => harness().context ?? { extension: {} },
  submit: async (payload: unknown) => {
    window.__SPECPAGE_SUBMITTED__ = payload;
  },
  close: async () => undefined,
  emitReadyEvent: async () => {
    document.documentElement.dataset.ready = 'true';
  },
  theme: {
    enable: async () => {
      const mode = new URLSearchParams(location.search).get('mode') ?? 'light';
      const root = document.documentElement;
      root.setAttribute('data-color-mode', mode);
      if (mode === 'dark') {
        // rough copy of the dark tokens Forge injects
        const tokens: Record<string, string> = {
          '--ds-surface': '#1d2125',
          '--ds-surface-raised': '#22272b',
          '--ds-surface-sunken': '#161a1d',
          '--ds-surface-overlay': '#282e33',
          '--ds-text': '#b6c2cf',
          '--ds-text-subtle': '#9fadbc',
          '--ds-text-subtlest': '#8c9bab',
          '--ds-link': '#579dff',
          '--ds-border': '#a6c5e229',
          '--ds-border-input': '#738496',
          '--ds-background-input': '#22272b',
          '--ds-background-neutral': '#a1bdd914',
          '--ds-background-neutral-hovered': '#a6c5e229',
          '--ds-background-brand-bold': '#579dff',
          '--ds-text-inverse': '#1d2125',
          '--ds-background-selected': '#1c2b41',
          '--ds-text-selected': '#579dff',
        };
        for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
        root.style.backgroundColor = tokens['--ds-surface'];
      }
    },
  },
};

export const router = { open: async () => undefined, navigate: async () => undefined };

export const permissions = {
  egress: {
    get: async () => ({ results: harness().egress ?? [] }),
    set: async (payload: { egresses: HarnessConfig['egress'] }) => {
      const current = harness().egress ?? [];
      for (const group of payload.egresses ?? []) {
        const idx = current.findIndex((g) => g.key === group.key);
        if (idx >= 0) current[idx] = group;
        else current.push(group);
      }
      window.__SPECPAGE_HARNESS__ = { ...harness(), egress: current };
      return { results: current };
    },
    deleteDomain: async ({ key, domain }: { key: string; domain: string }) => {
      const group = (harness().egress ?? []).find((g) => g.key === key);
      if (group) group.configured = group.configured.filter((c) => c.domain !== domain);
    },
    deleteGroup: async () => undefined,
  },
};
