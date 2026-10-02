import { applyServerOverride, filterSpec, summarizeSpec } from '../shared/spec';
import type { MacroConfig, SpecSummary } from '../shared/types';
import { readContext } from './context';
import { AppFailure } from './errors';
import { decodeSpec } from './encoding';
import { loadSpec } from './loadSpec';

// PDF/Word export can't run Swagger UI, so export a plain endpoint table (ADF).

type AdfNode = Record<string, unknown>;

const MAX_ROWS = 400;

const text = (value: string, marks?: AdfNode[]): AdfNode => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });
const heading = (level: number, value: string): AdfNode => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const cell = (type: 'tableHeader' | 'tableCell', content: AdfNode[]): AdfNode => ({ type, attrs: {}, content: [paragraph(...content)] });

function panel(panelType: 'info' | 'warning' | 'error', message: string): AdfNode {
  return { type: 'panel', attrs: { panelType }, content: [paragraph(text(message))] };
}

const doc = (content: AdfNode[]): AdfNode => ({ type: 'doc', version: 1, content });

export function buildExportAdf(summary: SpecSummary, config: MacroConfig, sourceLink?: string): AdfNode {
  const content: AdfNode[] = [heading(2, config.title?.trim() || `${summary.title}${summary.version ? ` (${summary.version})` : ''}`)];

  if (summary.description) {
    const firstParagraph = summary.description.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (firstParagraph) content.push(paragraph(text(firstParagraph)));
  }
  if (summary.servers.length) {
    content.push(paragraph(text('Servers: ', [{ type: 'strong' }]), text(summary.servers.join(', '), [{ type: 'code' }])));
  }

  const ops = summary.operations.slice(0, MAX_ROWS);
  if (ops.length) {
    const rows: AdfNode[] = [
      { type: 'tableRow', content: [cell('tableHeader', [text('Method')]), cell('tableHeader', [text('Path')]), cell('tableHeader', [text('Summary')])] },
      ...ops.map((op) => ({
        type: 'tableRow',
        content: [
          cell('tableCell', [text(op.method, [{ type: 'strong' }])]),
          cell('tableCell', [text(op.path, [{ type: 'code' }])]),
          cell('tableCell', [text(`${op.deprecated ? '[Deprecated] ' : ''}${op.summary ?? op.operationId ?? ''}` || ' ')]),
        ],
      })),
    ];
    content.push({ type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: rows });
  } else {
    content.push(paragraph(text('This API document has no operations.')));
  }
  if (summary.operations.length > MAX_ROWS) {
    content.push(panel('info', `Showing the first ${MAX_ROWS} of ${summary.operations.length} operations.`));
  }
  const footer = sourceLink
    ? paragraph(text('Interactive documentation is available on the Confluence page. Source: '), text(sourceLink, [{ type: 'link', attrs: { href: sourceLink } }]))
    : paragraph(text('Interactive documentation is available on the Confluence page.'));
  content.push(footer);
  return doc(content);
}

export async function exportMacro(payload: { config?: MacroConfig; exportType?: string; context?: unknown }): Promise<AdfNode> {
  const config = payload.config ?? {};
  try {
    // no user during export, so read as the app
    const raw = (payload.context ?? {}) as Record<string, unknown> & { extension?: Record<string, unknown> };
    const ctx = readContext({ ...raw, accountId: undefined, accountType: 'anonymous', extension: { ...raw.extension, config } });
    const loaded = await loadSpec(ctx, config);
    const spec = applyServerOverride(decodeSpec(loaded.specGz), loaded.summary.kind, config.serverUrl);
    const filtered = filterSpec(spec, config);
    return buildExportAdf(summarizeSpec(filtered, loaded.summary.kind), config, loaded.meta.sourceLink);
  } catch (err) {
    // Don't return null here, it can break the whole page's PDF export.
    const message = err instanceof AppFailure ? err.message : 'The API documentation could not be loaded for export.';
    return doc([panel('warning', `API documentation: ${message}`)]);
  }
}
