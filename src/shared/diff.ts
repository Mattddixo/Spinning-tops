import { isObject, operationMethods, mergedParameters, resolveRef, type Json } from './refs';
import type { ChangeCode, ChangeLevel, SpecChange, SpecDiff, SpecKind } from './types';

// Compare two OpenAPI or Swagger documents and list what changed for API
// clients. The rules follow the usual compatibility reasoning (and broadly
// match tools like oasdiff):
//
// - Requests: anything that makes a request that used to work fail is
//   breaking (an operation or media type removed, a new required parameter or
//   property, a narrower type, a removed enum value, a tighter limit).
// - Responses: anything a client could fail to handle is breaking (a success
//   response or media type removed, a property removed, a wider type).
// - Things clients may trip over but often don't are warnings (deprecations,
//   new enum values in responses, auth changes, oneOf/anyOf edits).
// - Additions that can't break anyone are info.
//
// Both documents are expected to be bundled (only local $refs left).

type Direction = 'request' | 'response';

const MAX_CHANGES = 500;
// Safety limit on what's collected before sorting; far above MAX_CHANGES so
// breaking changes found late still make the cut.
const MAX_COLLECTED = 20_000;
const MAX_DEPTH = 12;


interface Side {
  root: Json;
  swagger: boolean;
}

interface Where {
  operation?: string;
  section?: SpecChange['section'];
  status?: string;
  location?: string;
}

class Collector {
  readonly changes: SpecChange[] = [];
  private readonly keys = new Set<string>();
  truncated = false;
  // Caps the work on huge or deeply shared schemas.
  private budget = 50_000;

  spend(): boolean {
    if (this.budget-- > 0) return true;
    this.truncated = true;
    return false;
  }

  add(level: ChangeLevel, code: ChangeCode, where: Where, params?: Record<string, string | number>) {
    const change: SpecChange = { level, code };
    if (where.operation) change.operation = where.operation;
    if (where.section) change.section = where.section;
    if (where.status) change.status = where.status;
    if (where.location) change.location = where.location;
    if (params && Object.keys(params).length) change.params = params;
    // The same schema change can show up once per media type; list it once.
    const key = JSON.stringify(change);
    if (this.keys.has(key)) return;
    if (this.changes.length >= MAX_COLLECTED) {
      this.truncated = true;
      return;
    }
    this.keys.add(key);
    this.changes.push(change);
  }
}

/** Fold allOf parts into one schema so properties and required lists can be compared. */
function flatten(root: Json, schema: Json, depth = 0): Json {
  if (!Array.isArray(schema.allOf) || depth > MAX_DEPTH) return schema;
  const { allOf, ...rest } = schema;
  const merged: Json = { ...rest };
  const properties: Json = isObject(rest.properties) ? { ...rest.properties } : {};
  const required = new Set<string>(Array.isArray(rest.required) ? rest.required.filter((r): r is string => typeof r === 'string') : []);
  for (const part of allOf as unknown[]) {
    const resolved = resolveRef(root, part).value;
    if (!resolved) continue;
    const flat = flatten(root, resolved, depth + 1);
    if (isObject(flat.properties)) Object.assign(properties, flat.properties);
    if (Array.isArray(flat.required)) for (const r of flat.required) if (typeof r === 'string') required.add(r);
    for (const [k, v] of Object.entries(flat)) if (k !== 'properties' && k !== 'required' && merged[k] === undefined) merged[k] = v;
  }
  if (Object.keys(properties).length) merged.properties = properties;
  if (required.size) merged.required = [...required];
  return merged;
}

// --- schemas ---

function typeSet(schema: Json): Set<string> | undefined {
  const raw = schema.type;
  if (raw === undefined) return undefined;
  const set = new Set((Array.isArray(raw) ? raw : [raw]).filter((t): t is string => typeof t === 'string'));
  if (schema.nullable === true) set.add('null');
  return set.size ? set : undefined;
}

/** Does `wide` accept every value `narrow` allows? */
function accepts(wide: Set<string>, narrow: Set<string>): boolean {
  return [...narrow].every((t) => wide.has(t) || (t === 'integer' && wide.has('number')));
}

