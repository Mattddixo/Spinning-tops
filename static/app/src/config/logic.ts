import { isValidRef, isValidRepo, normaliseRepoPath, PROVIDERS, usesFilePath } from '../../../../src/shared/git';
import type { Translate } from '../../../../src/shared/i18n';
import type { ConnectionOption, MacroConfig } from '../../../../src/shared/types';
import { toLanguageTag } from '../format';

// Pure helpers for the macro settings dialog, kept out of the components so
// they can be unit tested.

/** Largest pasted spec, in characters (matches the backend's MAX_INLINE_CHARS). */
export const MAX_INLINE = 100_000;

export const isHttpsUrl = (value: string | undefined) => /^https:\/\/[^\s/?#]+\S*$/i.test(value?.trim() ?? '');


// Forge rejects null in macro config, so drop empty values.
export function cleanConfig(config: MacroConfig): MacroConfig {
  const out: Record<string, unknown> = {};
  const keep = (key: keyof MacroConfig, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = value;
  };
  keep('sourceType', config.sourceType);
  switch (config.sourceType) {
    case 'attachment':
      keep('attachment', config.attachment);
      break;
    case 'git':
      keep('gitConnectionId', config.gitConnectionId);
      keep('gitRepo', config.gitRepo?.trim());
      keep('gitRef', config.gitRef?.trim());
      keep('gitPath', config.gitPath?.trim());
      break;
    case 'url':
      keep('url', config.url?.trim());
      break;
    case 'inline':
      keep('inlineSpec', config.inlineSpec);
      break;
  }
  keep('title', config.title?.trim());
  keep('serverUrl', config.serverUrl?.trim());
  keep('includeTags', config.includeTags);
  keep('includePaths', config.includePaths);
  for (const key of ['hideDeprecated', 'showModels', 'showInfo', 'showServers', 'showFilter', 'showCodeSamples', 'tryItOut'] as const) {
    if (typeof config[key] === 'boolean') out[key] = config[key];
  }
  keep('docExpansion', config.docExpansion);
  if (typeof config.maxHeight === 'number' && config.maxHeight > 0) out.maxHeight = config.maxHeight;
  keep('searchText', config.searchText);
  return out as MacroConfig;
}

export function validateSource(t: Translate, config: MacroConfig, connections: ConnectionOption[], locale: string): string | undefined {
  switch (config.sourceType) {
    case undefined:
      return t('ui.config.validate.noSource');
    case 'attachment':
      return config.attachment ? undefined : t('ui.config.validate.noAttachment');
    case 'git': {
      const connection = connections.find((c) => c.id === config.gitConnectionId);
      if (!connection) return t('ui.config.validate.noConnection');
      if (!config.gitRepo || !isValidRepo(connection.provider, config.gitRepo.trim())) {
        return t('ui.config.validate.badRepo', { hint: PROVIDERS[connection.provider].repoHint });
      }
      if (config.gitRef && !isValidRef(config.gitRef.trim())) return t('ui.config.validate.badRef');
      if (usesFilePath(connection.provider) && (!config.gitPath || !normaliseRepoPath(config.gitPath))) return t('ui.config.validate.badPath');
      return undefined;
    }
    case 'url':
      return isHttpsUrl(config.url) ? undefined : t('ui.config.validate.badUrl');
    case 'inline':
      if (!config.inlineSpec?.trim()) return t('ui.config.validate.noInline');
      return config.inlineSpec.length > MAX_INLINE
        ? t('ui.config.validate.inlineTooLong', { max: MAX_INLINE.toLocaleString(toLanguageTag(locale)) })
        : undefined;
  }
}

export const sourceKey = (c: MacroConfig) =>
  JSON.stringify([c.sourceType, c.attachment, c.gitConnectionId, c.gitRepo, c.gitRef, c.gitPath, c.url, c.inlineSpec]);
