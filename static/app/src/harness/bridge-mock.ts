/**
 * Local stand-in for @forge/bridge, used only by `vite build --mode harness`
 * for browser tests. Behaviour is driven by `window.__SPECPAGE_HARNESS__`.
 */
type Handler = (payload: unknown) => unknown;

interface HarnessConfig {
  context?: Record<string, unknown>;
  resolvers?: Record<string, Handler>;
  egress?: Array<{ key: string; description: string; configured: Array<{ domain: string; type: string[] }> }>;
}

declare global {
  interface Window {
    __SPECPAGE_HARNESS__?: HarnessConfig;
    __SPECPAGE_CALLS__?: Array<{ fn: string; payload: unknown }>;
    __SPECPAGE_SUBMITTED__?: unknown;
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
        // Approximates the dark design tokens Forge injects, so dark styling can be checked
        // in tests. Set through the CSSOM, which the strict CSP allows.
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
    deleteDomain: async () => undefined,
    deleteGroup: async () => undefined,
  },
};