const typeLabel = (set: Set<string>) => [...set].sort().join(' | ');
const requiredOf = (s: Json) => new Set(Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === 'string') : []);
const enumKeys = (s: Json) => (Array.isArray(s.enum) ? s.enum.map((v) => JSON.stringify(v)) : undefined);
const joinPath = (location: string, part: string) => (location ? `${location}.${part}` : part);

// Limits where a smaller number is stricter, and where a larger one is.
const UPPER_LIMITS = ['maxLength', 'maxItems', 'maxProperties', 'maximum'] as const;
const LOWER_LIMITS = ['minLength', 'minItems', 'minProperties', 'minimum'] as const;

interface SchemaWalk {
  base: Side;
  head: Side;
  out: Collector;
  operation: string;
  direction: Direction;
  section?: SpecChange['section'];
  status?: string;
  ancestors: Set<string>;
}

function compareSchema(walk: SchemaWalk, baseRaw: unknown, headRaw: unknown, location: string, depth: number) {
  if (depth > MAX_DEPTH) return;
  const b = resolveRef(walk.base.root, baseRaw);
  const h = resolveRef(walk.head.root, headRaw);
  if (!b.value || !h.value) return;
  if (!walk.out.spend()) return;
  // Recursive schemas: stop when a pair of refs is already being compared
  // further up. A schema reused in two places is still compared in both.
  const pairKey = b.ref && h.ref ? `${b.ref}\u0000${h.ref}` : undefined;
  if (pairKey) {
    if (walk.ancestors.has(pairKey)) return;
    walk.ancestors.add(pairKey);
  }
  try {
    compareResolved(walk, b.value, h.value, location, depth);
  } finally {
    if (pairKey) walk.ancestors.delete(pairKey);
  }
}

