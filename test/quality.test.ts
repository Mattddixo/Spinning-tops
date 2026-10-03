import { describe, expect, it } from 'vitest';
import { assessQuality } from '../src/shared/quality';
import type { QualityCheckId } from '../src/shared/types';

type Json = Record<string, unknown>;

const GOOD: Json = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1', description: 'Pet store.', contact: { email: 'api@example.com' } },
  servers: [{ url: 'https://api.example.com' }],
  tags: [{ name: 'pets', description: 'Pets and their owners' }],
  paths: {
    '/pets/{id}': {
      parameters: [{ $ref: '#/components/parameters/Id' }],
      get: {
        tags: ['pets'],
        summary: 'Get a pet',
        description: 'Returns one pet.',
        operationId: 'getPet',
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          '404': { description: 'missing' },
        },
      },
      put: {
        tags: ['pets'],
        summary: 'Replace a pet',
        description: 'Replaces a pet.',
        operationId: 'putPet',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' }, example: { name: 'Rex' } } } },
        responses: { '204': { description: 'done' }, default: { description: 'error' } },
      },
    },
  },
  components: {
    parameters: { Id: { name: 'id', in: 'path', required: true, description: 'Pet ID', schema: { type: 'string' } } },
    schemas: { Pet: { type: 'object', description: 'A pet', properties: { name: { type: 'string', example: 'Rex' } } } },
    securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
  },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const check = (report: ReturnType<typeof assessQuality>, id: QualityCheckId) => report.checks.find((c) => c.id === id)!;

describe('assessQuality', () => {
  it('scores a well-documented spec at 100', () => {
    const report = assessQuality(GOOD, 'openapi-3.0');
    expect(report.score).toBe(100);
    expect(report.checks.filter((c) => c.failed)).toEqual([]);
    expect(report.duplicateOperationIds).toEqual([]);
  });

  it('lists what is missing, with examples', () => {
    const spec = clone(GOOD);
    const item = (spec.paths as Json)['/pets/{id}'] as Json;
    delete (item.get as Json).summary;
    delete (item.get as Json).responses;
    (item.get as Json).responses = { '200': { description: 'ok' } };
    (item.put as Json).operationId = 'getPet';
    delete ((spec.components as Json).parameters as Json as { Id: Json }).Id.description;
    const report = assessQuality(spec, 'openapi-3.0');
    expect(check(report, 'operationSummary')).toMatchObject({ passed: 1, total: 2, failed: 1, examples: ['GET /pets/{id}'], important: true });
    expect(check(report, 'errorResponse').examples).toEqual(['GET /pets/{id}']);
    expect(check(report, 'parameterDescription').examples).toEqual(['GET /pets/{id}: id (path)', 'PUT /pets/{id}: id (path)']);
    expect(report.duplicateOperationIds).toEqual(['getPet']);
    expect(report.score).toBeLessThan(100);
    expect(report.score).toBeGreaterThan(50);
  });

  it('counts a parameter the operation overrides once', () => {
    const spec = clone(GOOD);
    const item = (spec.paths as Json)['/pets/{id}'] as Json;
    item.parameters = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
    (item.get as Json).parameters = [{ name: 'id', in: 'path', required: true, description: 'Pet ID', schema: { type: 'string' } }];
    const params = check(assessQuality(spec, 'openapi-3.0'), 'parameterDescription');
    expect(params).toMatchObject({ total: 2, failed: 1, examples: ['PUT /pets/{id}: id (path)'] });
  });

  it('weighs important checks double', () => {
    const noDescription = clone(GOOD);
    delete (noDescription.info as Json).description;
    const noContact = clone(GOOD);
    delete (noContact.info as Json).contact;
    expect(assessQuality(noDescription, 'openapi-3.0').score).toBeLessThan(assessQuality(noContact, 'openapi-3.0').score);
  });

  it('caps examples and counts the rest', () => {
    const spec: Json = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: {} };
    for (let i = 0; i < 20; i++) (spec.paths as Json)[`/p${i}`] = { get: { responses: { '200': { description: 'ok' } } } };
    const summary = check(assessQuality(spec, 'openapi-3.0'), 'operationSummary');
    expect(summary.examples).toHaveLength(8);
    expect(summary.more).toBe(12);
  });

  it('understands Swagger 2', () => {
    const spec: Json = {
      swagger: '2.0',
      info: { title: 't', version: '1' },
      host: 'api.example.com',
      securityDefinitions: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
      paths: {
        '/items': {
          post: {
            parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Item' } }],
            responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/Item' }, examples: { 'application/json': { id: 1 } } } },
          },
        },
      },
      definitions: { Item: { type: 'object', properties: { id: { type: 'integer' } } } },
    };
    const report = assessQuality(spec, 'swagger-2.0');
    expect(check(report, 'servers').failed).toBe(0);
    expect(check(report, 'securityDefined').failed).toBe(0);
    expect(check(report, 'requestExample')).toMatchObject({ total: 1, failed: 1 });
    expect(check(report, 'responseExample')).toMatchObject({ total: 1, failed: 0 });
    expect(check(report, 'schemaDescription').examples).toEqual(['Item']);
    // the body parameter isn't a "parameter" for description purposes
    expect(check(report, 'parameterDescription').total).toBe(0);
  });

  it('skips checks with nothing to check when scoring', () => {
    const report = assessQuality({ openapi: '3.0.0', info: { title: 't', version: '1', description: 'd', contact: { name: 'n' } }, servers: [{ url: '/' }], components: { securitySchemes: { a: {} } }, paths: {} }, 'openapi-3.0');
    expect(report.score).toBe(100);
  });
});
