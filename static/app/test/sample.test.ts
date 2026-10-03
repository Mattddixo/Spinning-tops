import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { assessQuality } from '../../../src/shared/quality';
import { summarizeSpec } from '../../../src/shared/spec';
import { MAX_INLINE, validateSource } from '../src/config/logic';
import { SAMPLE_SPEC } from '../src/config/sample';
import { t } from './helpers/i18n';

describe('sample spec', () => {
  const spec = parse(SAMPLE_SPEC) as Record<string, unknown>;

  it('is a valid pasted spec', () => {
    expect(SAMPLE_SPEC.length).toBeLessThan(MAX_INLINE);
    expect(validateSource(t, { sourceType: 'inline', inlineSpec: SAMPLE_SPEC }, [], 'en-US')).toBeUndefined();
  });

  it('shows off tags and operations', () => {
    const summary = summarizeSpec(spec, 'openapi-3.0');
    expect(summary.tags).toEqual(['pets', 'orders']);
    expect(summary.operations).toHaveLength(5);
  });

  it('scores full marks on the Quality tab', () => {
    const report = assessQuality(spec, 'openapi-3.0');
    expect(report.checks.filter((c) => c.failed > 0).map((c) => c.id)).toEqual([]);
    expect(report.duplicateOperationIds).toEqual([]);
    expect(report.score).toBe(100);
  });
});