function compareResolved(walk: SchemaWalk, baseValue: Json, headValue: Json, location: string, depth: number) {
  const base = flatten(walk.base.root, baseValue);
  const head = flatten(walk.head.root, headValue);
  const { out, operation, direction } = walk;
  const scope: Where = { operation, section: walk.section, status: walk.status };
  const where: Where = { ...scope, location: location || undefined };
  const isRequest = direction === 'request';

  // type
  const bt = typeSet(base);
  const ht = typeSet(head);
  if (bt && ht && typeLabel(bt) !== typeLabel(ht)) {
    const narrowed = isRequest ? !accepts(ht, bt) : !accepts(bt, ht);
    out.add(narrowed ? 'breaking' : 'info', 'typeChanged', where, { from: typeLabel(bt), to: typeLabel(ht) });
  }

  // format
  if ((base.format ?? '') !== (head.format ?? '') && (typeof base.format === 'string' || typeof head.format === 'string')) {
    out.add('warning', 'formatChanged', where, { from: String(base.format ?? '-'), to: String(head.format ?? '-') });
  }

  // enum
  const be = enumKeys(base);
  const he = enumKeys(head);
  if (be || he) {
    const removed = be ? be.filter((v) => !he || !he.includes(v)) : [];
    const added = he ? he.filter((v) => !be || !be.includes(v)) : [];
    // No enum before means any value was allowed, so a new enum is a restriction.
    if (!be && he) out.add(isRequest ? 'breaking' : 'info', 'enumAdded', where);
    else if (be && !he) out.add(isRequest ? 'info' : 'warning', 'enumRemoved', where);
    else {
      for (const v of removed) out.add(isRequest ? 'breaking' : 'info', 'enumValueRemoved', where, { value: v });
      for (const v of added) out.add(isRequest ? 'info' : 'warning', 'enumValueAdded', where, { value: v });
    }
  }

  // limits
  const limit = (s: Json, k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
  for (const k of UPPER_LIMITS) {
    const bv = limit(base, k);
    const hv = limit(head, k);
    if (bv === hv) continue;
    const tighter = hv !== undefined && (bv === undefined || hv < bv);
    reportLimit(walk, where, k, bv, hv, tighter);
  }
  for (const k of LOWER_LIMITS) {
    const bv = limit(base, k);
    const hv = limit(head, k);
    if (bv === hv) continue;
    const tighter = hv !== undefined && (bv === undefined || hv > bv);
    reportLimit(walk, where, k, bv, hv, tighter);
  }

  // oneOf / anyOf are too open-ended to reason about safely; flag them for a person.
  for (const k of ['oneOf', 'anyOf'] as const) {
    if ((base[k] !== undefined || head[k] !== undefined) && JSON.stringify(base[k] ?? null) !== JSON.stringify(head[k] ?? null)) {
      out.add('warning', 'compositionChanged', where, { keyword: k });
    }
  }

  // properties
  const bp = isObject(base.properties) ? base.properties : {};
  const hp = isObject(head.properties) ? head.properties : {};
  const br = requiredOf(base);
  const hr = requiredOf(head);
  // readOnly properties aren't sent in requests, writeOnly ones aren't returned.
  const hidden = (raw: unknown, root: Json) => {
    const s = resolveRef(root, raw).value;
    return isRequest ? s?.readOnly === true : s?.writeOnly === true;
  };
  for (const name of new Set([...Object.keys(bp), ...Object.keys(hp)])) {
    const path = joinPath(location, name);
    const inBase = name in bp && !hidden(bp[name], walk.base.root);
    const inHead = name in hp && !hidden(hp[name], walk.head.root);
    const at: Where = { ...scope, location: path };
    if (inBase && !inHead) {
      if (name in hp) continue; // now read-only / write-only; not worth a separate rule
      if (isRequest) out.add(head.additionalProperties === false ? 'breaking' : 'warning', 'propertyRemoved', at);
      else out.add(br.has(name) ? 'breaking' : 'warning', 'propertyRemoved', at);
    } else if (!inBase && inHead) {
      // Also covers a property that was read-only (or write-only) and now isn't.
      out.add(isRequest && hr.has(name) ? 'breaking' : 'info', isRequest && hr.has(name) ? 'requiredPropertyAdded' : 'propertyAdded', at);
    } else if (inBase && inHead) {
      if (!br.has(name) && hr.has(name)) out.add(isRequest ? 'breaking' : 'info', 'propertyBecameRequired', at);
      if (br.has(name) && !hr.has(name)) out.add(isRequest ? 'info' : 'warning', 'propertyBecameOptional', at);
      compareSchema(walk, bp[name], hp[name], path, depth + 1);
    }
  }

  if (base.items !== undefined && head.items !== undefined) compareSchema(walk, base.items, head.items, `${location || ''}[]`, depth + 1);
  if (isObject(base.additionalProperties) && isObject(head.additionalProperties)) {
    compareSchema(walk, base.additionalProperties, head.additionalProperties, joinPath(location, '*'), depth + 1);
  }
}

function reportLimit(walk: SchemaWalk, where: Where, keyword: string, from: number | undefined, to: number | undefined, tighter: boolean) {
  const isRequest = walk.direction === 'request';
  const params = { keyword, from: from ?? '-', to: to ?? '-' };
  if (isRequest) walk.out.add(tighter ? 'breaking' : 'info', tighter ? 'limitTightened' : 'limitLoosened', where, params);
  else walk.out.add(tighter ? 'info' : 'warning', tighter ? 'limitTightened' : 'limitLoosened', where, params);
}

// --- operations ---

interface NormalParam {
  label: string;
  required: boolean;
  schema: unknown;
}

interface NormalBody {
  required: boolean;
  content: Map<string, unknown>;
}

interface NormalOperation {
  path: string;
  deprecated: boolean;
  params: Map<string, NormalParam>;
  body?: NormalBody;
  responses: Map<string, Map<string, unknown>>;
  security: string;
  securityOptional: boolean;
}

const templateKey = (path: string) => path.replace(/\{[^}]*\}/g, '{}');
const pathParamNames = (path: string) => [...path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
const asStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

// Swagger 2 parameters keep type/format/items on the parameter itself.
function swaggerParamSchema(param: Json): Json {
  const { name: _n, in: _i, required: _r, description: _d, ...schema } = param;
  return schema;
}

function normalise(side: Side, path: string, item: Json, op: Json): NormalOperation {
  const { root, swagger } = side;
  const params = new Map<string, NormalParam>();
  const formData: Json[] = [];
  let body: NormalBody | undefined;
  const positions = pathParamNames(path);
  const consumes = asStrings(op.consumes) ?? asStrings(root.consumes) ?? ['application/json'];

  for (const p of mergedParameters(root, item, op)) {
    if (typeof p.name !== 'string' || typeof p.in !== 'string') continue;
    if (swagger && p.in === 'body') {
      body = { required: p.required === true, content: new Map(consumes.map((mt) => [mt, p.schema])) };
      continue;
    }
    if (swagger && p.in === 'formData') {
      formData.push(p);
      continue;
    }
    // Path parameters are matched by position, so renaming {id} to {petId} isn't a change.
    const index = p.in === 'path' ? positions.indexOf(p.name) : -1;
    const key = p.in === 'path' ? `path:${index >= 0 ? index : p.name}` : `${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`;
    let schema: unknown = p.schema;
    if (swagger) schema = swaggerParamSchema(p);
    else if (schema === undefined && isObject(p.content)) schema = Object.values(p.content).map((c) => (isObject(c) ? c.schema : undefined))[0];
    params.set(key, { label: `${p.name} (${p.in})`, required: p.in === 'path' || p.required === true, schema });
  }

  if (swagger && formData.length) {
    const types = consumes.filter((mt) => mt.includes('form'));
    const schema: Json = {
      type: 'object',
      properties: Object.fromEntries(formData.map((p) => [p.name as string, swaggerParamSchema(p)])),
      required: formData.filter((p) => p.required === true).map((p) => p.name as string),
    };
    // Required form fields are judged one by one, so the body itself counts as optional.
    body = { required: false, content: new Map((types.length ? types : ['application/x-www-form-urlencoded']).map((mt) => [mt, schema])) };
  }
  if (!swagger && op.requestBody !== undefined) {
    const rb = resolveRef(root, op.requestBody).value;
    if (rb) body = { required: rb.required === true, content: new Map(Object.entries(isObject(rb.content) ? rb.content : {}).map(([mt, c]) => [mt, isObject(c) ? c.schema : undefined])) };
  }

  const responses = new Map<string, Map<string, unknown>>();
  const produces = asStrings(op.produces) ?? asStrings(root.produces) ?? ['application/json'];
  for (const [status, raw] of Object.entries(isObject(op.responses) ? op.responses : {})) {
    if (status.startsWith('x-')) continue;
    const r = resolveRef(root, raw).value;
    if (!r) continue;
    if (swagger) responses.set(status, new Map(r.schema !== undefined ? produces.map((mt) => [mt, r.schema]) : []));
    else responses.set(status, new Map(Object.entries(isObject(r.content) ? r.content : {}).map(([mt, c]) => [mt, isObject(c) ? c.schema : undefined])));
  }

  const requirements = (Array.isArray(op.security) ? op.security : Array.isArray(root.security) ? root.security : []).filter(isObject);
  const security = JSON.stringify(
    requirements
      .map((req) =>
        Object.keys(req)
          .sort()
          .map((name) => `${name}[${(asStrings(req[name]) ?? []).sort().join(',')}]`)
          .join('+'),
      )
      .sort(),
  );
  const securityOptional = requirements.length === 0 || requirements.some((req) => Object.keys(req).length === 0);

  return { path, deprecated: op.deprecated === true, params, body, responses, security, securityOptional };
}

function operations(side: Side): Map<string, NormalOperation> {
  const out = new Map<string, NormalOperation>();
  const paths = isObject(side.root.paths) ? side.root.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = resolveRef(side.root, rawItem).value;
    if (!item) continue;
    for (const method of operationMethods(side.root)) {
      const op = item[method];
      if (isObject(op)) out.set(`${method.toUpperCase()} ${templateKey(path)}`, normalise(side, path, item, op));
    }
  }
  return out;
}

