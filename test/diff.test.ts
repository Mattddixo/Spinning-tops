import { describe, expect, it } from 'vitest';
import { diffSpecs } from '../src/shared/diff';
import type { SpecChange } from '../src/shared/types';

type Json = Record<string, unknown>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const BASE: Json = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1.0.0' },
  security: [{ apiKey: [] }],
  paths: {
    '/pets': {
      get: {
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }],
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } },
        },
      },
      post: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } } },
        responses: { '201': { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
      },
    },
    '/pets/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          '404': { description: 'missing' },
        },
      },
      delete: { responses: { '204': { description: 'gone' } } },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', readOnly: true },
          name: { type: 'string' },
          status: { type: 'string', enum: ['available', 'sold'] },
          tag: { type: 'string' },
        },
      },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', maxLength: 50 }, tag: { type: 'string' } },
      },
    },
  },
};

const diff = (head: Json, base: Json = BASE) => diffSpecs(base, 'openapi-3.0', head, 'openapi-3.0');
const find = (changes: SpecChange[], code: string) => changes.filter((c) => c.code === code);
const at = (o: Json, path: string[]) => path.reduce<Json>((n, k) => n[k] as Json, o);

describe('diffSpecs', () => {
  it('finds nothing when the specs match', () => {
    expect(diff(clone(BASE))).toEqual({ changes: [], counts: { breaking: 0, warning: 0, info: 0 }, truncated: false });
  });

  it('reports removed and added operations', () => {
    const head = clone(BASE);
    delete at(head, ['paths', '/pets/{id}']).delete;
    at(head, ['paths', '/pets/{id}']).put = { responses: { '200': { description: 'ok' } } };
    const { changes } = diff(head);
    expect(changes).toContainEqual({ level: 'breaking', code: 'operationRemoved', operation: 'DELETE /pets/{id}' });
    expect(changes).toContainEqual({ level: 'info', code: 'operationAdded', operation: 'PUT /pets/{id}' });
    // breaking first
    expect(changes[0].level).toBe('breaking');
  });

  it('treats a renamed path parameter as the same operation', () => {
    const head = clone(BASE);
    const paths = at(head, ['paths']);
    const item = paths['/pets/{id}'] as Json;
    (item.parameters as Json[])[0].name = 'petId';
    delete paths['/pets/{id}'];
    paths['/pets/{petId}'] = item;
    expect(diff(head).changes).toEqual([]);
  });

  it('classifies parameter changes', () => {
    const head = clone(BASE);
    const get = at(head, ['paths', '/pets', 'get']);
    get.parameters = [
      { name: 'limit', in: 'query', required: true, schema: { type: 'integer', maximum: 50 } },
      { name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'sort', in: 'query', schema: { type: 'string' } },
    ];
    const { changes } = diff(head);
    expect(changes).toContainEqual({ level: 'breaking', code: 'parameterBecameRequired', operation: 'GET /pets', location: 'limit (query)' });
    expect(changes).toContainEqual({ level: 'breaking', code: 'requiredParameterAdded', operation: 'GET /pets', location: 'X-Tenant (header)' });
    expect(changes).toContainEqual({ level: 'info', code: 'parameterAdded', operation: 'GET /pets', location: 'sort (query)' });
    expect(changes).toContainEqual({
      level: 'breaking',
      code: 'limitTightened',
      operation: 'GET /pets',
      location: 'limit (query)',
      params: { keyword: 'maximum', from: 100, to: 50 },
    });
  });

  it('applies request and response rules in opposite directions', () => {
    const head = clone(BASE);
    const schemas = at(head, ['components', 'schemas']);
    // Pet is only returned; NewPet is only sent.
    (schemas.Pet as Json).properties = { ...((schemas.Pet as Json).properties as Json), status: { type: 'string', enum: ['available', 'sold', 'pending'] } };
    delete ((schemas.Pet as Json).properties as Json).tag;
    (schemas.NewPet as Json).required = ['name', 'tag'];
    ((schemas.NewPet as Json).properties as Json).age = { type: 'integer' };
    const { changes } = diff(head);
    expect(changes).toContainEqual({ level: 'warning', code: 'enumValueAdded', operation: 'GET /pets', section: 'response', status: '200', location: '[].status', params: { value: '"pending"' } });
    expect(changes).toContainEqual({ level: 'warning', code: 'propertyRemoved', operation: 'GET /pets/{id}', section: 'response', status: '200', location: 'tag' });
    expect(changes).toContainEqual({ level: 'breaking', code: 'propertyBecameRequired', operation: 'POST /pets', section: 'requestBody', location: 'tag' });
    expect(changes).toContainEqual({ level: 'info', code: 'propertyAdded', operation: 'POST /pets', section: 'requestBody', location: 'age' });
  });

  it('flags type changes by direction', () => {
    const head = clone(BASE);
    const props = at(head, ['components', 'schemas', 'NewPet', 'properties']);
    props.name = { type: ['string', 'null'], maxLength: 50 };
    const petProps = at(head, ['components', 'schemas', 'Pet', 'properties']);
    petProps.name = { type: ['string', 'null'] };
    const { changes } = diff(head);
    // Wider request type: fine. Wider response type: clients may get null.
    expect(changes).toContainEqual({ level: 'info', code: 'typeChanged', operation: 'POST /pets', section: 'requestBody', location: 'name', params: { from: 'string', to: 'null | string' } });
    expect(changes).toContainEqual({ level: 'breaking', code: 'typeChanged', operation: 'GET /pets/{id}', section: 'response', status: '200', location: 'name', params: { from: 'string', to: 'null | string' } });
  });

  it('accepts integer where number was', () => {
    const base = clone(BASE);
    at(base, ['components', 'schemas', 'NewPet', 'properties']).age = { type: 'integer' };
    const head = clone(base);
    at(head, ['components', 'schemas', 'NewPet', 'properties']).age = { type: 'number' };
    expect(find(diff(head, base).changes, 'typeChanged')[0].level).toBe('info');
  });

  it('ignores readOnly properties in requests', () => {
    const base = clone(BASE);
    at(base, ['paths', '/pets', 'post']).requestBody = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } };
    const head = clone(base);
    const pet = at(head, ['components', 'schemas', 'Pet']);
    pet.properties = { ...(pet.properties as Json), createdAt: { type: 'string', readOnly: true } };
    pet.required = ['id', 'name', 'createdAt'];
    const post = diff(head, base).changes.filter((c) => c.operation === 'POST /pets' && c.location === 'createdAt');
    expect(post.map((c) => c.level)).not.toContain('breaking');
  });

  it('reports response, body and media type changes', () => {
    const head = clone(BASE);
    const byId = at(head, ['paths', '/pets/{id}', 'get']);
    byId.responses = { '200': { description: 'ok', content: { 'application/xml': { schema: { $ref: '#/components/schemas/Pet' } } } } };
    at(head, ['paths', '/pets', 'post']).requestBody = { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } } };
    const { changes } = diff(head);
    expect(changes).toContainEqual({ level: 'warning', code: 'responseRemoved', operation: 'GET /pets/{id}', section: 'response', status: '404' });
    expect(changes).toContainEqual({ level: 'breaking', code: 'responseMediaTypeRemoved', operation: 'GET /pets/{id}', section: 'response', status: '200', params: { mediaType: 'application/json' } });
    expect(changes).toContainEqual({ level: 'breaking', code: 'requestBodyBecameRequired', operation: 'POST /pets' });
  });

  it('reports new auth requirements and deprecations', () => {
    const base = clone(BASE);
    at(base, ['paths', '/pets', 'get']).security = [];
    const head = clone(BASE);
    at(head, ['paths', '/pets', 'get']).deprecated = true;
    at(head, ['paths', '/pets', 'post']).security = [{ oauth: ['write'] }];
    const { changes } = diff(head, base);
    expect(changes).toContainEqual({ level: 'breaking', code: 'securityAdded', operation: 'GET /pets' });
    expect(changes).toContainEqual({ level: 'warning', code: 'securityChanged', operation: 'POST /pets' });
    expect(changes).toContainEqual({ level: 'warning', code: 'operationDeprecated', operation: 'GET /pets' });
  });

  it('merges allOf before comparing', () => {
    const base = clone(BASE);
    const head = clone(BASE);
    at(head, ['components', 'schemas']).NewPet = {
      allOf: [{ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 50 } } }, { properties: { tag: { type: 'string' } } }],
    };
    expect(diff(head, base).changes).toEqual([]);
  });

  it('stops on recursive schemas and reports each place a shared schema is used', () => {
    const base = clone(BASE);
    const node = { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } };
    at(base, ['components', 'schemas']).Node = node;
    at(base, ['components', 'schemas']).Pair = { type: 'object', properties: { left: { $ref: '#/components/schemas/Node' }, right: { $ref: '#/components/schemas/Node' } } };
    at(base, ['paths', '/pets', 'get']).responses = { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pair' } } } } };
    const head = clone(base);
    delete at(head, ['components', 'schemas', 'Node', 'properties']).name;
    const removed = find(diff(head, base).changes, 'propertyRemoved').map((c) => c.location);
    expect(removed).toEqual(expect.arrayContaining(['left.name', 'right.name']));
  });

  it('understands Swagger 2 body, formData and responses', () => {
    const base: Json = {
      swagger: '2.0',
      info: { title: 't', version: '1' },
      consumes: ['application/json'],
      paths: {
        '/upload': {
          post: {
            consumes: ['multipart/form-data'],
            parameters: [{ name: 'file', in: 'formData', type: 'file' }],
            responses: { '200': { description: 'ok', schema: { type: 'object', properties: { id: { type: 'string' } } } } },
          },
        },
        '/items': { post: { parameters: [{ name: 'body', in: 'body', schema: { type: 'object' } }], responses: { '204': { description: 'ok' } } } },
      },
    };
    const head = clone(base);
    (at(head, ['paths', '/upload', 'post']).parameters as Json[]).push({ name: 'note', in: 'formData', type: 'string', required: true });
    (at(head, ['paths', '/items', 'post']).parameters as Json[])[0].required = true;
    delete at(head, ['paths', '/upload', 'post', 'responses', '200', 'schema', 'properties']).id;
    const { changes } = diffSpecs(base, 'swagger-2.0', head, 'swagger-2.0');
    expect(changes).toContainEqual({ level: 'breaking', code: 'requiredPropertyAdded', operation: 'POST /upload', section: 'requestBody', location: 'note' });
    expect(changes).toContainEqual({ level: 'breaking', code: 'requestBodyBecameRequired', operation: 'POST /items' });
    expect(changes).toContainEqual({ level: 'warning', code: 'propertyRemoved', operation: 'POST /upload', section: 'response', status: '200', location: 'id' });
    expect(find(changes, 'requestBodyBecameRequired').map((c) => c.operation)).toEqual(['POST /items']);
  });

  it('caps very long change lists', () => {
    const base: Json = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: {} };
    const paths = base.paths as Json;
    for (let i = 0; i < 600; i++) paths[`/p${i}`] = { get: { responses: { '200': { description: 'ok' } } } };
    const result = diff({ openapi: '3.0.0', info: { title: 't', version: '2' }, paths: {} }, base);
    expect(result.changes).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });
});
