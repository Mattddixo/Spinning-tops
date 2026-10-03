import { describe, expect, it } from 'vitest';
import { buildSampleRequest, codeSamples, exampleFor, writeSample } from '../src/shared/samples';

type Json = Record<string, unknown>;

const SPEC: Json = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1' },
  servers: [{ url: 'https://{region}.api.example.com/v1', variables: { region: { default: 'eu' } } }],
  security: [{ bearer: [] }],
  paths: {
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' }, example: 'rex-1' }],
      get: {
        parameters: [
          { name: 'fields', in: 'query', required: true, schema: { type: 'string', enum: ['basic', 'full'] } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'X-Request-Id', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
      put: {
        security: [{ key: [] }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        responses: { '204': { description: 'ok' } },
      },
    },
    '/pets/{petId}/photo': {
      post: {
        requestBody: {
          content: {
            'multipart/form-data': { schema: { type: 'object', properties: { caption: { type: 'string', example: "it's me" }, photo: { type: 'string', format: 'binary' } } } },
          },
        },
        responses: { '200': { description: 'ok' } },
        'x-codeSamples': [{ lang: 'Shell', label: 'HTTPie', source: 'http POST :8080/pets/1/photo' }],
      },
    },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
    schemas: {
      Pet: {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true },
          name: { type: 'string', example: 'Rex "the dog"' },
          born: { type: 'string', format: 'date' },
          tags: { type: 'array', items: { type: 'string' } },
          owner: { $ref: '#/components/schemas/Owner' },
          vaccinated: { type: 'boolean' },
        },
      },
      Owner: { type: 'object', properties: { name: { type: 'string' }, pets: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } },
    },
  },
};

describe('buildSampleRequest', () => {
  it('fills in the URL, required parameters and auth', () => {
    const r = buildSampleRequest(SPEC, 'openapi-3.0', '/pets/{petId}', 'get')!;
    expect(r.url).toBe('https://eu.api.example.com/v1/pets/rex-1?fields=basic');
    expect(r.headers).toEqual([
      ['X-Request-Id', '3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      ['Authorization', 'Bearer <token>'],
    ]);
    expect(r.body).toBeUndefined();
  });

  it('builds a JSON body from the schema, skipping readOnly and stopping on cycles', () => {
    const r = buildSampleRequest(SPEC, 'openapi-3.0', '/pets/{petId}', 'put')!;
    expect(r.headers).toEqual([
      ['X-Api-Key', '<api-key>'],
      ['Content-Type', 'application/json'],
    ]);
    expect(r.body).toEqual({
      kind: 'json',
      value: { name: 'Rex "the dog"', born: '2024-01-01', tags: ['string'], owner: { name: 'string', pets: [] }, vaccinated: true },
    });
  });

  it('separates files from fields in multipart bodies', () => {
    const r = buildSampleRequest(SPEC, 'openapi-3.0', '/pets/{petId}/photo', 'post')!;
    expect(r.body).toEqual({ kind: 'multipart', fields: [['caption', "it's me"]], files: ['photo'] });
  });

  it('uses a placeholder host for relative servers and handles Swagger 2', () => {
    const relative = { ...SPEC, servers: [{ url: '/v2' }] };
    expect(buildSampleRequest(relative, 'openapi-3.0', '/pets/{petId}', 'get')!.url).toMatch(/^https:\/\/api\.example\.com\/v2\/pets\//);
    const swagger: Json = {
      swagger: '2.0',
      info: { title: 't', version: '1' },
      host: 'petstore.example.com',
      basePath: '/api',
      schemes: ['http', 'https'],
      paths: { '/items': { post: { parameters: [{ name: 'body', in: 'body', schema: { type: 'object', properties: { n: { type: 'integer', minimum: 3 } } } }], responses: {} } } },
    };
    const r = buildSampleRequest(swagger, 'swagger-2.0', '/items', 'post')!;
    expect(r.url).toBe('https://petstore.example.com/api/items');
    expect(r.body).toEqual({ kind: 'json', value: { n: 3 } });
  });

  it('writes array and object parameters the way servers expect them', () => {
    const spec: Json = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/pets/{ids}': {
          get: {
            parameters: [
              { name: 'ids', in: 'path', required: true, schema: { type: 'array', items: { type: 'integer' } }, example: [1, 2] },
              { name: 'status', in: 'query', required: true, schema: { type: 'array', items: { type: 'string', default: 'available' } } },
              { name: 'tags', in: 'query', required: true, explode: false, schema: { type: 'array', items: { type: 'string' } }, example: ['a', 'b'] },
              { name: 'filter', in: 'query', required: true, schema: { type: 'object', properties: { color: { type: 'string', example: 'red' } } } },
            ],
            responses: {},
          },
        },
      },
    };
    expect(buildSampleRequest(spec, 'openapi-3.0', '/pets/{ids}', 'get')!.url).toBe('https://api.example.com/pets/1%2C2?status=available&tags=a%2Cb&color=red');
    const swagger: Json = {
      swagger: '2.0',
      info: { title: 't', version: '1' },
      host: 'petstore.example.com',
      paths: {
        '/pet/findByStatus': {
          get: {
            parameters: [
              { name: 'status', in: 'query', required: true, type: 'array', items: { type: 'string', enum: ['available', 'sold'] } },
              { name: 'tag', in: 'query', required: true, type: 'array', collectionFormat: 'multi', items: { type: 'string', default: 'x' } },
            ],
            responses: {},
          },
        },
      },
    };
    expect(buildSampleRequest(swagger, 'swagger-2.0', '/pet/findByStatus', 'get')!.url).toBe('https://petstore.example.com/pet/findByStatus?status=available&tag=x');
  });

  it('returns nothing for unknown operations', () => {
    expect(buildSampleRequest(SPEC, 'openapi-3.0', '/nope', 'get')).toBeUndefined();
    expect(buildSampleRequest(SPEC, 'openapi-3.0', '/pets/{petId}', 'constructor')).toBeUndefined();
  });
});

