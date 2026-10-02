import { makeResolver } from '@forge/resolver';
import type { Defs } from './shared/defs';
import type { AppSettings, ConnectionOption } from './shared/types';
import { deleteConnection, saveConnection, testConnection } from './backend/admin';
import { listAudit, recordAudit } from './backend/audit';
import { requireAdmin } from './backend/auth';
import { INVOCATION_BUDGET_MS, withBudget } from './backend/budget';
import { effectiveConfig, isLicensedUser, readContext, requireLicense } from './backend/context';
import { asResult, fail } from './backend/errors';
import { exportMacro } from './backend/export';
import { loadSpec } from './backend/loadSpec';
import { proxyRequest } from './backend/proxy';
import { listSpecAttachments } from './backend/sources/attachment';
import { bumpCacheGeneration, getConnections, getSettings, saveSettings } from './backend/store';

// Every call gets a time budget under Forge's 25 s limit (see budget.ts).
const run = <T>(name: string, body: () => Promise<T>) => asResult(name, () => withBudget(INVOCATION_BUDGET_MS, body));

const settingsChanges = (before: AppSettings, after: AppSettings) =>
  (Object.keys(after) as Array<keyof AppSettings>).filter((k) => before[k] !== after[k]).map((k) => `${k}=${after[k]}`);

// One resolver for the macro, config modal and admin page.
export const handler = makeResolver<Defs>({
  loadSpec: ({ payload, context }) =>
    run('loadSpec', async () => {
      const ctx = readContext(context);
      return loadSpec(ctx, effectiveConfig(ctx, payload?.preview), { refresh: payload?.refresh });
    }),

  listAttachments: ({ context }) => run('listAttachments', () => listSpecAttachments(readContext(context))),

  getEditorOptions: ({ context }) =>
    run('getEditorOptions', async () => {
      const ctx = readContext(context);
      requireLicense(ctx);
      if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.editorOnly');
      const [settings, connections] = await Promise.all([getSettings(), getConnections()]);
      const available: ConnectionOption[] = connections
        .filter((c) => !c.spaceKeys.length || (ctx.spaceKey !== undefined && c.spaceKeys.includes(ctx.spaceKey)))
        .map(({ id, name, provider, repos, defaultRef }) => ({ id, name, provider, repos, ...(defaultRef ? { defaultRef } : {}) }));
      return { connections: available, urlSourcesEnabled: settings.urlSourcesEnabled, tryItOutEnabled: settings.tryItOutEnabled };
    }),

  proxyRequest: ({ payload, context }) =>
    run('proxyRequest', async () => {
      const ctx = readContext(context);
      return proxyRequest(ctx, effectiveConfig(ctx, payload?.preview), payload?.request);
    }),

  adminGetState: ({ context }) =>
    run('adminGetState', async () => {
      await requireAdmin(readContext(context));
      const [settings, connections] = await Promise.all([getSettings(), getConnections()]);
      return { settings, connections };
    }),

  adminSaveSettings: ({ payload, context }) =>
    run('adminSaveSettings', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      const before = await getSettings();
      const saved = await saveSettings(payload.settings);
      const changes = settingsChanges(before, saved);
      if (changes.length) await recordAudit(ctx.accountId, 'settings.update', undefined, changes);
      return saved;
    }),

  adminSaveConnection: ({ payload, context }) =>
    run('adminSaveConnection', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      const { connection, changes, created } = await saveConnection(payload.connection);
      if (created || changes.length) {
        await recordAudit(ctx.accountId, created ? 'connection.create' : 'connection.update', connection.name, changes);
      }
      return connection;
    }),

  adminDeleteConnection: ({ payload, context }) =>
    run('adminDeleteConnection', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      const removed = await deleteConnection(payload.id);
      await recordAudit(ctx.accountId, 'connection.delete', removed.name);
      return { id: payload.id };
    }),

  adminTestConnection: ({ payload, context }) =>
    run('adminTestConnection', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      return testConnection(ctx, payload);
    }),

  adminClearCache: ({ context }) =>
    run('adminClearCache', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      await bumpCacheGeneration();
      await recordAudit(ctx.accountId, 'cache.clear');
      return { cleared: true };
    }),

  adminGetAudit: ({ context }) =>
    run('adminGetAudit', async () => {
      await requireAdmin(readContext(context));
      return listAudit();
    }),

  adminRecordHostChange: ({ payload, context }) =>
    run('adminRecordHostChange', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      if (payload.action !== 'host.approve' && payload.action !== 'host.remove') fail('BAD_REQUEST', 'errors.generic');
      const host = String(payload.host ?? '').slice(0, 200);
      const group = String(payload.group ?? '').slice(0, 40);
      await recordAudit(ctx.accountId, payload.action, host, group ? [group] : undefined);
      return { recorded: true };
    }),
});

// adfExport handler (PDF/Word export, page history).
export const exportHandler = (payload: Parameters<typeof exportMacro>[0]) => withBudget(INVOCATION_BUDGET_MS, () => exportMacro(payload));
