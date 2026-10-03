import { notice } from '../shared/messages';
import { isAsyncApi, resolveServers, summarizeSpec } from '../shared/spec';
import { parseAsyncApi } from './asyncapi';
import type { AppSettings, LoadSpecResponse, MacroConfig } from '../shared/types';
import { loadAndBundle } from './bundle';
import { readCache, writeCache, type CachedSpec } from './cache';
import { isLicensedUser, requireLicense, type SecureContext } from './context';
import { encodeJsonText, encodeSpec } from './encoding';
import { fail } from './errors';
import { MAX_INLINE_CHARS } from './limits';
import { attachmentSource } from './sources/attachment';
import { hostOf, matchConnection, parseGitFileLink } from '../shared/git';
import { gitSource } from './sources/git';
import { getConnections } from './store';
import { isSyntheticUrl, syntheticUrl, type SpecSource } from './sources/types';
import { urlSource } from './sources/url';
import { getSettings } from './store';

export { MAX_INLINE_CHARS };

function inlineSource(text: string | undefined): { source: SpecSource; rootText: string } {
  const rootText = (text ?? '').trim();
  if (!rootText) fail('NOT_CONFIGURED', 'errors.inlineEmpty');
  if (rootText.length > MAX_INLINE_CHARS) {
    fail('TOO_LARGE', 'errors.inlineTooLarge', { max: MAX_INLINE_CHARS.toLocaleString('en-US') }, { hint: 'hints.useAttachmentOrGit' });
  }
  return {
    rootText,
    source: {
      label: 'Pasted spec',
      cacheKey: undefined,
      baseUrl: syntheticUrl('inline', 'spec.yaml'),
      read: async () => fail('BAD_REQUEST', 'errors.inlineNoRelativeRefs'),
    },
  };
}

export interface SourceOverrides {
  /** Load a different Git ref than the one saved on the macro (used for comparisons). */
  gitRef?: string;
  /** Load an older attachment version (used for comparisons). */
  attachmentVersion?: number;
}

export async function selectSource(
  ctx: SecureContext,
  config: MacroConfig,
  settings: AppSettings,
  overrides: SourceOverrides = {},
): Promise<{ source: SpecSource; rootText?: string }> {
  switch (config.sourceType) {
    case 'attachment':
      return { source: attachmentSource(ctx, config.attachment ?? '', { version: overrides.attachmentVersion }) };
    case 'git':
      return {
        source: await gitSource(ctx, {
          connectionId: config.gitConnectionId,
          repo: config.gitRepo,
          ref: overrides.gitRef ?? config.gitRef,
          path: config.gitPath,
        }),
      };
    case 'url':
      return { source: urlSource(settings, config.url) };
    case 'inline':
      return inlineSource(config.inlineSpec);
    default:
      return fail('NOT_CONFIGURED', 'errors.notConfigured', undefined, { hint: 'hints.editToConfigure' });
  }
}

