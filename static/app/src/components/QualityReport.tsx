import { useMemo } from 'react';
import { assessQuality } from '../../../../src/shared/quality';
import type { SpecKind } from '../../../../src/shared/types';
import { useT } from '../i18n';
import { Message } from './ui';

export function QualityReport({ spec, kind }: { spec: Record<string, unknown>; kind: SpecKind }) {
  const t = useT();
  const report = useMemo(() => assessQuality(spec, kind), [spec, kind]);
  // Failing checks first, important ones before suggestions; then the rest.
  const checks = report.checks
    .filter((c) => c.total > 0)
    .sort((a, b) => Number(b.failed > 0) - Number(a.failed > 0) || Number(b.important) - Number(a.important));

  return (
    <div className="sp-stack sp-quality">
      <p className="sp-help">{t('ui.quality.intro')}</p>
      <div className="sp-row">
        <strong>{t('ui.quality.score', { score: report.score })}</strong>
        <meter className="sp-quality-meter" min={0} max={100} low={60} high={85} optimum={100} value={report.score} aria-hidden="true" />
      </div>
      {report.duplicateOperationIds.length ? (
        <Message appearance="warning">{t('ui.quality.duplicateIds', { ids: report.duplicateOperationIds.join(', ') })}</Message>
      ) : null}
      {checks.every((c) => !c.failed) ? <Message appearance="success">{t('ui.quality.allGood')}</Message> : null}
      <ul className="sp-quality-list">
        {checks.map((c) => (
          <li key={c.id} className={`sp-quality-item ${c.failed ? 'sp-quality-failed' : 'sp-quality-passed'}`}>
            <div className="sp-row">
              <span aria-hidden="true">{c.failed ? '!' : '✓'}</span>
              <strong>{t(`quality.${c.id}.title`)}</strong>
              <span className="sp-small">{t('ui.quality.passed', { passed: c.passed, total: c.total })}</span>
              {c.important && c.failed ? <span className="sp-lozenge sp-lozenge-warning">{t('ui.quality.important')}</span> : null}
            </div>
            {c.failed ? (
              <>
                <span className="sp-help">{t(`quality.${c.id}.help`)}</span>
                {c.examples.length && c.total > 1 ? (
                  <span className="sp-small sp-quality-examples">
                    {c.examples.map((e) => (
                      <code key={e}>{e}</code>
                    ))}
                    {c.more ? <span>{t('ui.quality.more', { count: c.more })}</span> : null}
                  </span>
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
