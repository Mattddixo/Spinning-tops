import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { OperationSummary, Result, SpecKind, SpecSummary } from './types';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// JSON or YAML. Alias count is capped (billion laughs).
export function parseSpecText(text: string): Result<JsonObject> {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return { ok: false, error: { code: 'INVALID_SPEC', message: 'The spec file is empty.' } };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value: unknown = JSON.parse(trimmed);
      return isObject(value)
        ? { ok: true, value }
        : { ok: false, error: { code: 'INVALID_SPEC', message: 'The spec must be a JSON object.' } };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'INVALID_SPEC',
          message: 'The spec is not valid JSON.',
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  try {
    const value: unknown = parseYaml(trimmed, { maxAliasCount: 100, prettyErrors: true });
    return isObject(value)
      ? { ok: true, value }
      : { ok: false, error: { code: 'INVALID_SPEC', message: 'The spec must be a YAML mapping (object).' } };
  } catch (err) {
    let detail = err instanceof Error ? err.message : String(err);
    if (err instanceof YAMLParseError && err.linePos?.[0]) {
      const { line, col } = err.linePos[0];
      detail = `Line ${line}, column ${col}: ${err.message.split('\n')[0]}`;
    }
    return { ok: false, error: { code: 'INVALID_SPEC', message: 'The spec is not valid YAML.', detail } };
  }
}

// Same version checks Swagger UI uses.
export function detectKind(spec: JsonObject): SpecKind | undefined {
  const openapi = spec.openapi;
  if (typeof openapi === 'string') {
    if (/^3\.0\.\d+$/.test(openapi)) return 'openapi-3.0';
    if (/^3\.1\.\d+$/.test(openapi)) return 'openapi-3.1';
    if (/^3\.2\.\d+$/.test(openapi)) return 'openapi-3.2';
    return undefined;
  }
  if (spec.swagger === '2.0') return 'swagger-2.0';
  return undefined;
}

export function validateSpecShape(spec: JsonObject): Result<SpecKind> {
  if (typeof spec.asyncapi === 'string') {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_SPEC',
        message: 'AsyncAPI documents are not supported. SpecPage renders OpenAPI 3.x and Swagger 2.0.',
      },
    };
  }
  const kind = detectKind(spec);
  if (!kind) {
    const found = typeof spec.openapi === 'string' ? `openapi: ${spec.openapi}` : undefined;
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_SPEC',
        message: 'This file is not an OpenAPI 3.0/3.1/3.2 or Swagger 2.0 document.',
        detail: found ?? 'Expected a top-level "openapi" or "swagger: \'2.0\'" field.',
      },
    };
  }
  if (!isObject(spec.info)) {
    return {
      ok: false,
      error: { code: 'INVALID_SPEC', message: 'The spec is missing its required "info" object.' },
    };
  }
  return { ok: true, value: kind };
}

function serverUrls(spec: JsonObject, kind: SpecKind): string[] {
  if (kind === 'swagger-2.0') {
    if (typeof spec.host !== 'string') return [];
    const schemes = Array.isArray(spec.schemes) && spec.schemes.length ? spec.schemes : ['https'];
    const basePath = typeof spec.basePath === 'string' ? spec.basePath : '';
    return schemes.filter((s): s is string => typeof s === 'string').map((s) => `${s}://${spec.host}${basePath}`);
  }
  if (!Array.isArray(spec.servers)) return [];
  return spec.servers
    .filter(isObject)
    .map((s) => s.url)
    .filter((u): u is string => typeof u === 'string');
}

export function listOperations(spec: JsonObject): OperationSummary[] {
  const paths = isObject(spec.paths) ? spec.paths : {};
  const ops: OperationSummary[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      ops.push({
        method: method.toUpperCase(),
        path,
        summary: typeof op.summary === 'string' ? op.summary : undefined,
        operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
        tags: Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string') : [],
        deprecated: op.deprecated === true,
      });
    }
  }
  return ops;
}

export function summarizeSpec(spec: JsonObject, kind: SpecKind): SpecSummary {
  const info = isObject(spec.info) ? spec.info : {};
  const operations = listOperations(spec);
  const declaredTags = Array.isArray(spec.tags)
    ? spec.tags.filter(isObject).map((t) => t.name).filter((n): n is string => typeof n === 'string')
    : [];
  const usedTags = operations.flatMap((o) => o.tags);
  const tags = [...new Set([...declaredTags, ...usedTags])];
  return {
    kind,
    title: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Untitled API',
    version: typeof info.version === 'string' ? info.version : String(info.version ?? ''),
    description: typeof info.description === 'string' ? info.description : undefined,
    servers: serverUrls(spec, kind),
    tags,
    operations,
  };
}

export interface FilterOptions {
  includeTags?: string[];
  includePaths?: string[];
  hideDeprecated?: boolean;
}

const normalisePrefix = (prefix: string) => prefix.trim().replace(/\/+$/, '');

function pathMatches(path: string, prefixes: string[]): boolean {
  return prefixes.some((raw) => {
    const prefix = normalisePrefix(raw);
    if (!prefix) return false;
    return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}{`);
  });
}

// Keep only operations matching the tag/path filters. Empty paths and unused
// tags are dropped; components are left alone so $refs still resolve.
export function filterSpec<T extends JsonObject>(spec: T, options: FilterOptions): T {
  const tags = (options.includeTags ?? []).filter(Boolean);
  const prefixes = (options.includePaths ?? []).filter((p) => p.trim());
  const hideDeprecated = options.hideDeprecated === true;
  if (!tags.length && !prefixes.length && !hideDeprecated) return spec;

  const paths = isObject(spec.paths) ? spec.paths : {};
  const filteredPaths: JsonObject = {};
  const usedTags = new Set<string>();

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    if (prefixes.length && !pathMatches(path, prefixes)) continue;

    const nextItem: JsonObject = {};
    let kept = 0;
    for (const [key, value] of Object.entries(item)) {
      const isOperation = (HTTP_METHODS as readonly string[]).includes(key);
      if (!isOperation) {
        nextItem[key] = value;
        continue;
      }
      if (!isObject(value)) continue;
      const opTags = Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === 'string') : [];
      if (hideDeprecated && value.deprecated === true) continue;
      if (tags.length && !opTags.some((t) => tags.includes(t))) continue;
      nextItem[key] = value;
      opTags.forEach((t) => usedTags.add(t));
      kept += 1;
    }
    if (kept > 0) filteredPaths[path] = nextItem;
  }

  const next: JsonObject = { ...spec, paths: filteredPaths };
  if (Array.isArray(spec.tags)) {
    next.tags = spec.tags.filter((t) => isObject(t) && typeof t.name === 'string' && usedTags.has(t.name));
  }
  return next as T;
}

// Text for the indexed searchText param (title + endpoints).
export function buildSearchText(summary: SpecSummary, maxLength = 3000): string {
  const parts = [summary.title, summary.version ? `v${summary.version}` : '', summary.tags.join(' ')];
  for (const op of summary.operations) {
    parts.push(`${op.method} ${op.path}${op.summary ? ` ${op.summary}` : ''}`);
  }
  let text = parts.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return text;
}
