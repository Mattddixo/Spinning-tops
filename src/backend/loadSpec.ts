import type { AppSettings, LoadSpecResponse, MacroConfig } from '../shared/types';
import { loadAndBundle } from './bundle';
import { readCache, writeCache } from './cache';
import { isLicensedUser, requireLicense, type SecureContext } from './context';
import { fail } from './errors';
import { getSettings } from './store';
import { attachmentSource } from './sources/attachment';
import { gitSource } from './sources/git';
import { syntheticUrl, type SpecSource } from './sources/types';
import { urlSource } from './sources/url';

/** Inline specs are stored in the page's macro parameters, so keep them modest. */
export const MAX_INLINE_CHARS = 100_000;

function inlineSource(text: string | undefined): { source: SpecSource; rootText: string } {
  const rootText = (text ?? '').trim();
  if (!rootText) fail('NOT_CONFIGURED', 'Paste an OpenAPI or Swagger document in the macro settings.');
  if (rootText.length > MAX_INLINE_CHARS) {
    fail('TOO_LARGE', 'Pasted specs are limited to 100,000 characters.', 'Attach the file to the page or load it from Git instead.');
  }
  const baseUrl = syntheticUrl('inline', 'spec.yaml');
  return {
    rootText,
    source: {
      label: 'Pasted spec',
      cacheKey: undefined,
      baseUrl,
      read: async () => fail('BAD_REQUEST', 'Pasted specs can only reference https:// URLs, not relative files.'),
    },
  };
}

export async function selectSource(
  ctx: SecureContext,
  config: MacroConfig,
  settings: AppSettings,
): Promise<{ source: SpecSource; rootText?: string }> {
  switch (config.sourceType) {
    case 'attachment':
      return { source: attachmentSource(ctx, config.attachment ?? '') };
    case 'git':
      return {
        source: await gitSource(ctx, {
          connectionId: config.gitConnectionId,
          repo: config.gitRepo,
          ref: config.gitRef,
          path: config.gitPath,
        }),
      };
    case 'url':
      return { source: urlSource(settings, config.url) };
    case 'inline':
      return inlineSource(config.inlineSpec);
    default:
      return fail('NOT_CONFIGURED', 'This macro has not been set up yet. Edit the macro to choose an API spec.');
  }
}

export async function loadSpec(
  ctx: SecureContext,
  config: MacroConfig,
  options: { refresh?: boolean } = {},
): Promise<LoadSpecResponse> {
  requireLicense(ctx);
  const settings = await getSettings();
  const { source, rootText } = await selectSource(ctx, config, settings);
  // Only signed-in licensed users may bypass the cache, to avoid hammering Git hosts.
  const refresh = options.refresh === true && isLicensedUser(ctx);
  const tryItOutAllowed = settings.tryItOutEnabled && config.tryItOut === true && isLicensedUser(ctx);

  if (source.cacheKey && !refresh) {
    const cached = await readCache(source.cacheKey, settings.cacheTtlMinutes);
    if (cached) {
      return {
        spec: cached.spec,
        summary: cached.summary,
        tryItOutAllowed,
        meta: {
          sourceLabel: source.label,
          sourceLink: source.link,
          fetchedAt: cached.fetchedAt,
          fromCache: true,
          fileCount: cached.fileCount,
          warnings: cached.warnings,
        },
      };
    }
  }

  const bundled = await loadAndBundle(source, { allowExternalUrls: settings.urlSourcesEnabled, rootText });
  const fetchedAt = new Date().toISOString();
  if (source.cacheKey) {
    await writeCache(source.cacheKey, settings.cacheTtlMinutes, { ...bundled, fetchedAt });
  }
  return {
    spec: bundled.spec,
    summary: bundled.summary,
    tryItOutAllowed,
    meta: {
      sourceLabel: source.label,
      sourceLink: source.link,
      fetchedAt,
      fromCache: false,
      fileCount: bundled.fileCount,
      warnings: bundled.warnings,
    },
  };
}
