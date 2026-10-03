import type { SpecKind } from './types';

// Code samples for one operation, built from the spec: an example request
// (URL with path and query parameters, headers, auth placeholder, body) and
// then that request written out for a few common languages. Values come from
// the spec's own examples where it has them, otherwise from the schema.

type Json = Record<string, unknown>;

export const SAMPLE_LANGUAGES = ['curl', 'javascript', 'python', 'go', 'java', 'csharp'] as const;
export type SampleLanguage = (typeof SAMPLE_LANGUAGES)[number];

export const SAMPLE_LANGUAGE_LABELS: Record<SampleLanguage, string> = {
  curl: 'cURL',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  java: 'Java',
  csharp: 'C#',
};

export interface SampleRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?:
    | { kind: 'json'; value: unknown }
    | { kind: 'form'; fields: Array<[string, string]> }
    | { kind: 'multipart'; fields: Array<[string, string]>; files: string[] }
    | { kind: 'text'; value: string; contentType: string }
    | { kind: 'binary'; contentType: string };
}

export interface CodeSample {
  /** One of SAMPLE_LANGUAGES, or a label from the spec's own x-codeSamples. */
  id: string;
  label: string;
  code: string;
  /** Written by the spec author (x-codeSamples) rather than generated. */
  fromSpec: boolean;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const MAX_DEPTH = 6;
const MAX_PROPERTIES = 30;
const MAX_SPEC_SAMPLES = 10;
const MAX_SPEC_SAMPLE_CHARS = 20_000;
const TOKEN = '<token>';

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function pointer(root: Json, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      segment = raw;
    }
    segment = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    node = isObject(node) && Object.prototype.hasOwnProperty.call(node, segment) ? node[segment] : Array.isArray(node) ? node[Number(segment)] : undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

function deref(root: Json, node: unknown): Json | undefined {
  let current = node;
  for (let hop = 0; hop < 20 && isObject(current) && typeof current.$ref === 'string'; hop++) current = pointer(root, current.$ref);
  return isObject(current) && typeof current.$ref !== 'string' ? current : undefined;
}

// --- example values ---

const FORMAT_EXAMPLES: Record<string, unknown> = {
  'date-time': '2024-01-01T12:00:00Z',
  date: '2024-01-01',
  time: '12:00:00',
  email: 'user@example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  uri: 'https://example.com',
  url: 'https://example.com',
  hostname: 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  byte: 'U3BlY1BhZ2U=',
  password: 'password',
};

/** An example value for a schema, preferring the spec's own example/default/enum. */
export function exampleFor(root: Json, raw: unknown, depth = 0, seen: Set<unknown> = new Set()): unknown {
  const schema = deref(root, raw);
  if (!schema || depth > MAX_DEPTH || seen.has(schema)) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  seen.add(schema);
  try {
    for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
      const parts = Array.isArray(schema[key]) ? (schema[key] as unknown[]) : [];
      if (!parts.length) continue;
      if (key !== 'allOf') return exampleFor(root, parts[0], depth + 1, seen);
      const merged: Json = {};
      for (const part of parts) {
        const value = exampleFor(root, part, depth + 1, seen);
        if (isObject(value)) Object.assign(merged, value);
        else if (value !== undefined && parts.length === 1) return value;
      }
      return merged;
    }
    const types = Array.isArray(schema.type) ? schema.type.filter((t) => t !== 'null') : [schema.type];
    const type = types[0] ?? (schema.properties ? 'object' : schema.items ? 'array' : undefined);
    switch (type) {
      case 'object': {
        const out: Json = {};
        const props = isObject(schema.properties) ? Object.entries(schema.properties).slice(0, MAX_PROPERTIES) : [];
        for (const [name, prop] of props) {
          const p = deref(root, prop);
          if (p?.readOnly === true) continue;
          const value = exampleFor(root, prop, depth + 1, seen);
          if (value !== undefined) out[name] = value;
        }
        return out;
      }
      case 'array': {
        const item = exampleFor(root, schema.items, depth + 1, seen);
        return item === undefined ? [] : [item];
      }
      case 'integer':
        return typeof schema.minimum === 'number' ? Math.ceil(schema.minimum) : 0;
      case 'number':
        return typeof schema.minimum === 'number' ? schema.minimum : 0;
      case 'boolean':
        return true;
      case 'string':
        return (typeof schema.format === 'string' && FORMAT_EXAMPLES[schema.format]) || 'string';
      default:
        return undefined;
    }
  } finally {
    seen.delete(schema);
  }
}

