import { parse as parseYaml, YAMLParseError } from 'yaml';
import { appError } from './messages';
import { deref, operationMethods } from './refs';
import type { OperationSummary, Result, SpecKind, SpecSummary } from './types';


type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// JSON or YAML. Alias count is capped (billion laughs).
export function parseSpecText(text: string): Result<JsonObject> {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return { ok: false, error: appError('INVALID_SPEC', 'errors.specEmpty') };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value: unknown = JSON.parse(trimmed);
      return isObject(value)
        ? { ok: true, value }
        : { ok: false, error: appError('INVALID_SPEC', 'errors.specNotJsonObject') };
    } catch (err) {
      return {
        ok: false,
        error: appError('INVALID_SPEC', 'errors.specInvalidJson', undefined, { detail: err instanceof Error ? err.message : String(err) }),
      };
    }
  }

  try {
    const value: unknown = parseYaml(trimmed, { maxAliasCount: 100, prettyErrors: true });
    return isObject(value)
      ? { ok: true, value }
      : { ok: false, error: appError('INVALID_SPEC', 'errors.specNotYamlMap') };
  } catch (err) {
    let detail = err instanceof Error ? err.message : String(err);
    if (err instanceof YAMLParseError && err.linePos?.[0]) {
      const { line, col } = err.linePos[0];
      detail = `Line ${line}, column ${col}: ${err.message.split('\n')[0]}`;
    }
    return { ok: false, error: appError('INVALID_SPEC', 'errors.specInvalidYaml', undefined, { detail }) };
  }
}

export const isAsyncApi = (kind: SpecKind) => kind === 'asyncapi-2' || kind === 'asyncapi-3';

// Same version checks Swagger UI uses. AsyncAPI 2.x and 3.x are what the
// AsyncAPI parser and React renderer support.
export function detectKind(spec: JsonObject): SpecKind | undefined {
  if (typeof spec.asyncapi === 'string') {
    if (/^2\.\d+\.\d+$/.test(spec.asyncapi)) return 'asyncapi-2';
    if (/^3\.\d+\.\d+$/.test(spec.asyncapi)) return 'asyncapi-3';
    return undefined;
  }
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
  const kind = detectKind(spec);
  if (!kind) {
    const found =
      typeof spec.openapi === 'string' ? `openapi: ${spec.openapi}` : typeof spec.asyncapi === 'string' ? `asyncapi: ${spec.asyncapi}` : undefined;
    return {
      ok: false,
      error: appError('UNSUPPORTED_SPEC', 'errors.specUnsupported', undefined, {
        detail: found ?? 'Expected a top-level "openapi", "asyncapi" or "swagger: \'2.0\'" field.',
      }),
    };
  }
  if (!isObject(spec.info)) {
    return { ok: false, error: appError('INVALID_SPEC', 'errors.specMissingInfo') };
  }
  return { ok: true, value: kind };
}

function serverUrls(spec: JsonObject, kind: SpecKind): string[] {
  if (isAsyncApi(kind)) {
    // 2.x: servers.{name}.url, 3.x: servers.{name}.host + pathname. Both have protocol.
    if (!isObject(spec.servers)) return [];
    return Object.values(spec.servers)
      .filter(isObject)
      .map((s) => {
        const protocol = typeof s.protocol === 'string' ? s.protocol : '';
        const address = typeof s.url === 'string' ? s.url : `${typeof s.host === 'string' ? s.host : ''}${typeof s.pathname === 'string' ? s.pathname : ''}`;
        return address && protocol && !address.includes('://') ? `${protocol}://${address}` : address;
      })
      .filter(Boolean);
  }
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

const tagNames = (value: unknown) =>
  Array.isArray(value) ? value.filter(isObject).map((t) => t.name).filter((n): n is string => typeof n === 'string') : [];

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);


// AsyncAPI operations in the same shape as HTTP ones: method is the action
// (SEND/RECEIVE in 3.x, PUBLISH/SUBSCRIBE in 2.x), path is the channel address.
function listAsyncOperations(spec: JsonObject, kind: SpecKind): OperationSummary[] {
  const ops: OperationSummary[] = [];
  const channels = isObject(spec.channels) ? spec.channels : {};
  if (kind === 'asyncapi-2') {
    for (const [name, channel] of Object.entries(channels)) {
      if (!isObject(channel)) continue;
      for (const action of ['publish', 'subscribe'] as const) {
        const op = channel[action];
        if (!isObject(op)) continue;
        ops.push({
          method: action.toUpperCase(),
          path: name,
          summary: text(op.summary),
          operationId: text(op.operationId),
          tags: tagNames(op.tags),
          deprecated: false,
        });
      }
    }
    return ops;
  }
  const operations = isObject(spec.operations) ? spec.operations : {};
  for (const [id, raw] of Object.entries(operations)) {
    const op = deref(spec, raw);
    if (!isObject(op)) continue;
    const channel = deref(spec, op.channel);
    const address = isObject(channel) ? (text(channel.address) ?? '') : '';
    const channelKey = isObject(op.channel) && typeof op.channel.$ref === 'string' ? op.channel.$ref.split('/').pop() : undefined;
    ops.push({
      method: (text(op.action) ?? 'send').toUpperCase(),
      path: address || channelKey || id,
      summary: text(op.summary) ?? text(op.title),
      operationId: id,
      tags: tagNames(op.tags),
      deprecated: false,
    });
  }
  return ops;
}