/** Fetch, bundle and post-process a spec without touching the cache. */
export async function buildSpec(source: SpecSource, settings: AppSettings, rootText?: string): Promise<CachedSpec & { spec: Record<string, unknown> }> {
  const bundled = await loadAndBundle(source, { allowExternalUrls: settings.urlSourcesEnabled, rootText });
  const warnings = [...bundled.warnings];
  if (isAsyncApi(bundled.summary.kind)) {
    return {
      spec: bundled.spec,
      specGz: encodeJsonText(await parseAsyncApi(bundled.spec)),
      summary: bundled.summary,
      fileCount: bundled.fileCount,
      warnings,
      serversResolvable: true,
      fetchedAt: new Date().toISOString(),
    };
  }
  // Only URL sources have a real location to resolve relative servers against.
  const specUrl = isSyntheticUrl(source.baseUrl) ? undefined : source.baseUrl;
  const servers = resolveServers(bundled.spec, bundled.summary.kind, specUrl);
  if (servers.resolvedAgainst) warnings.push(notice('warnings.serversResolved', { base: servers.resolvedAgainst }));
  const spec = servers.spec;
  return {
    spec,
    specGz: encodeSpec(spec),
    summary: servers.spec === bundled.spec ? bundled.summary : summarizeSpec(spec, bundled.summary.kind),
    fileCount: bundled.fileCount,
    warnings,
    serversResolvable: servers.resolvable,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * The spec from the cache, or built from the source (and cached). `spec` is
 * only set when it was built; cached copies keep just the encoded form.
 */
export async function cachedOrBuilt(
  source: SpecSource,
  settings: AppSettings,
  rootText?: string,
  options: { refresh?: boolean } = {},
): Promise<{ result: CachedSpec; fromCache: boolean; spec?: Record<string, unknown> }> {
  if (source.cacheKey && !options.refresh) {
    const cached = await readCache(source.cacheKey, settings.cacheTtlMinutes);
    if (cached) return { result: cached, fromCache: true };
  }
  const { spec, ...built } = await buildSpec(source, settings, rootText);
  const result: CachedSpec = { ...built, ...(source.link ? { sourceLink: source.link } : {}) };
  if (source.cacheKey) await writeCache(source.cacheKey, settings.cacheTtlMinutes, result);
  return { result, fromCache: false, spec };
}

/**
 * A macro inserted by pasting a link has no saved settings yet, only the link
 * (from the Forge context, so it can be trusted). Work out the Git or
 * SwaggerHub settings it stands for so the docs show straight away.
 */
export async function configFromLink(ctx: SecureContext, link: string): Promise<MacroConfig> {
  const parsed = parseGitFileLink(link);
  if (!parsed) return fail('NOT_CONFIGURED', 'errors.notConfigured', undefined, { hint: 'hints.editToConfigure' });
  const connections = (await getConnections())
    .filter((c) => !c.spaceKeys.length || (ctx.spaceKey !== undefined && c.spaceKeys.includes(ctx.spaceKey)))
    .map((c) => ({ ...c, webHost: hostOf(c.webBaseUrl) }));
  const connection = matchConnection(parsed, connections);
  if (!connection) {
    return fail('NOT_CONFIGURED', 'errors.autoConvertNoConnection', { repo: parsed.repo, host: parsed.host }, { hint: 'hints.askAdminAddRepo' });
  }
  return {
    sourceType: 'git',
    gitConnectionId: connection.id,
    gitRepo: parsed.repo,
    ...(parsed.ref ? { gitRef: parsed.ref } : {}),
    ...(parsed.path ? { gitPath: parsed.path } : {}),
  };
}

/** The macro's saved settings, or the ones a pasted link stands for. */
export async function resolveMacroConfig(ctx: SecureContext, savedConfig: MacroConfig): Promise<{ config: MacroConfig; autoConverted: boolean }> {
  const autoConverted = !savedConfig.sourceType && Boolean(ctx.autoConvertLink);
  const config = autoConverted ? { ...savedConfig, ...(await configFromLink(ctx, ctx.autoConvertLink as string)) } : savedConfig;
  return { config, autoConverted };
}

export async function loadSpec(
  ctx: SecureContext,
  savedConfig: MacroConfig,
  options: { refresh?: boolean } = {},
): Promise<LoadSpecResponse> {
  requireLicense(ctx);
  const { config, autoConverted } = await resolveMacroConfig(ctx, savedConfig);
  const settings = await getSettings();
  const { source, rootText } = await selectSource(ctx, config, settings);
  // only licensed users can skip the cache
  const refresh = options.refresh === true && isLicensedUser(ctx);
  const tryItOutAllowed = settings.tryItOutEnabled && config.tryItOut === true && isLicensedUser(ctx);

  const { result, fromCache } = await cachedOrBuilt(source, settings, rootText, { refresh });

  const warnings = [...result.warnings];
  if (!result.serversResolvable && !config.serverUrl && tryItOutAllowed) warnings.push(notice('warnings.relativeServers'));

  return {
    specGz: result.specGz,
    summary: result.summary,
    // AsyncAPI has no request runner.
    tryItOutAllowed: tryItOutAllowed && !isAsyncApi(result.summary.kind),
    meta: {
      sourceLabel: source.label,
      sourceLink: result.sourceLink ?? source.link,
      fetchedAt: result.fetchedAt,
      fromCache,
      fileCount: result.fileCount,
      warnings,
      serversResolvable: result.serversResolvable,
      ...(autoConverted ? { autoConverted: config } : {}),
    },
  };
}