const isSuccess = (status: string) => /^2/.test(status);

function compareOperation(base: Side, head: Side, out: Collector, method: string, b: NormalOperation, h: NormalOperation) {
  const operation = `${method} ${h.path}`;
  const request: SchemaWalk = { base, head, out, operation, direction: 'request', ancestors: new Set() };
  const response: SchemaWalk = { base, head, out, operation, direction: 'response', section: 'response', ancestors: new Set() };

  if (!b.deprecated && h.deprecated) out.add('warning', 'operationDeprecated', { operation });

  // parameters
  for (const [key, hp] of h.params) {
    const bp = b.params.get(key);
    if (!bp) {
      out.add(hp.required ? 'breaking' : 'info', hp.required ? 'requiredParameterAdded' : 'parameterAdded', { operation, location: hp.label });
      continue;
    }
    if (!bp.required && hp.required) out.add('breaking', 'parameterBecameRequired', { operation, location: hp.label });
    if (bp.required && !hp.required) out.add('info', 'parameterBecameOptional', { operation, location: hp.label });
    compareSchema(request, bp.schema, hp.schema, hp.label, 0);
  }
  for (const [key, bp] of b.params) {
    if (!h.params.has(key)) out.add('warning', 'parameterRemoved', { operation, location: bp.label });
  }

  // request body
  if (b.body && !h.body) out.add('warning', 'requestBodyRemoved', { operation });
  if (!b.body && h.body) out.add(h.body.required ? 'breaking' : 'info', h.body.required ? 'requiredRequestBodyAdded' : 'requestBodyAdded', { operation });
  if (b.body && h.body) {
    if (!b.body.required && h.body.required) out.add('breaking', 'requestBodyBecameRequired', { operation });
    for (const mt of b.body.content.keys()) if (!h.body.content.has(mt)) out.add('breaking', 'requestMediaTypeRemoved', { operation, section: 'requestBody' }, { mediaType: mt });
    for (const mt of h.body.content.keys()) if (!b.body.content.has(mt)) out.add('info', 'requestMediaTypeAdded', { operation, section: 'requestBody' }, { mediaType: mt });
    for (const [mt, schema] of h.body.content) {
      if (!b.body.content.has(mt)) continue;
        compareSchema({ ...request, section: 'requestBody' }, b.body.content.get(mt), schema, '', 0);
    }
  }

  // responses
  for (const [status, bContent] of b.responses) {
    const hContent = h.responses.get(status);
    if (!hContent) {
      out.add(isSuccess(status) ? 'breaking' : 'warning', 'responseRemoved', { operation, section: 'response', status });
      continue;
    }
    for (const mt of bContent.keys()) if (!hContent.has(mt)) out.add('breaking', 'responseMediaTypeRemoved', { operation, section: 'response', status }, { mediaType: mt });
    for (const [mt, schema] of hContent) {
      if (!bContent.has(mt)) continue;
      compareSchema({ ...response, status }, bContent.get(mt), schema, '', 0);
    }
  }
  for (const status of h.responses.keys()) {
    if (!b.responses.has(status)) out.add(isSuccess(status) ? 'warning' : 'info', 'responseAdded', { operation, section: 'response', status });
  }

  // security
  if (b.security !== h.security) {
    if (b.securityOptional && !h.securityOptional) out.add('breaking', 'securityAdded', { operation });
    else out.add('warning', 'securityChanged', { operation });
  }
}

