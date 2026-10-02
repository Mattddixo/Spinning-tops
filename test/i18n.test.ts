import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslate, format, lookup, type Catalog } from '../src/shared/i18n';

const root = join(__dirname, '..');
const readCatalog = (file: string) => JSON.parse(readFileSync(join(root, 'locales', file), 'utf8')) as Catalog;

function flatten(node: Catalog, prefix = '', out = new Map<string, string>()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const english = flatten(readCatalog('en-US.json'));
const manifest = readFileSync(join(root, 'manifest.yml'), 'utf8');
const locales = [...manifest.matchAll(/- key: ([a-z]{2}-[A-Z]{2})\n\s+path: (locales\/\S+\.json)/g)].map((m) => ({ key: m[1], path: m[2] }));

describe('translation catalogs', () => {
  it('registers every catalog in the manifest', () => {
    const files = readdirSync(join(root, 'locales')).filter((f) => f.endsWith('.json'));
    expect(locales.map((l) => l.path.replace('locales/', '')).sort()).toEqual(files.sort());
    expect(locales.map((l) => l.key)).toContain('en-US');
  });

  it('nests keys instead of putting dots in them', () => {
    // lookup() walks nested objects, so "a": { "b.c": ... } would never be found as a.b.c.
    const dotted = (node: Catalog, path: string): string[] =>
      Object.entries(node).flatMap(([k, v]) => [...(k.includes('.') ? [`${path}${k}`] : []), ...(typeof v === 'string' ? [] : dotted(v, `${path}${k}.`))]);
    for (const { path } of locales) expect(dotted(readCatalog(path.replace('locales/', '')), ''), path).toEqual([]);
  });

  for (const { key } of locales.filter((l) => l.key !== 'en-US')) {
    it(`${key} has the same keys and placeholders as English`, () => {
      const catalog = flatten(readCatalog(`${key}.json`));
      expect([...catalog.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [k, v] of english) {
        expect(placeholders(catalog.get(k) ?? ''), `${key} ${k}`).toEqual(placeholders(v));
        expect(catalog.get(k)?.trim(), `${key} ${k}`).toBeTruthy();
      }
    });
  }

  it('defines every key the code uses', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'static/app/src'));
    const used = new Set<string>();
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/["'`]((?:errors|hints|warnings|ui)\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
    }
    for (const m of manifest.matchAll(/i18n: (\S+)/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((k) => !english.has(k))).toEqual([]);
  });
});

describe('translate helpers', () => {
  it('reads flat and nested keys, flat first', () => {
    const catalog: Catalog = { 'a.b': 'flat', a: { b: 'nested', c: 'deep' } };
    expect(lookup(catalog, 'a.b')).toBe('flat');
    expect(lookup(catalog, 'a.c')).toBe('deep');
    expect(lookup(catalog, 'a.x')).toBeUndefined();
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(format('{n} of {total}', { n: 2, total: 5 })).toBe('2 of 5');
    expect(format('{n} of {total}', { n: 2 })).toBe('2 of {total}');
  });

  it('falls back through catalogs and finally to the key', () => {
    const t = createTranslate({ hello: 'Hallo' }, { hello: 'Hello', bye: 'Bye' });
    expect(t('hello')).toBe('Hallo');
    expect(t('bye')).toBe('Bye');
    expect(t('missing.key')).toBe('missing.key');
  });
});