function mediaExample(root: Json, media: Json): unknown {
  if (media.example !== undefined) return media.example;
  if (isObject(media.examples)) {
    for (const ex of Object.values(media.examples)) {
      const resolved = deref(root, ex);
      if (resolved && resolved.value !== undefined) return resolved.value;
    }
  }
  return exampleFor(root, media.schema);
}

const scalar = (value: unknown) => (value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

// --- request ---

function serverUrl(root: Json, kind: SpecKind, item: Json, op: Json): string {
  if (kind === 'swagger-2.0') {
    const scheme = Array.isArray(root.schemes) && root.schemes.includes('https') ? 'https' : Array.isArray(root.schemes) && typeof root.schemes[0] === 'string' ? root.schemes[0] : 'https';
    const host = typeof root.host === 'string' && root.host ? root.host : 'api.example.com';
    const basePath = typeof root.basePath === 'string' ? root.basePath : '';
    return `${scheme}://${host}${basePath}`.replace(/\/+$/, '');
  }
  const servers = [op.servers, item.servers, root.servers].find((s) => Array.isArray(s) && s.length) as Json[] | undefined;
  const server = servers?.find(isObject);
  let url = typeof server?.url === 'string' ? server.url : '';
  const variables = isObject(server?.variables) ? server.variables : {};
  url = url.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const v = variables[name];
    return isObject(v) && v.default !== undefined ? String(v.default) : match;
  });
  // Relative servers ("/v1") can't be called as-is; give readers a placeholder host.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://api.example.com${url.startsWith('/') || !url ? '' : '/'}${url}`;
  return url.replace(/\/+$/, '');
}

function authHeaders(root: Json, kind: SpecKind, op: Json, headers: Array<[string, string]>, query: Array<[string, string]>) {
  const schemes = kind === 'swagger-2.0' ? root.securityDefinitions : isObject(root.components) ? root.components.securitySchemes : undefined;
  const requirements = (Array.isArray(op.security) ? op.security : Array.isArray(root.security) ? root.security : []).filter(isObject);
  const first = requirements.find((r) => Object.keys(r).length > 0);
  if (!first || !isObject(schemes)) return;
  for (const name of Object.keys(first)) {
    const scheme = deref(root, schemes[name]);
    if (!scheme) continue;
    const type = String(scheme.type ?? '');
    const httpScheme = String(scheme.scheme ?? '').toLowerCase();
    if (type === 'apiKey' && typeof scheme.name === 'string') {
      if (scheme.in === 'query') query.push([scheme.name, '<api-key>']);
      else if (scheme.in === 'header') headers.push([scheme.name, '<api-key>']);
      else if (scheme.in === 'cookie') headers.push(['Cookie', `${scheme.name}=<api-key>`]);
    } else if ((type === 'http' && httpScheme === 'basic') || type === 'basic') {
      headers.push(['Authorization', 'Basic <base64 user:password>']);
    } else if (type === 'http' || type === 'oauth2' || type === 'openIdConnect') {
      headers.push(['Authorization', `Bearer ${TOKEN}`]);
    }
  }
}