describe('writers', () => {
  const put = buildSampleRequest(SPEC, 'openapi-3.0', '/pets/{petId}', 'put')!;
  const photo = buildSampleRequest(SPEC, 'openapi-3.0', '/pets/{petId}/photo', 'post')!;

  it('quotes shell arguments safely', () => {
    const code = writeSample('curl', photo);
    expect(code).toContain(`-F 'caption=it'\\''s me'`);
    expect(code).toContain(`-F 'photo=@path/to/file'`);
  });

  it('writes Python literals, not JSON', () => {
    const code = writeSample('python', put);
    expect(code).toContain('"vaccinated": True');
    expect(code).not.toContain('Content-Type');
    expect(code).toContain('json={');
  });

  it('puts Content-Type on the content in C#', () => {
    const code = writeSample('csharp', put);
    expect(code).not.toContain('TryAddWithoutValidation("Content-Type"');
    expect(code).toContain('"application/json");');
  });

  it('escapes quotes in every language', () => {
    for (const lang of ['javascript', 'python', 'go', 'java', 'csharp'] as const) {
      expect(writeSample(lang, put)).toMatch(/Rex \\+"the dog\\+"|`[^`]*Rex "the dog"/);
    }
  });
});

describe('codeSamples', () => {
  it('lists the spec author\'s samples first', () => {
    const samples = codeSamples(SPEC, 'openapi-3.0', '/pets/{petId}/photo', 'post');
    expect(samples.map((s) => s.label)).toEqual(['HTTPie', 'cURL', 'JavaScript', 'Python', 'Go', 'Java', 'C#']);
    expect(samples[0]).toMatchObject({ fromSpec: true, code: 'http POST :8080/pets/1/photo' });
  });
});

describe('exampleFor', () => {
  it('prefers examples, then defaults, then enums', () => {
    expect(exampleFor({}, { type: 'string', example: 'a', default: 'b' })).toBe('a');
    expect(exampleFor({}, { type: 'string', default: 'b', enum: ['c'] })).toBe('b');
    expect(exampleFor({}, { type: 'string', enum: ['c'] })).toBe('c');
    expect(exampleFor({}, { type: ['null', 'integer'] })).toBe(0);
    expect(exampleFor({}, { allOf: [{ properties: { a: { type: 'integer' } } }, { properties: { b: { type: 'boolean' } } }] })).toEqual({ a: 0, b: true });
  });
});

describe('OpenAPI 3.2 query samples', () => {
  it('writes samples for query operations', () => {
    const spec: Json = {
      openapi: '3.2.0',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: { '/search': { query: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { q: { type: 'string', example: 'pets' } } } } } }, responses: {} } } },
    };
    expect(writeSample('curl', buildSampleRequest(spec, 'openapi-3.2', '/search', 'query')!)).toContain("curl -X QUERY 'https://api.example.com/search'");
    expect(buildSampleRequest({ ...spec, openapi: '3.1.0' }, 'openapi-3.1', '/search', 'query')).toBeUndefined();
  });
});
