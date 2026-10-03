// Local $ref resolution for bundled specs, shared by the change list, code
// samples and quality report. Only "#/..." pointers are followed; bundling
// has already turned other refs into local ones.

export type Json = Record<string, unknown>;

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

const OAS32_METHODS: readonly string[] = [...HTTP_METHODS, 'query'];

/**
 * The path item keys that hold operations: the usual eight, plus `query` in
 * OpenAPI 3.2. (3.2's `additionalOperations` isn't listed because Swagger UI
 * doesn't render it, and search, export and comparisons should match what
 * readers see.)
 */
export const operationMethods = (spec: Record<string, unknown>): readonly string[] =>
  typeof spec.openapi === 'string' && /^3\.2\./.test(spec.openapi) ? OAS32_METHODS : HTTP_METHODS;

const MAX_REF_HOPS = 20;

export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Follow a JSON pointer such as "#/components/schemas/Pet". */
export function pointer(root: Json, ref: string): unknown {
  if (ref === '#') return root;
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
    if (Array.isArray(node)) node = node[Number(segment)];
    else if (isObject(node)) node = Object.prototype.hasOwnProperty.call(node, segment) ? node[segment] : undefined;
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/** Follow $refs to the object they point at, and report the last ref followed (for cycle checks). */
export function resolveRef(root: Json, node: unknown): { value?: Json; ref?: string } {
  let current = node;
  let ref: string | undefined;
  for (let hop = 0; hop < MAX_REF_HOPS && isObject(current) && typeof current.$ref === 'string'; hop++) {
    ref = current.$ref;
    current = pointer(root, current.$ref);
  }
  return isObject(current) && typeof current.$ref !== 'string' ? { value: current, ref } : { ref };
}

export const deref = (root: Json, node: unknown): Json | undefined => resolveRef(root, node).value;

/**
 * An operation's parameters: path-level ones first, replaced by
 * operation-level ones with the same name and location (as OpenAPI defines).
 */
export function mergedParameters(root: Json, item: Json, op: Json): Json[] {
  const params = new Map<string, Json>();
  for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
    const p = deref(root, raw);
    if (p && typeof p.name === 'string' && typeof p.in === 'string') params.set(`${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`, p);
  }
  return [...params.values()];
}