const encodeQuery = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%3C/g, '<').replace(/%3E/g, '>')}`).join('&');

export function buildSampleRequest(root: Json, kind: SpecKind, path: string, method: string): SampleRequest | undefined {
  const paths = isObject(root.paths) ? root.paths : {};
  const item = deref(root, paths[path]);
  const lower = method.toLowerCase();
  const op = item && HTTP_METHODS.includes(lower) ? deref(root, item[lower]) : undefined;
  if (!item || !op) return undefined;
  const swagger = kind === 'swagger-2.0';

  const headers: Array<[string, string]> = [];
  const query: Array<[string, string]> = [];
  const pathValues = new Map<string, string>();
  const formFields: Array<[string, string]> = [];
  const files: string[] = [];
  let swaggerBody: Json | undefined;

  // Operation parameters override path-level ones with the same name and location.
  const params = new Map<string, Json>();
  for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
    const p = deref(root, raw);
    if (p && typeof p.name === 'string' && typeof p.in === 'string') params.set(`${p.in}:${p.name}`, p);
  }
  for (const p of params.values()) {
    const name = p.name as string;
    if (swagger && p.in === 'body') {
      swaggerBody = p;
      continue;
    }
    const value = p.example !== undefined ? p.example : swagger ? exampleFor(root, p) : exampleFor(root, p.schema);
    if (swagger && p.in === 'formData') {
      if (p.type === 'file') files.push(name);
      else formFields.push([name, scalar(value)]);
      continue;
    }
    // Optional query and header parameters are left out to keep samples short.
    if (p.in === 'path') pathValues.set(name, scalar(value) || name);
    else if (p.in === 'query' && p.required === true) query.push([name, scalar(value)]);
    else if (p.in === 'header' && p.required === true) headers.push([name, scalar(value)]);
  }

  authHeaders(root, kind, op, headers, query);

  const resolvedPath = path.replace(/\{([^}]+)\}/g, (_m, name: string) => encodeURIComponent(pathValues.get(name) ?? name));
  const qs = encodeQuery(query);
  const url = `${serverUrl(root, kind, item, op)}${resolvedPath}${qs ? `?${qs}` : ''}`;

  let body: SampleRequest['body'];
  if (swagger) {
    const consumes = (Array.isArray(op.consumes) ? op.consumes : Array.isArray(root.consumes) ? root.consumes : []).filter((c): c is string => typeof c === 'string');
    if (swaggerBody) body = { kind: 'json', value: exampleFor(root, swaggerBody.schema) ?? {} };
    else if (files.length || consumes.includes('multipart/form-data')) body = formFields.length || files.length ? { kind: 'multipart', fields: formFields, files } : undefined;
    else if (formFields.length) body = { kind: 'form', fields: formFields };
  } else {
    const rb = deref(root, op.requestBody);
    const content = rb && isObject(rb.content) ? rb.content : {};
    const types = Object.keys(content);
    const pick = types.find((t) => /json/i.test(t)) ?? types[0];
    const media = pick ? deref(root, content[pick]) : undefined;
    if (pick && media) {
      const value = mediaExample(root, media);
      if (/json/i.test(pick)) body = { kind: 'json', value: value ?? {} };
      else if (pick === 'application/x-www-form-urlencoded') body = { kind: 'form', fields: isObject(value) ? Object.entries(value).map(([k, v]) => [k, scalar(v)]) : [] };
      else if (pick === 'multipart/form-data') {
        const schema = deref(root, media.schema);
        const props = schema && isObject(schema.properties) ? schema.properties : {};
        const fields: Array<[string, string]> = [];
        const fileFields: string[] = [];
        for (const [name, raw] of Object.entries(props)) {
          const prop = deref(root, raw);
          if (prop?.format === 'binary' || prop?.contentMediaType !== undefined || (prop?.type === 'array' && deref(root, prop.items)?.format === 'binary')) fileFields.push(name);
          else fields.push([name, scalar(isObject(value) ? value[name] : exampleFor(root, raw))]);
        }
        body = { kind: 'multipart', fields, files: fileFields };
      } else if (/^text\/|xml/i.test(pick)) body = { kind: 'text', value: typeof value === 'string' ? value : '', contentType: pick };
      else body = { kind: 'binary', contentType: pick };
    }
  }
  if (body?.kind === 'json') headers.push(['Content-Type', 'application/json']);
  if (body?.kind === 'form') headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  if (body?.kind === 'text' || body?.kind === 'binary') headers.push(['Content-Type', body.contentType]);

  return { method: method.toUpperCase(), url, headers, body };
}

// --- writers ---

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
// JSON string escapes are valid string literals in JavaScript, Python, Java,
// C# and Go.
const str = (s: string) => JSON.stringify(s);
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const indent = (text: string, pad: string) => text.split('\n').map((l, i) => (i ? pad + l : l)).join('\n');

function curl(r: SampleRequest): string {
  const lines = [`curl -X ${r.method} ${shellQuote(r.url)}`];
  for (const [k, v] of r.headers) lines.push(`  -H ${shellQuote(`${k}: ${v}`)}`);
  const b = r.body;
  if (b?.kind === 'json') lines.push(`  -d ${shellQuote(pretty(b.value))}`);
  else if (b?.kind === 'form') for (const [k, v] of b.fields) lines.push(`  --data-urlencode ${shellQuote(`${k}=${v}`)}`);
  else if (b?.kind === 'multipart') {
    for (const [k, v] of b.fields) lines.push(`  -F ${shellQuote(`${k}=${v}`)}`);
    for (const f of b.files) lines.push(`  -F ${shellQuote(`${f}=@path/to/file`)}`);
  } else if (b?.kind === 'text') lines.push(`  --data-binary ${shellQuote(b.value)}`);
  else if (b?.kind === 'binary') lines.push(`  --data-binary @path/to/file`);
  return lines.join(' \\\n');
}

function javascript(r: SampleRequest): string {
  const b = r.body;
  const out: string[] = [];
  if (b?.kind === 'multipart') {
    out.push('const form = new FormData();');
    for (const [k, v] of b.fields) out.push(`form.append(${str(k)}, ${str(v)});`);
    for (const f of b.files) out.push(`form.append(${str(f)}, fileInput.files[0]);`);
    out.push('');
  }
  const opts = [`  method: ${str(r.method)},`];
  if (r.headers.length) {
    opts.push('  headers: {');
    for (const [k, v] of r.headers) opts.push(`    ${str(k)}: ${str(v)},`);
    opts.push('  },');
  }
  if (b?.kind === 'json') opts.push(`  body: JSON.stringify(${indent(pretty(b.value), '  ')}),`);
  else if (b?.kind === 'form') opts.push(`  body: new URLSearchParams(${indent(pretty(Object.fromEntries(b.fields)), '  ')}),`);
  else if (b?.kind === 'multipart') opts.push('  body: form,');
  else if (b?.kind === 'text') opts.push(`  body: ${str(b.value)},`);
  else if (b?.kind === 'binary') opts.push('  body: file,');
  out.push(`const response = await fetch(${str(r.url)}, {`, ...opts, '});', 'const data = await response.json();');
  return out.join('\n');
}

function pythonLiteral(v: unknown, pad = ''): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None';
  if (typeof v === 'string') return str(v);
  const next = `${pad}    `;
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => next + pythonLiteral(x, next)).join(',\n')},\n${pad}]` : '[]';
  const entries = Object.entries(v as Json);
  return entries.length ? `{\n${entries.map(([k, x]) => `${next}${str(k)}: ${pythonLiteral(x, next)}`).join(',\n')},\n${pad}}` : '{}';
}

function python(r: SampleRequest): string {
  const b = r.body;
  // requests sets Content-Type itself for json=, data= and files=.
  const headers = r.headers.filter(([k]) => !(k === 'Content-Type' && (b?.kind === 'json' || b?.kind === 'form')));
  const args = [str(r.url)];
  if (headers.length) args.push(`headers=${pythonLiteral(Object.fromEntries(headers), '    ')}`);
  if (b?.kind === 'json') args.push(`json=${pythonLiteral(b.value, '    ')}`);
  else if (b?.kind === 'form') args.push(`data=${pythonLiteral(Object.fromEntries(b.fields), '    ')}`);
  else if (b?.kind === 'multipart') {
    if (b.fields.length) args.push(`data=${pythonLiteral(Object.fromEntries(b.fields), '    ')}`);
    if (b.files.length) args.push(`files={${b.files.map((f) => `${str(f)}: open("path/to/file", "rb")`).join(', ')}}`);
  } else if (b?.kind === 'text') args.push(`data=${str(b.value)}`);
  else if (b?.kind === 'binary') args.push('data=open("path/to/file", "rb")');
  return ['import requests', '', `response = requests.request(${str(r.method)}, ${args.join(',\n    ')})`, 'print(response.json())'].join('\n');
}

// Go raw strings can hold anything but a backtick.
const goString = (s: string) => (s.includes('`') ? str(s) : `\`${s}\``);

function go(r: SampleRequest): string {
  const b = r.body;
  const imports = ['"fmt"', '"io"', '"net/http"'];
  let bodyExpr = 'nil';
  const pre: string[] = [];
  if (b?.kind === 'json' || b?.kind === 'text' || b?.kind === 'form') {
    imports.push('"strings"');
    const text = b.kind === 'json' ? pretty(b.value) : b.kind === 'text' ? b.value : encodeQuery(b.fields);
    bodyExpr = `strings.NewReader(${goString(text)})`;
  } else if (b?.kind === 'multipart' || b?.kind === 'binary') {
    pre.push('\t// Build the request body with mime/multipart or os.Open for file uploads.', '\tvar body io.Reader');
    bodyExpr = 'body';
  }
  const lines = ['package main', '', 'import (', ...imports.sort().map((i) => `\t${i}`), ')', '', 'func main() {', ...pre];
  lines.push(`\treq, err := http.NewRequest(${str(r.method)}, ${str(r.url)}, ${bodyExpr})`, '\tif err != nil {', '\t\tpanic(err)', '\t}');
  for (const [k, v] of r.headers) lines.push(`\treq.Header.Set(${str(k)}, ${str(v)})`);
  lines.push('\tres, err := http.DefaultClient.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer res.Body.Close()', '\tdata, _ := io.ReadAll(res.Body)', '\tfmt.Println(string(data))', '}');
  return lines.join('\n');
}

function java(r: SampleRequest): string {
  const b = r.body;
  let publisher = 'HttpRequest.BodyPublishers.noBody()';
  const note: string[] = [];
  if (b?.kind === 'json' || b?.kind === 'text' || b?.kind === 'form') {
    const text = b.kind === 'json' ? pretty(b.value) : b.kind === 'text' ? b.value : encodeQuery(b.fields);
    publisher = `HttpRequest.BodyPublishers.ofString(${str(text)})`;
  } else if (b?.kind === 'binary') {
    publisher = 'HttpRequest.BodyPublishers.ofFile(Path.of("path/to/file"))';
  } else if (b?.kind === 'multipart') {
    note.push('// Multipart bodies need a helper library or a hand-built body.');
  }
  const lines = [
    'import java.net.URI;',
    'import java.net.http.HttpClient;',
    'import java.net.http.HttpRequest;',
    'import java.net.http.HttpResponse;',
    ...(b?.kind === 'binary' ? ['import java.nio.file.Path;'] : []),
    '',
    ...note,
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create(${str(r.url)}))`,
    ...r.headers.map(([k, v]) => `    .header(${str(k)}, ${str(v)})`),
    `    .method(${str(r.method)}, ${publisher})`,
    '    .build();',
    'HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());',
    'System.out.println(response.body());',
  ];
  return lines.join('\n');
}

function csharp(r: SampleRequest): string {
  const b = r.body;
  const lines = ['using var client = new HttpClient();', `var request = new HttpRequestMessage(new HttpMethod(${str(r.method)}), ${str(r.url)});`];
  const contentType = r.headers.find(([k]) => k === 'Content-Type')?.[1];
  // Content-Type belongs on the content in .NET, not the request.
  for (const [k, v] of r.headers) if (k !== 'Content-Type') lines.push(`request.Headers.TryAddWithoutValidation(${str(k)}, ${str(v)});`);
  if (b?.kind === 'json' || b?.kind === 'text') {
    const text = b.kind === 'json' ? pretty(b.value) : b.value;
    lines.push(`request.Content = new StringContent(${str(text)}, System.Text.Encoding.UTF8, ${str(contentType ?? 'application/json')});`);
  } else if (b?.kind === 'form') {
    lines.push('request.Content = new FormUrlEncodedContent(new Dictionary<string, string>', '{');
    for (const [k, v] of b.fields) lines.push(`    [${str(k)}] = ${str(v)},`);
    lines.push('});');
  } else if (b?.kind === 'multipart') {
    lines.push('var form = new MultipartFormDataContent();');
    for (const [k, v] of b.fields) lines.push(`form.Add(new StringContent(${str(v)}), ${str(k)});`);
    for (const f of b.files) lines.push(`form.Add(new StreamContent(File.OpenRead("path/to/file")), ${str(f)}, "file");`);
    lines.push('request.Content = form;');
  } else if (b?.kind === 'binary') {
    lines.push('request.Content = new StreamContent(File.OpenRead("path/to/file"));', `request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(${str(b.contentType)});`);
  }
  lines.push('var response = await client.SendAsync(request);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  return lines.join('\n');
}

const WRITERS: Record<SampleLanguage, (r: SampleRequest) => string> = { curl, javascript, python, go, java, csharp };

export const writeSample = (language: SampleLanguage, request: SampleRequest) => WRITERS[language](request);

/** x-codeSamples (Redocly) or x-code-samples: samples the spec author wrote. */
function specSamples(op: Json): CodeSample[] {
  const raw = Array.isArray(op['x-codeSamples']) ? op['x-codeSamples'] : Array.isArray(op['x-code-samples']) ? op['x-code-samples'] : [];
  return raw
    .filter(isObject)
    .filter((s) => typeof s.source === 'string' && (typeof s.lang === 'string' || typeof s.label === 'string'))
    .slice(0, MAX_SPEC_SAMPLES)
    .map((s, i) => ({
      id: `spec-${i}`,
      label: String(s.label ?? s.lang).slice(0, 40),
      code: (s.source as string).slice(0, MAX_SPEC_SAMPLE_CHARS),
      fromSpec: true,
    }));
}

/** Samples for one operation: the spec's own first, then generated ones. */
export function codeSamples(root: Json, kind: SpecKind, path: string, method: string): CodeSample[] {
  const paths = isObject(root.paths) ? root.paths : {};
  const item = deref(root, paths[path]);
  const op = item ? deref(root, item[method.toLowerCase()]) : undefined;
  if (!op) return [];
  const request = buildSampleRequest(root, kind, path, method);
  const generated = request ? SAMPLE_LANGUAGES.map((id) => ({ id, label: SAMPLE_LANGUAGE_LABELS[id], code: writeSample(id, request), fromSpec: false })) : [];
  return [...specSamples(op), ...generated];
}
