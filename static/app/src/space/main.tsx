import { router, view } from '@forge/bridge';
import { useEffect, useMemo, useState } from 'react';
import type { ApiListItem, AppError } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { ErrorMessage, Loading, Message } from '../components/ui';
import { KIND_LABELS, relativeTime } from '../format';
import { useI18n } from '../i18n';
import '../styles/space.css';

type State = { status: 'loading' } | { status: 'error'; error: AppError } | { status: 'ready'; apis: ApiListItem[]; truncated: boolean; site: boolean };

const SITE_MODULE_KEY = 'specpage-api-catalog';

const SOURCE_KEYS: Record<ApiListItem['sourceType'], string> = {
  attachment: 'ui.config.sourceAttachment',
  git: 'ui.config.sourceGit',
  url: 'ui.config.sourceUrl',
  inline: 'ui.config.sourceInline',
};

// viewpage.action works for pages and blog posts alike.
const pageUrl = (contentId: string) => `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(contentId)}`;

function matches(api: ApiListItem, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [api.title, api.pageTitle, api.sourceLabel, api.version, api.spaceKey].some((v) => v?.toLowerCase().includes(q));
}

function SpaceApis() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');

  useEffect(() => {
    // One UI for both the space page and the site-wide catalog (Apps menu).
    const load = async () => {
      const ctx = await view.getContext().catch(() => undefined);
      const site = ctx?.moduleKey === SITE_MODULE_KEY || ctx?.extension?.type === 'confluence:globalPage';
      if (site) {
        const { apis, truncated } = await call(invoke('listSiteApis'));
        return { apis, truncated, site };
      }
      const { apis } = await call(invoke('listSpaceApis'));
      return { apis, truncated: false, site };
    };
    load()
      .then((result) => setState({ status: 'ready', ...result }))
      .catch((err) => setState({ status: 'error', error: toAppError(err) }));
  }, []);

  const shown = useMemo(() => (state.status === 'ready' ? state.apis.filter((a) => matches(a, query.trim())) : []), [state, query]);

  if (state.status === 'loading') return <Loading label={t('ui.space.loading')} />;
  if (state.status === 'error') {
    return (
      <main className="sp-space">
        <ErrorMessage error={state.error} />
      </main>
    );
  }

  return (
    <main className="sp-space sp-stack">
      <header className="sp-stack-tight">
        <h1>{state.site ? t('ui.space.siteTitle') : t('ui.space.title')}</h1>
        <p className="sp-muted">{state.site ? t('ui.space.siteIntro') : t('ui.space.intro')}</p>
      </header>
      {state.truncated ? <Message appearance="warning">{t('ui.space.truncated')}</Message> : null}
      {state.apis.length === 0 ? (
        <p className="sp-help">{state.site ? t('ui.space.siteEmpty') : t('ui.space.empty')}</p>
      ) : (
        <>
          <input
            className="sp-input sp-space-search"
            type="search"
            aria-label={t('ui.space.search')}
            placeholder={t('ui.space.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="sp-small" role="status">
            {t('ui.space.count', { shown: shown.length, total: state.apis.length })}
          </p>
          <table className="sp-table">
            <thead>
              <tr>
                <th scope="col">{t('ui.space.colApi')}</th>
                <th scope="col">{t('ui.space.colType')}</th>
                <th scope="col">{t('ui.space.colOperations')}</th>
                {state.site ? <th scope="col">{t('ui.space.colSpace')}</th> : null}
                <th scope="col">{t('ui.space.colPage')}</th>
                <th scope="col">{t('ui.space.colSource')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((api) => (
                <tr key={`${api.contentId}:${api.localId}`}>
                  <td>
                    <button type="button" className="sp-link-button" onClick={() => void router.navigate(pageUrl(api.contentId))}>
                      <strong>{api.title}</strong>
                    </button>
                    {api.version ? <span className="sp-lozenge sp-space-version">v{api.version}</span> : null}
                  </td>
                  <td>{KIND_LABELS[api.kind] ?? api.kind}</td>
                  <td>{api.operationCount}</td>
                  {state.site ? <td>{api.spaceKey ?? '–'}</td> : null}
                  <td>{api.pageTitle}</td>
                  <td>
                    <div>{t(SOURCE_KEYS[api.sourceType])}</div>
                    {api.sourceLabel ? <div className="sp-small sp-space-source">{api.sourceLabel}</div> : null}
                    <div className="sp-small">{t('ui.space.seen', { when: relativeTime(t, api.updatedAt, locale) })}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

void mount(<SpaceApis />);
