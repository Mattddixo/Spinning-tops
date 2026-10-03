import { describe, expect, it, vi } from 'vitest';
import type { CompareResponse } from '../../../src/shared/types';
import { changesMarkdown } from '../src/components/ChangesPanel';
import { t } from './helpers/i18n';

vi.mock('@forge/bridge', () => ({ makeInvoke: () => vi.fn() }));

const result = (over: Partial<CompareResponse> = {}): CompareResponse => ({
  baseLabel: 'main',
  baseVersion: '1.0',
  headLabel: 'feature',
  headVersion: '',
  changes: [],
  counts: { breaking: 0, warning: 0, info: 0 },
  truncated: false,
  ...over,
});

describe('changesMarkdown', () => {
  it('groups changes by level, breaking first', () => {
    const md = changesMarkdown(
      t,
      result({
        changes: [
          { level: 'info', code: 'operationAdded', operation: 'GET /new' },
          { level: 'breaking', code: 'operationRemoved', operation: 'GET /old' },
          { level: 'warning', code: 'typeChanged', operation: 'POST /pets', section: 'requestBody', location: 'tags[]', params: { from: 'string', to: 'integer' } },
        ],
      }),
    );
    expect(md).toBe(
      [
        '# API changes: main (v1.0) → feature',
        '',
        '## Breaking (1)',
        '',
        '- `GET /old` Operation removed',
        '',
        `## ${t('ui.changes.warning')} (1)`,
        '',
        '- `POST /pets` Type changed from string to integer: `request body · tags[]`',
        '',
        `## ${t('ui.changes.info')} (1)`,
        '',
        `- \`GET /new\` ${t('changes.operationAdded')}`,
        '',
      ].join('\n'),
    );
  });

  it('escapes spec text so it cannot add formatting or break out of code spans', () => {
    const md = changesMarkdown(
      t,
      result({
        baseLabel: 'v1_*beta*',
        changes: [{ level: 'warning', code: 'typeChanged', operation: 'GET /`x`', section: 'response', status: '200', location: 'a`b', params: { from: '<b>', to: '[x](y)' } }],
      }),
    );
    expect(md).toContain('# API changes: v1\\_\\*beta\\* (v1.0) → feature');
    expect(md).toContain("- `GET /'x'` Type changed from \\<b\\> to \\[x\\](y): `response 200 · a'b`");
  });

  it('says when there is nothing to report and when the list was cut short', () => {
    expect(changesMarkdown(t, result())).toContain(`\n${t('ui.changes.none')}\n`);
    expect(changesMarkdown(t, result({ truncated: true })).trimEnd().endsWith(`_${t('ui.changes.truncated')}_`)).toBe(true);
  });
});
