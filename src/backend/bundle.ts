import { $RefParser, type FileInfo } from '@apidevtools/json-schema-ref-parser';
import { parse as parseYaml } from 'yaml';
import { parseSpecText, summarizeSpec, validateSpecShape } from '../shared/spec';
import type { SpecSummary } from '../shared/types';
import { AppFailure, fail } from './errors';
import { MAX_SPEC_BYTES } from './http';
import { isSyntheticUrl, type SpecSource } from './sources/types';
import { readUrl } from './sources/url';

export const MAX_FILES = 50;
const BUNDLE_TIMEOUT_MS = 12_000;

export interface BundledSpec {
  spec: Record<string, unknown>;
  summary: SpecSummary;
  fileCount: number;
  warnings: string[];
}

export interface BundleOptions {
  /** Absolute https `$ref`s are only followed when URL sources are enabled. */
  allowExternalUrls: boolean;
  /** Root document text, if the caller already has it (inline specs). */
  rootText?: string;
}

/**
 * Read the root document, follow relative `$ref`s through the same source,
 * and return a single self-contained document with only internal `$ref`s.
 */
export async function loadAndBundle(source: SpecSource, options: BundleOptions): Promise<BundledSpec> {
  let totalBytes = 0;
  const seen = new Set<string>();
  const warnings: string[] = [];

  const track = (url: string, text: string) => {
    seen.add(url);
    totalBytes += text.length;
    if (seen.size > MAX_FILES) fail('TOO_LARGE', `The spec references more than ${MAX_FILES} files.`);
    if (totalBytes > MAX_SPEC_BYTES) fail('TOO_LARGE', 'The spec and its referenced files are larger than 4.5 MB in total.');
  };

  const rootText = options.rootText ?? (await source.read(source.baseUrl));
  track(source.baseUrl, rootText);

  const parsed = parseSpecText(rootText);
  if (!parsed.ok) throw new AppFailure(parsed.error.code, parsed.error.message, parsed.error.detail);
  const shape = validateSpecShape(parsed.value);
  if (!shape.ok) throw new AppFailure(shape.error.code, shape.error.message, shape.error.detail);

  let bundled: Record<string, unknown>;
  try {
    bundled = (await $RefParser.bundle(source.baseUrl, parsed.value, {
      timeoutMs: BUNDLE_TIMEOUT_MS,
      mutateInputSchema: true,
      parse: {
        json: false,
        yaml: false,
        text: false,
        binary: false,
        // One parser for every referenced file, with the same alias limits as the root document.
        specpage: {
          order: 1,
          canParse: true,
          allowEmpty: false,
          parse: (file: FileInfo) => {
            const data = typeof file.data === 'string' ? file.data : Buffer.from(file.data as Uint8Array).toString('utf8');
            return parseYaml(data, { maxAliasCount: 100 }) as unknown;
          },
        },
      },
      resolve: {
        file: false,
        http: false,
        specpage: {
          order: 1,
          canRead: true,
          read: async (file: FileInfo) => {
            const url = file.url.split('#')[0];
            let text: string;
            if (isSyntheticUrl(url)) {
              text = await source.read(url);
            } else if (/^https:\/\//i.test(url)) {
              if (!options.allowExternalUrls) {
                fail('SOURCE_DISABLED', `The spec references ${url}, but loading from URLs is turned off.`, 'A Confluence admin can enable URL sources in SpecPage settings.');
              }
              text = await readUrl(url);
            } else {
              return fail('BAD_REQUEST', `Unsupported reference "${file.reference ?? url}". Use relative paths or https:// URLs.`);
            }
            track(url, text);
            return text;
          },
        },
      },
    })) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AppFailure) throw err;
    const nested = findNestedFailure(err);
    if (nested) throw nested;
    const message = err instanceof Error ? err.message : String(err);
    return fail('INVALID_SPEC', 'A $ref in the spec could not be resolved.', message.slice(0, 500));
  }

  if (seen.size > 1) warnings.push(`Merged ${seen.size} files referenced with $ref.`);
  const size = JSON.stringify(bundled).length;
  if (size > MAX_SPEC_BYTES) fail('TOO_LARGE', 'The bundled spec is larger than 4.5 MB.');

  return { spec: bundled, summary: summarizeSpec(bundled, shape.value), fileCount: seen.size, warnings };
}

/** The ref parser wraps resolver errors; surface our own failure if one is inside. */
function findNestedFailure(err: unknown, depth = 0): AppFailure | undefined {
  if (!err || typeof err !== 'object' || depth > 4) return undefined;
  if (err instanceof AppFailure) return err;
  const candidate = err as { ioErrorCode?: unknown; cause?: unknown; errors?: unknown[] };
  for (const inner of [candidate.cause, ...(Array.isArray(candidate.errors) ? candidate.errors : [])]) {
    const found = findNestedFailure(inner, depth + 1);
    if (found) return found;
  }
  return undefined;
}
