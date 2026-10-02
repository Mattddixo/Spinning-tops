import { fail } from './errors';

// AsyncAPI documents are parsed here rather than in the browser: the parser
// validates with Ajv, which compiles schemas with `new Function`, and Forge's
// CSP blocks that in Custom UI. The UI gets the parser's stringified document
// and renders it with @asyncapi/react-component's parser-free entry point.

// DiagnosticSeverity.Error in @stoplight/types
const SEVERITY_ERROR = 0;
const MAX_REPORTED = 5;

export async function parseAsyncApi(spec: Record<string, unknown>): Promise<string> {
  // Loaded on demand so OpenAPI-only invocations don't pay for it.
  const { Parser, stringify } = await import('@asyncapi/parser');
  const parser = new Parser();
  const { document, diagnostics } = await parser.parse(JSON.stringify(spec));
  const errors = diagnostics.filter((d) => d.severity === SEVERITY_ERROR);
  if (!document || errors.length) {
    const detail = errors
      .slice(0, MAX_REPORTED)
      .map((d) => (d.path.length ? `${d.message} (at ${d.path.join('.')})` : d.message))
      .join('\n');
    return fail('INVALID_SPEC', 'errors.asyncapiInvalid', { count: errors.length }, { detail: detail || undefined });
  }
  const stringified = stringify(document);
  if (!stringified) return fail('INVALID_SPEC', 'errors.asyncapiInvalid', { count: 1 });
  return stringified;
}
