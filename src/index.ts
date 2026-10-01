import { makeResolver } from '@forge/resolver';
import type { Defs } from './shared/defs';
import type { ConnectionOption } from './shared/types';
import { deleteConnection, saveConnection, testConnection } from './backend/admin';
import { requireAdmin } from './backend/auth';
import { effectiveConfig, isLicensedUser, readContext, requireLicense } from './backend/context';
import { asResult, fail } from './backend/errors';
import { exportMacro } from './backend/export';
import { loadSpec } from './backend/loadSpec';
import { proxyRequest } from './backend/proxy';
import { listSpecAttachments } from './backend/sources/attachment';
import { bumpCacheGeneration, getConnections, getSettings, saveSettings } from './backend/store';

// One resolver for the macro, config modal and admin page.
export const handler = makeResolver<Defs>({
  loadSpec: ({ payload, context }) =>
    asResult('loadSpec', async () => {
      const ctx = readContext(context);
      return loadSpec(ctx, effectiveConfig(ctx, payload?.preview), { refresh: payload?.refresh });
    }),

  listAttachments: ({ context }) => asResult('listAttachments', () => listSpecAttachments(readContext(context))),

  getEditorOptions: ({ context }) =>
    asResult('getEditorOptions', async () => {
      const ctx = readContext(context);
      requireLicense(ctx);
      if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'Only licensed Confluence users can edit this macro.');
      const [settings, connections] = await Promise.all([getSettings(), getConnections()]);
      const available: ConnectionOption[] = connections
        .filter((c) => !c.spaceKeys.length || (ctx.spaceKey !== undefined && c.spaceKeys.includes(ctx.spaceKey)))
        .map(({ id, name, provider, repos, defaultRef }) => ({ id, name, provider, repos, ...(defaultRef ? { defaultRef } : {}) }));
      return { connections: available, urlSourcesEnabled: settings.urlSourcesEnabled, tryItOutEnabled: settings.tryItOutEnabled };
    }),

  proxyRequest: ({ payload, context }) =>
    asResult('proxyRequest', async () => {
      const ctx = readContext(context);
      return proxyRequest(ctx, effectiveConfig(ctx, payload?.preview), payload?.request);
    }),

  adminGetState: ({ context }) =>
    asResult('adminGetState', async () => {
      await requireAdmin(readContext(context));
      const [settings, connections] = await Promise.all([getSettings(), getConnections()]);
      return { settings, connections };
    }),

  adminSaveSettings: ({ payload, context }) =>
    asResult('adminSaveSettings', async () => {
      await requireAdmin(readContext(context));
      return saveSettings(payload.settings);
    }),

  adminSaveConnection: ({ payload, context }) =>
    asResult('adminSaveConnection', async () => {
      await requireAdmin(readContext(context));
      return saveConnection(payload.connection);
    }),

  adminDeleteConnection: ({ payload, context }) =>
    asResult('adminDeleteConnection', async () => {
      await requireAdmin(readContext(context));
      await deleteConnection(payload.id);
      return { id: payload.id };
    }),

  adminTestConnection: ({ payload, context }) =>
    asResult('adminTestConnection', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      return testConnection(ctx, payload);
    }),

  adminClearCache: ({ context }) =>
    asResult('adminClearCache', async () => {
      await requireAdmin(readContext(context));
      await bumpCacheGeneration();
      return { cleared: true };
    }),
});

/** `adfExport` handler for PDF/Word export and page history. */
export const exportHandler = exportMacro;
