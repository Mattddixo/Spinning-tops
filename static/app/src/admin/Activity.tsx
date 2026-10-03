import { useEffect, useState } from 'react';
import type { AppError, AuditEntryView } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { ErrorMessage, Loading } from '../components/ui';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import { describeAudit } from './logic';

export function Activity({ refreshKey }: { refreshKey: number }) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<AuditEntryView[]>();
  const [error, setError] = useState<AppError>();

  useEffect(() => {
    let cancelled = false;
    call(invoke('adminGetAudit'))
      .then((list) => {
        if (!cancelled) {
          setEntries(list);
          setError(undefined);
        }
      })
      .catch((err) => !cancelled && setError(toAppError(err)));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className="sp-card sp-stack" aria-labelledby="activity-heading">
      <div className="sp-row">
        <h2 id="activity-heading">{t('ui.admin.activity')}</h2>
      </div>
      <p className="sp-muted">{t('ui.admin.activityIntro')}</p>
      {error ? <ErrorMessage error={{ ...error, key: 'ui.admin.activityLoadFailed', message: t('ui.admin.activityLoadFailed') }} /> : null}
      {!entries && !error ? <Loading /> : null}
      {entries && !entries.length ? <span className="sp-help">{t('ui.admin.activityNone')}</span> : null}
      {entries?.length ? (
        <div className="sp-table-scroll">
          <table className="sp-table">
            <thead>
              <tr>
                <th scope="col">{t('ui.admin.colWhen')}</th>
                <th scope="col">{t('ui.admin.colWho')}</th>
                <th scope="col">{t('ui.admin.colWhat')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="sp-nowrap">
                    <time dateTime={e.at}>{formatDate(e.at, locale, true)}</time>
                  </td>
                  <td>{e.displayName ?? e.accountId}</td>
                  <td>{describeAudit(t, e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
