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

const english = flatten(readCatalog('en-US.json'));
describe('UI text catalog', () => {
  it('nests keys instead of putting dots in them', () => {
    // lookup() walks nested objects, so "a": { "b.c": ... } would never be found as a.b.c.
    const dotted = (node: Catalog, path: string): string[] =>
      Object.entries(node).flatMap(([k, v]) => [...(k.includes('.') ? [`${path}${k}`] : []), ...(typeof v === 'string' ? [] : dotted(v, `${path}${k}.`))]);
    expect(dotted(readCatalog('en-US.json'), '')).toEqual([]);
  });

  it('has no empty strings', () => {
    expect([...english].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it('defines every key the code uses, and nothing unused', () => {
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
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((k) => !english.has(k))).toEqual([]);
    // ui.audit.*, ui.provider.*, changes.* and quality.* are built from data (`ui.audit.${action}`).
    const dynamic = /^(ui\.(audit|provider)|changes|quality)\./;
    expect([...english.keys()].filter((k) => !used.has(k) && !dynamic.test(k))).toEqual([]);
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

describe('change list wording', () => {
  it('has text for every kind of change', async () => {
    const { CHANGE_CODES } = await import('../src/shared/types');
    expect(CHANGE_CODES.filter((code) => !english.has(`changes.${code}`))).toEqual([]);
    expect([...english.keys()].filter((k) => k.startsWith('changes.') && !(CHANGE_CODES as readonly string[]).includes(k.slice(8)))).toEqual([]);
  });
});

describe('quality report wording', () => {
  it('has a title and help text for every check', async () => {
    const { QUALITY_CHECK_IDS } = await import('../src/shared/types');
    expect(QUALITY_CHECK_IDS.filter((id) => !english.has(`quality.${id}.title`) || !english.has(`quality.${id}.help`))).toEqual([]);
    expect([...english.keys()].filter((k) => k.startsWith('quality.') && !(QUALITY_CHECK_IDS as readonly string[]).includes(k.split('.')[1]))).toEqual([]);
  });
});
