import { deref, operationMethods, isObject, mergedParameters, type Json } from './refs';
import type { QualityCheck, QualityCheckId, QualityReport, SpecKind } from './types';

// Documentation quality checks for OpenAPI and Swagger, in the spirit of the
// Spectral "oas" ruleset: things that make docs hard to use rather than
// things that make a spec invalid (Swagger UI already complains about those).
// Important checks count double in the score.

const MAX_EXAMPLES = 8;

const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

class Check {
  passed = 0;
  total = 0;
  readonly examples: string[] = [];
  constructor(
    readonly id: QualityCheckId,
    readonly important: boolean,
  ) {}

  record(ok: boolean, label: string) {
    this.total++;
    if (ok) this.passed++;
    else if (this.examples.length < MAX_EXAMPLES) this.examples.push(label);
  }

  result(): QualityCheck {
    const failed = this.total - this.passed;
    return { id: this.id, important: this.important, passed: this.passed, total: this.total, failed, examples: this.examples, more: Math.max(0, failed - this.examples.length) };
  }
}

/** Does a request/response body (or Swagger 2 response) carry an example anywhere obvious? */
function bodyHasExample(root: Json, holder: Json, swagger: boolean): boolean {
  if (swagger) {
    if (isObject(holder.examples) && Object.keys(holder.examples).length) return true;
    const schema = deref(root, holder.schema);
    return schema !== undefined && schemaHasExample(root, schema);
  }
  const content = isObject(holder.content) ? holder.content : {};
  return Object.values(content).some((media) => {
    if (!isObject(media)) return false;
    if (media.example !== undefined || (isObject(media.examples) && Object.keys(media.examples).length)) return true;
    const schema = deref(root, media.schema);
    return schema !== undefined && schemaHasExample(root, schema);
  });
}

// An example on the schema itself, or on every top-level property, is enough.
function schemaHasExample(root: Json, schema: Json): boolean {
  if (schema.example !== undefined || (Array.isArray(schema.examples) && schema.examples.length)) return true;
  if (schema.items !== undefined) {
    const items = deref(root, schema.items);
    if (items && (items.example !== undefined || (Array.isArray(items.examples) && items.examples.length))) return true;
  }
  const props = isObject(schema.properties) ? Object.values(schema.properties) : [];
  return props.length > 0 && props.every((p) => {
    const prop = deref(root, p);
    return prop !== undefined && (prop.example !== undefined || (Array.isArray(prop.examples) && prop.examples.length > 0) || Array.isArray(prop.enum));
  });
}

const hasBody = (holder: Json, swagger: boolean) =>
  swagger ? holder.schema !== undefined : isObject(holder.content) && Object.keys(holder.content).length > 0;

export function assessQuality(spec: Json, kind: SpecKind): QualityReport {
  const swagger = kind === 'swagger-2.0';
  const info = isObject(spec.info) ? spec.info : {};
  const components = isObject(spec.components) ? spec.components : {};

  const checks = {
    infoDescription: new Check('infoDescription', true),
    contact: new Check('contact', false),
    servers: new Check('servers', true),
    securityDefined: new Check('securityDefined', false),
    operationSummary: new Check('operationSummary', true),
    operationDescription: new Check('operationDescription', false),
    operationId: new Check('operationId', false),
    operationTags: new Check('operationTags', false),
    tagDescriptions: new Check('tagDescriptions', false),
    successResponse: new Check('successResponse', true),
    errorResponse: new Check('errorResponse', true),
    parameterDescription: new Check('parameterDescription', true),
    requestExample: new Check('requestExample', false),
    responseExample: new Check('responseExample', false),
    schemaDescription: new Check('schemaDescription', false),
  } satisfies Record<QualityCheckId, Check>;

  checks.infoDescription.record(hasText(info.description), 'info.description');
  checks.contact.record(isObject(info.contact) && (hasText(info.contact.email) || hasText(info.contact.url) || hasText(info.contact.name)), 'info.contact');
  checks.servers.record(
    swagger ? hasText(spec.host) : Array.isArray(spec.servers) && spec.servers.some((s) => isObject(s) && hasText(s.url)),
    swagger ? 'host' : 'servers',
  );
  const schemes = swagger ? spec.securityDefinitions : components.securitySchemes;
  checks.securityDefined.record(isObject(schemes) && Object.keys(schemes).length > 0, swagger ? 'securityDefinitions' : 'components.securitySchemes');

  const usedTags = new Set<string>();
  const ids = new Map<string, number>();
  const paths = isObject(spec.paths) ? spec.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(spec, rawItem);
    if (!item) continue;
    for (const method of operationMethods(spec)) {
      const op = item[method];
      if (!isObject(op)) continue;
      const label = `${method.toUpperCase()} ${path}`;
      checks.operationSummary.record(hasText(op.summary), label);
      checks.operationDescription.record(hasText(op.description), label);
      checks.operationId.record(hasText(op.operationId), label);
      if (hasText(op.operationId)) ids.set(op.operationId as string, (ids.get(op.operationId as string) ?? 0) + 1);
      const tags = Array.isArray(op.tags) ? op.tags.filter(hasText) : [];
      checks.operationTags.record(tags.length > 0, label);
      for (const t of tags) usedTags.add(t as string);

      const responses = isObject(op.responses) ? op.responses : {};
      const codes = Object.keys(responses);
      checks.successResponse.record(codes.some((c) => /^[23]/.test(c)), label);
      checks.errorResponse.record(codes.some((c) => /^[45]/.test(c) || c === 'default'), label);

      // Operation-level parameters replace path-level ones with the same name, so each counts once.
      const params = mergedParameters(spec, item, op);
      for (const p of params) {
        if (swagger && p.in === 'body') continue;
        checks.parameterDescription.record(hasText(p.description), `${label}: ${p.name} (${String(p.in)})`);
      }

      if (swagger) {
        const body = params.find((p) => p.in === 'body');
        if (body) checks.requestExample.record(bodyHasExample(spec, body, true), label);
      } else {
        const body = deref(spec, op.requestBody);
        if (body && hasBody(body, false)) checks.requestExample.record(bodyHasExample(spec, body, false), label);
      }
      for (const [code, raw] of Object.entries(responses)) {
        if (!/^2/.test(code)) continue;
        const res = deref(spec, raw);
        if (res && hasBody(res, swagger)) checks.responseExample.record(bodyHasExample(spec, res, swagger), `${label} → ${code}`);
      }
    }
  }

  const declared = new Map((Array.isArray(spec.tags) ? spec.tags : []).filter(isObject).map((t) => [String(t.name), t]));
  for (const name of usedTags) checks.tagDescriptions.record(hasText(declared.get(name)?.description), name);

  const schemas = swagger ? spec.definitions : components.schemas;
  for (const [name, raw] of Object.entries(isObject(schemas) ? schemas : {})) {
    const schema = deref(spec, raw);
    if (schema) checks.schemaDescription.record(hasText(schema.description) || hasText(schema.title), name);
  }

  const results = Object.values(checks).map((c) => c.result());
  let earned = 0;
  let possible = 0;
  for (const c of results) {
    if (!c.total) continue;
    const weight = c.important ? 2 : 1;
    earned += (weight * c.passed) / c.total;
    possible += weight;
  }
  const duplicates = [...ids].filter(([, n]) => n > 1).map(([id]) => id);
  return { score: possible ? Math.round((100 * earned) / possible) : 100, checks: results, duplicateOperationIds: duplicates };
}