export function listOperations(spec: JsonObject): OperationSummary[] {
  const paths = isObject(spec.paths) ? spec.paths : {};
  const ops: OperationSummary[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    for (const method of operationMethods(spec)) {
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
  const operations = isAsyncApi(kind) ? listAsyncOperations(spec, kind) : listOperations(spec);
  // AsyncAPI 3 moved document tags into info.
  const declaredTags = tagNames(kind === 'asyncapi-3' ? info.tags : spec.tags);
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
  // Tag/path filters are an OpenAPI feature; AsyncAPI documents are shown whole.
  if (typeof spec.asyncapi === 'string') return spec;
  const tags = (options.includeTags ?? []).filter(Boolean);
  const prefixes = (options.includePaths ?? []).filter((p) => p.trim());
  const hideDeprecated = options.hideDeprecated === true;
  if (!tags.length && !prefixes.length && !hideDeprecated) return spec;

  const paths = isObject(spec.paths) ? spec.paths : {};
  const methods = operationMethods(spec);
  const filteredPaths: JsonObject = {};
  const usedTags = new Set<string>();

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    if (prefixes.length && !pathMatches(path, prefixes)) continue;

    const nextItem: JsonObject = {};
    let kept = 0;
    for (const [key, value] of Object.entries(item)) {
      const isOperation = methods.includes(key);
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

// ---------- Servers ----------

// Server URLs may contain {variables}, so these helpers work on strings and
// never run them through URL() (which would percent-encode the braces).
export const isAbsoluteServerUrl = (url: string) => url.includes('://');

function resolveAgainst(url: string, base: URL): string {
  if (url.startsWith('//')) return `${base.protocol}${url}`;
  if (url.startsWith('/')) return `${base.origin}${url}`;
  const dir = base.pathname.replace(/[^/]*$/, '');
  const joined = `${dir}${url.replace(/^\.\//, '')}`;
  return `${base.origin}${joined}`;
}

export interface ServerResolution {
  spec: JsonObject;
  /** True when every server Swagger UI could pick is absolute. */
  resolvable: boolean;
  /** Set when relative servers were rewritten against the spec's own URL. */
  resolvedAgainst?: string;
}

/**
 * OpenAPI says relative server URLs (and a missing `servers`, which means "/")
 * are relative to where the document is served. Swagger 2.0 says a missing
 * host means "the host serving the documentation". Inside Confluence that
 * location is meaningless unless the spec came from a URL, so resolve against
 * the spec URL when we have one and otherwise report that Try it out needs a
 * server override.
 */
export function resolveServers(spec: JsonObject, kind: SpecKind, specUrl?: string): ServerResolution {
  // AsyncAPI servers are brokers, not HTTP bases, and there's no Try it out for them.
  if (isAsyncApi(kind)) return { spec, resolvable: true };
  let base: URL | undefined;
  try {
    base = specUrl ? new URL(specUrl) : undefined;
  } catch {
    base = undefined;
  }

  if (kind === 'swagger-2.0') {
    if (typeof spec.host === 'string' && spec.host) return { spec, resolvable: true };
    if (!base) return { spec, resolvable: false };
    const next: JsonObject = { ...spec, host: base.host };
    if (!Array.isArray(spec.schemes) || !spec.schemes.length) next.schemes = [base.protocol.replace(':', '')];
    if (typeof spec.basePath !== 'string') next.basePath = '/';
    return { spec: next, resolvable: true, resolvedAgainst: base.origin };
  }

  let changed = false;
  let resolvable = true;
  const fix = (servers: unknown): unknown => {
    if (!Array.isArray(servers)) return servers;
    return servers.map((server) => {
      if (!isObject(server) || typeof server.url !== 'string' || isAbsoluteServerUrl(server.url)) return server;
      if (!base) {
        resolvable = false;
        return server;
      }
      changed = true;
      return { ...server, url: resolveAgainst(server.url, base) };
    });
  };

  const next: JsonObject = { ...spec };
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) {
    if (base) {
      next.servers = [{ url: base.origin }];
      changed = true;
    } else {
      resolvable = false;
    }
  } else {
    next.servers = fix(spec.servers);
  }

  if (isObject(spec.paths)) {
    const paths: JsonObject = {};
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!isObject(item)) {
        paths[path] = item;
        continue;
      }
      const nextItem: JsonObject = { ...item };
      if (item.servers) nextItem.servers = fix(item.servers);
      for (const method of operationMethods(spec)) {
        const op = item[method];
        if (isObject(op) && op.servers) nextItem[method] = { ...op, servers: fix(op.servers) };
      }
      paths[path] = nextItem;
    }
    next.paths = paths;
  }

  if (!changed) return { spec, resolvable };
  return { spec: next, resolvable, resolvedAgainst: base?.origin };
}

/** Point every operation at one server, e.g. a staging URL chosen in the macro settings. */
export function applyServerOverride<T extends JsonObject>(spec: T, kind: SpecKind, serverUrl: string | undefined): T {
  const url = serverUrl?.trim();
  if (!url || isAsyncApi(kind)) return spec;

  if (kind === 'swagger-2.0') {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return spec;
    }
    return {
      ...spec,
      host: parsed.host,
      basePath: parsed.pathname.replace(/\/+$/, '') || '/',
      schemes: [parsed.protocol.replace(':', '')],
    };
  }

  const next: JsonObject = { ...spec, servers: [{ url }] };
  if (isObject(spec.paths)) {
    const paths: JsonObject = {};
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!isObject(item)) {
        paths[path] = item;
        continue;
      }
      const nextItem: JsonObject = { ...item };
      delete nextItem.servers;
      for (const method of operationMethods(spec)) {
        const op = item[method];
        if (isObject(op) && op.servers) {
          const copy = { ...op };
          delete copy.servers;
          nextItem[method] = copy;
        }
      }
      paths[path] = nextItem;
    }
    next.paths = paths;
  }
  return next as T;
}
