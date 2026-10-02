// Stand-in for '@asyncapi/parser' in the browser bundle (aliased in
// vite.config.ts). The real entry point imports the validator, which compiles
// JSON schemas with `new Function` at load time and is blocked by Forge's
// CSP. SpecPage parses AsyncAPI on the backend and sends a stringified
// document, so the UI only needs the document models and unstringify.
export * from '@asyncapi/parser/esm/models';
export { createAsyncAPIDocument, isAsyncAPIDocument, isOldAsyncAPIDocument, isParsedDocument, isStringifiedDocument, toAsyncAPIDocument } from '@asyncapi/parser/esm/document';
export { unstringify } from '@asyncapi/parser/esm/stringify';
export { DiagnosticSeverity } from '@stoplight/types';

function unavailable(): never {
  throw new Error('AsyncAPI parsing runs on the SpecPage backend, not in the browser.');
}

export class Parser {
  parse = unavailable;
  validate = unavailable;
  registerSchemaParser = unavailable;
}

export const fromURL = unavailable;