const LEVEL_ORDER: Record<ChangeLevel, number> = { breaking: 0, warning: 1, info: 2 };

export function diffSpecs(baseSpec: Json, baseKind: SpecKind, headSpec: Json, headKind: SpecKind): SpecDiff {
  const base: Side = { root: baseSpec, swagger: baseKind === 'swagger-2.0' };
  const head: Side = { root: headSpec, swagger: headKind === 'swagger-2.0' };
  const out = new Collector();
  const baseOps = operations(base);
  const headOps = operations(head);

  for (const [key, b] of baseOps) {
    const h = headOps.get(key);
    const method = key.split(' ')[0];
    if (!h) out.add('breaking', 'operationRemoved', { operation: `${method} ${b.path}` });
    else compareOperation(base, head, out, method, b, h);
  }
  for (const [key, h] of headOps) {
    if (!baseOps.has(key)) out.add('info', 'operationAdded', { operation: `${key.split(' ')[0]} ${h.path}` });
  }

  // Sort everything first, so a long list is cut from the least important end.
  const sorted = out.changes
    .map((c, i) => ({ c, i }))
    .sort((x, y) => LEVEL_ORDER[x.c.level] - LEVEL_ORDER[y.c.level] || (x.c.operation ?? '').localeCompare(y.c.operation ?? '') || x.i - y.i)
    .map(({ c }) => c);
  // Counts cover every change found, not just the ones listed.
  const counts = { breaking: 0, warning: 0, info: 0 };
  for (const c of sorted) counts[c.level]++;
  return { changes: sorted.slice(0, MAX_CHANGES), counts, truncated: out.truncated || sorted.length > MAX_CHANGES };
}
