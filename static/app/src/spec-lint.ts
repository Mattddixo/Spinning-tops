import { parseDocument } from 'yaml';
import { validateSpecShape } from '../../../src/shared/spec';

export interface SpecProblem {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

// Problems shown inline in the editor. YAML is a superset of JSON, so one
// parser covers both and gives character offsets for every error.
export function lintSpecText(text: string): SpecProblem[] {
  if (!text.trim()) return [];
  const doc = parseDocument(text, { prettyErrors: false });
  const problems: SpecProblem[] = [];
  const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
  // Errors reported at the very end (e.g. an unclosed bracket) would land on
  // trailing whitespace, which has nothing to underline; mark the last visible
  // character instead.
  const lastVisible = Math.max(0, text.trimEnd().length - 1);
  const range = (from: number, to: number) => {
    const start = Math.min(clamp(from), lastVisible);
    return { from: start, to: Math.max(Math.min(clamp(to), lastVisible + 1), start + 1) };
  };
  for (const err of doc.errors) {
    problems.push({ ...range(...err.pos), severity: 'error', message: firstLine(err.message) });
  }
  for (const warning of doc.warnings) {
    problems.push({ ...range(...warning.pos), severity: 'warning', message: firstLine(warning.message) });
  }
  if (problems.some((p) => p.severity === 'error')) return problems;

  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ from: 0, to: Math.min(text.length, firstLineEnd(text)), severity: 'error', message: 'The document must be an object (a YAML mapping or JSON object).' }];
  }
  const shape = validateSpecShape(value as Record<string, unknown>);
  if (!shape.ok) {
    problems.push({ from: 0, to: Math.min(text.length, firstLineEnd(text)), severity: 'error', message: shape.error.message });
  }
  return problems;
}

const firstLine = (message: string) => message.split('\n')[0];
const firstLineEnd = (text: string) => {
  const i = text.indexOf('\n');
  return i < 0 ? text.length : i;
};
