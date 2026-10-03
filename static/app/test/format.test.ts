import { describe, expect, it } from 'vitest';
import { formatDate, relativeTime, slugify, toLanguageTag, withoutParserExtensions } from '../src/format';
import { t } from './helpers/i18n';

describe('relativeTime', () => {
  const now = Date.parse('2026-05-01T12:00:00Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it('uses words for recent times and a date after a day', () => {
    expect(relativeTime(t, ago(10), 'en-US', now)).toBe('just now');
    expect(relativeTime(t, ago(5 * 60), 'en-US', now)).toBe('5 min ago');
    expect(relativeTime(t, ago(3 * 3600), 'en-US', now)).toBe('3 h ago');
    expect(relativeTime(t, ago(3 * 86400), 'en-US', now)).toBe(formatDate(ago(3 * 86400), 'en-US'));
    expect(relativeTime(t, 'not a date', 'en-US', now)).toBe('');
  });
});

describe('formatDate', () => {
  const iso = '2026-05-01T12:00:00Z';

  it('accepts Forge-style locales', () => {
    expect(toLanguageTag('en_GB')).toBe('en-GB');
    expect(toLanguageTag(undefined)).toBeUndefined();
    expect(formatDate(iso, 'en_GB')).toBe(new Date(iso).toLocaleDateString('en-GB'));
  });

  it('falls back to the default locale for a bad tag, and to nothing for a bad date', () => {
    expect(formatDate(iso, 'not a locale!')).toBe(new Date(iso).toLocaleDateString());
    expect(formatDate('nope')).toBe('');
  });
});

describe('slugify', () => {
  it('makes file-name-safe slugs', () => {
    expect(slugify('  Pet Store API (v2) ')).toBe('pet-store-api-v2');
    expect(slugify('***')).toBe('openapi');
    expect(slugify('a'.repeat(100))).toHaveLength(60);
  });
});

describe('withoutParserExtensions', () => {
  it('strips x-parser-* keys at every depth', () => {
    expect(withoutParserExtensions({ a: 1, 'x-parser-spec-parsed': true, b: [{ 'x-parser-schema-id': 's', c: null }] })).toEqual({ a: 1, b: [{ c: null }] });
  });
});
