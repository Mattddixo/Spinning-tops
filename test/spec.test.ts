import { describe, expect, it } from 'vitest';
import { buildSearchText, detectKind, filterSpec, parseSpecText, summarizeSpec, validateSpecShape } from '../src/shared/spec';

const petstore = {
  openapi: '3.1.0',
  info: { title: 'Petstore', version: '1.2.0', description: 'Pets.\n\nMore text.' },
  servers: [{ url: 'https://api.example.com/v1' }],
  tags: [{ name: 'pets' }, { name: 'store' }, { name: 'unused' }],
  paths: {
    '/pets': {
      parameters: [{ name: 'trace', in: 'header' }],
      get: { tags: ['pets'], summary: 'List pets', operationId: 'listPets' },
      post: { tags: ['pets'], summary: 'Create pet', deprecated: true },
    },
    '/pets/{id}': { get: { tags: ['pets'], summary: 'Get pet' } },
    '/store/orders': { get: { tags: ['store'], summary: 'List orders' } },
    '/petsitters': { get: { tags: ['other'], summary: 'Not a pets path' } },
  },
  components: { schemas: { Pet: { type: 'object' } } },
};

describe('parseSpecText', () => {
  it('parses JSON and YAML, including a BOM', () => {
    expect(parseSpecText('﻿{"openapi":"3.0.3"}')).toEqual({ ok: true, value: { openapi: '3.0.3' } });
    expect(parseSpecText('openapi: 3.0.3\ninfo:\n  title: x\n')).toMatchObject({ ok: true, value: { openapi: '3.0.3' } });
  });

  it('reports YAML errors with line and column', () => {
    const result = parseSpecText('openapi: 3.0.3\ninfo:\n  title: [unclosed\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SPEC');
      expect(result.error.detail).toMatch(/^Line \d+, column \d+/);
    }
  });

  it('rejects empty input, arrays and scalars', () => {
    expect(parseSpecText('   ').ok).toBe(false);
    expect(parseSpecText('[1,2]').ok).toBe(false);
    expect(parseSpecText('just a string').ok).toBe(false);
  });

  it('caps YAML alias expansion (billion laughs)', () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x"]'];
    for (let i = 0; i < 120; i++) lines.push(`k${i}: [*a,*a,*a,*a,*a,*a,*a,*a,*a]`);
    expect(parseSpecText(lines.join('\n')).ok).toBe(false);
  });
});

describe('detectKind / validateSpecShape', () => {
  it('detects supported versions', () => {
    expect(detectKind({ openapi: '3.0.3' })).toBe('openapi-3.0');
    expect(detectKind({ openapi: '3.1.1' })).toBe('openapi-3.1');
    expect(detectKind({ openapi: '3.2.0' })).toBe('openapi-3.2');
    expect(detectKind({ swagger: '2.0' })).toBe('swagger-2.0');
    expect(detectKind({ openapi: '4.0.0' })).toBeUndefined();
  });

  it('explains unsupported documents', () => {
    const asyncapi = validateSpecShape({ asyncapi: '3.0.0' });
    expect(asyncapi.ok).toBe(false);
    if (!asyncapi.ok) expect(asyncapi.error.code).toBe('UNSUPPORTED_SPEC');
    const noInfo = validateSpecShape({ openapi: '3.0.0' });
    expect(noInfo.ok).toBe(false);
  });
});

describe('summarizeSpec', () => {
  it('lists operations, tags and servers', () => {
    const summary = summarizeSpec(petstore, 'openapi-3.1');
    expect(summary.title).toBe('Petstore');
    expect(summary.version).toBe('1.2.0');
    expect(summary.servers).toEqual(['https://api.example.com/v1']);
    expect(summary.operations).toHaveLength(5);
    expect(summary.tags).toEqual(['pets', 'store', 'unused', 'other']);
    expect(summary.operations[1]).toMatchObject({ method: 'POST', path: '/pets', deprecated: true });
  });

  it('builds Swagger 2.0 server URLs', () => {
    const summary = summarizeSpec({ swagger: '2.0', info: { title: 'T', version: '1' }, host: 'api.x.com', basePath: '/v2', schemes: ['https'] }, 'swagger-2.0');
    expect(summary.servers).toEqual(['https://api.x.com/v2']);
  });
});

describe('filterSpec', () => {
  it('returns the same object when no filters are set', () => {
    expect(filterSpec(petstore, {})).toBe(petstore);
  });

  it('filters by tag and prunes unused tags', () => {
    const filtered = filterSpec(petstore, { includeTags: ['store'] });
    expect(Object.keys(filtered.paths as object)).toEqual(['/store/orders']);
    expect(filtered.tags).toEqual([{ name: 'store' }]);
    expect(filtered.components).toBe(petstore.components);
  });

  it('filters by path prefix without matching sibling paths', () => {
    const filtered = filterSpec(petstore, { includePaths: ['/pets/'] });
    expect(Object.keys(filtered.paths as object)).toEqual(['/pets', '/pets/{id}']);
  });

  it('hides deprecated operations but keeps path-level parameters', () => {
    const filtered = filterSpec(petstore, { hideDeprecated: true });
    const pets = (filtered.paths as Record<string, Record<string, unknown>>)['/pets'];
    expect(pets.post).toBeUndefined();
    expect(pets.get).toBeDefined();
    expect(pets.parameters).toBeDefined();
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(petstore);
    filterSpec(petstore, { includeTags: ['pets'], hideDeprecated: true });
    expect(JSON.stringify(petstore)).toBe(before);
  });
});

describe('buildSearchText', () => {
  it('includes title, endpoints and summaries, within the limit', () => {
    const text = buildSearchText(summarizeSpec(petstore, 'openapi-3.1'));
    expect(text).toContain('Petstore');
    expect(text).toContain('GET /pets/{id} Get pet');
    expect(buildSearchText(summarizeSpec(petstore, 'openapi-3.1'), 40).length).toBeLessThanOrEqual(40);
  });
});
