import type { Translate } from '../../../src/shared/i18n';
import type { SpecKind } from '../../../src/shared/types';

export const KIND_LABELS: Record<SpecKind, string> = {
  'openapi-3.0': 'OpenAPI 3.0',
  'openapi-3.1': 'OpenAPI 3.1',
  'openapi-3.2': 'OpenAPI 3.2',
  'swagger-2.0': 'Swagger 2.0',
  'asyncapi-2': 'AsyncAPI 2',
  'asyncapi-3': 'AsyncAPI 3',
};

/**
 * AsyncAPI specs arrive as the parser's stringified document, which carries
 * `x-parser-*` bookkeeping. Strip it so downloads look like the source.
 */
export function withoutParserExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutParserExtensions);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (!k.startsWith('x-parser-')) out[k] = withoutParserExtensions(v);
  return out;
}

export function relativeTime(t: Translate, iso: string, locale?: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return t('ui.time.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('ui.time.minutesAgo', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('ui.time.hoursAgo', { n: hours });
  return formatDate(iso, locale);
}

/** Forge locales use underscores (en_US) in some places; Intl wants a BCP 47 tag. */
export const toLanguageTag = (locale?: string) => (locale ? locale.replace('_', '-') : undefined);

export function formatDate(iso: string, locale?: string, withTime = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return withTime
      ? date.toLocaleString(toLanguageTag(locale), { dateStyle: 'medium', timeStyle: 'short' })
      : date.toLocaleDateString(toLanguageTag(locale));
  } catch {
    return withTime ? date.toLocaleString() : date.toLocaleDateString();
  }
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'openapi'
  );
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
