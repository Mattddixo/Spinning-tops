import { makeResolver } from '@forge/resolver';
import type { Defs } from './shared/defs';
import type { AppSettings, ConnectionOption } from './shared/types';
import { deleteConnection, disableWebhook, enableWebhook, saveConnection, testConnection, webhookUrlFor } from './backend/admin';
import { listAudit, recordAudit } from './backend/audit';
import { requireAdmin } from './backend/auth';
import { INVOCATION_BUDGET_MS, withBudget } from './backend/budget';
import { effectiveConfig, isLicensedUser, readContext, requireLicense } from './backend/context';
import { asResult, fail } from './backend/errors';
import { listSiteApis, listSpaceApis, recordApi } from './backend/catalog';
import { compareSpec } from './backend/compare';
import { exportMacro } from './backend/export';
import { loadSpec } from './backend/loadSpec';
import { saveApprovedHosts } from './backend/hosts';
import { proxyRequest } from './backend/proxy';
import { handleWebhook, type WebTriggerRequest } from './backend/webhook';
import { listSpecAttachments, readAttachmentForEditing } from './backend/sources/attachment';
import { hostOf } from './shared/git';
import { bumpCacheGeneration, getConnection, getConnections, getSettings, saveSettings } from './backend/store';

// Every call gets a time budget under Forge's 25 s limit (see budget.ts).
const run = <T>(name: string, body: () => Promise<T>) => asResult(name, () => withBudget(INVOCATION_BUDGET_MS, body));

const settingsChanges = (before: AppSettings, after: AppSettings) =>
  (Object.keys(after) as Array<keyof AppSettings>).filter((k) => before[k] !== after[k]).map((k) => `${k}=${after[k]}`);

// One resolver for the macro, config modal and admin page.
export const handler = makeResolver<Defs>({
  loadSpec: ({ payload, context }) =>
    run('loadSpec', async () => {
      const ctx = readContext(context);
      const config = effectiveConfig(ctx, payload?.preview);
      const result = await loadSpec(ctx, config, { refresh: payload?.refresh });
      // Only saved macros go in the space's API list, not previews or unsaved pasted links.
      if (!payload?.preview && !result.meta.autoConverted) await recordApi(ctx, config, result.summary, result.meta.sourceLabel);
      return result;
    }),

  compareSpec: ({ payload, context }) =>
    run('compareSpec', async () => {
      const ctx = readContext(context);
      // Saved settings only; there's nothing to compare in an unsaved preview.
      return compareSpec(ctx, ctx.config, payload?.target ?? {});
    }),

  listSpaceApis: ({ context }) =>
    run('listSpaceApis', async () => {
      const ctx = readContext(context);
      requireLicense(ctx);
      if (!ctx.spaceId) fail('BAD_REQUEST', 'errors.catalogNeedsSpace');
      return { spaceKey: ctx.spaceKey, ...(await listSpaceApis(ctx, ctx.spaceId as string)) };
    }),

  listSiteApis: ({ context }) =>
    run('listSiteApis', async () => {
      const ctx = readContext(context);
      requireLicense(ctx);
      return listSiteApis(ctx);
    }),

  listAttachments: ({ context }) => run('listAttachments', () => listSpecAttachments(readContext(context))),

  readAttachment: ({ payload, context }) =>
    run('readAttachment', async () => {
      const ctx = readContext(context);
      requireLicense(ctx);
      return readAttachmentForEditing(ctx, String(payload?.filename ?? ''));
    }),

  getEditorOptions: ({ context }) =>
    run('getEditorOptions', async () => {
      const ctx = readContext(context);
      requireLicense(ctx);
      if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.editorOnly');
      const [settings, connections] = await Promise.all([getSettings(), getConnections()]);
      const available: ConnectionOption[] = connections
        .filter((c) => !c.spaceKeys.length || (ctx.spaceKey !== undefined && c.spaceKeys.includes(ctx.spaceKey)))
        .map(({ id, name, provider, repos, defaultRef, webBaseUrl }) => ({
          id,
          name,
          provider,
          repos,
          webHost: hostOf(webBaseUrl),
          ...(defaultRef ? { defaultRef } : {}),
        }));
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

  adminEnableWebhook: ({ payload, context }) =>
    run('adminEnableWebhook', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      const result = await enableWebhook(payload?.id);
      await recordAudit(ctx.accountId, 'webhook.enable', result.connection.name);
      return result;
    }),

  adminDisableWebhook: ({ payload, context }) =>
    run('adminDisableWebhook', async () => {
      const ctx = readContext(context);
      await requireAdmin(ctx);
      const connection = await disableWebhook(payload?.id);
      await recordAudit(ctx.accountId, 'webhook.disable', connection.name);
      return connection;
    }),

  adminGetWebhookUrl: ({ payload, context }) =>
    run('adminGetWebhookUrl', async () => {
      await requireAdmin(readContext(context));
      const connection = await getConnection(String(payload?.id ?? ''));
      if (!connection?.webhookEnabled) fail('NOT_FOUND', 'errors.connectionGone');
      return { url: await webhookUrlFor((connection as { id: string }).id) };
    }),

  adminSyncHosts: ({ payload, context }) =>
    run('adminSyncHosts', async () => {
      await requireAdmin(readContext(context));
      return saveApprovedHosts(payload?.hosts);
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

// Git push webhooks (web trigger; public URL, verified per connection in webhook.ts).
export const webhookHandler = (request: WebTriggerRequest) => handleWebhook(request);

// adfExport handler (PDF/Word export, page history).
export const exportHandler = (payload: Parameters<typeof exportMacro>[0]) => withBudget(INVOCATION_BUDGET_MS, () => exportMacro(payload));
