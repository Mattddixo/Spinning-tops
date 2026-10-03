import { router, view } from '@forge/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appError } from '../../../../src/shared/messages';
import { buildSearchText, filterSpec, summarizeSpec } from '../../../../src/shared/spec';
import type { AppError, LoadSpecResponse, MacroConfig } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { ChangesPanel } from '../components/ChangesPanel';
import { SpecView } from '../components/SpecView';
import { Button, ErrorMessage, Loading, Message } from '../components/ui';
import { downloadJson, KIND_LABELS, relativeTime, slugify, withoutParserExtensions } from '../format';
import { isAsyncApi } from '../../../../src/shared/spec';
import { noticeText, useI18n } from '../i18n';
import { decodeSpec } from '../spec-transport';
import '../styles/macro.css';

type Ready = { data: LoadSpecResponse; spec: Record<string, unknown> };
type State = { status: 'loading' } | { status: 'error'; error: AppError } | ({ status: 'ready' } & Ready);

async function fetchSpec(refresh: boolean): Promise<Ready> {
  const data = await call(invoke('loadSpec', refresh ? { refresh: true } : {}));
  let spec: Record<string, unknown>;
  try {
    spec = await decodeSpec(data.specGz);
  } catch (err) {
    throw appError('INTERNAL', 'ui.macro.decodeFailed', undefined, { detail: err instanceof Error ? err.message : String(err) });
  }
  return { data, spec };
}

function MacroApp() {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState<MacroConfig>({});
  const [isEditing, setIsEditing] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const readySent = useRef(false);

  const load = useCallback(async (refresh = false) => {
    try {
      setState({ status: 'ready', ...(await fetchSpec(refresh)) });
    } catch (err) {
      setState({ status: 'error', error: err && typeof err === 'object' && 'code' in err ? (err as AppError) : toAppError(err) });
    }
  }, []);

  useEffect(() => {
    view
      .getContext()
      .then((ctx) => {
        // display only; the backend uses its own copy of the config
        setConfig((ctx.extension?.config as MacroConfig | undefined) ?? {});
        setIsEditing(ctx.extension?.isEditing === true);
        // Only hides the Changes button; the backend makes the real licence check.
        setSignedIn(Boolean(ctx.accountId));
      })
      .catch(() => undefined);
    void load();
  }, [load]);

  useEffect(() => {
    if (state.status !== 'loading' && !readySent.current) {
      readySent.current = true;
      // let Confluence know we're done rendering
      view.emitReadyEvent().catch(() => undefined);
    }
  }, [state.status]);

  // Confluence indexes the searchText saved with the macro. It's only rebuilt
  // when the macro is saved, so tell editors when the spec has moved on.
  const searchStale = useMemo(() => {
    if (state.status !== 'ready' || !isEditing || !config.sourceType) return false;
    const filtered = filterSpec(state.spec, config);
    const current = buildSearchText(summarizeSpec(filtered, state.data.summary.kind));
    return current !== (config.searchText ?? '');
  }, [state, isEditing, config]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  if (state.status === 'loading') return <Loading label={t('ui.macro.loading')} />;

  if (state.status === 'error') {
    const { error } = state;
    return (
      <div className="sp-macro">
        <ErrorMessage
          error={error}
          actions={
            error.code !== 'NOT_CONFIGURED' && error.code !== 'LICENSE_INACTIVE' ? (
              <Button compact onClick={onRefresh} disabled={refreshing}>
                {refreshing ? t('ui.common.retrying') : t('ui.common.retry')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const { data, spec } = state;
  // Readers only need warnings that change what they can do; the rest
  // (merged files, resolved servers) is for whoever maintains the macro.
  const warnings = data.meta.warnings.filter((w) => isEditing || w.key === 'warnings.relativeServers');
  const sourceLabel = config.sourceType === 'inline' ? t('ui.macro.pastedSpec') : data.meta.sourceLabel;
  const title = config.title?.trim() || data.summary.title;
  const maxHeight = Number(config.maxHeight) > 0 ? Number(config.maxHeight) : undefined;
  const when = relativeTime(t, data.meta.fetchedAt, locale);
  const compareSource = config.sourceType === 'git' || config.sourceType === 'attachment' ? config.sourceType : undefined;
  const canCompare = Boolean(compareSource) && signedIn && !isAsyncApi(data.summary.kind) && !data.meta.autoConverted;
  const sourceDetails = [
    data.meta.fromCache ? t('ui.macro.cached', { when }) : t('ui.macro.loaded', { when }),
    data.meta.fileCount > 1 ? t('ui.macro.files', { count: data.meta.fileCount }) : '',
    data.summary.operations.length === 1 ? t('ui.macro.operationsOne') : t('ui.macro.operations', { count: data.summary.operations.length }),
  ].filter(Boolean);

  return (
    <div className="sp-macro">
      <div className="sp-macro-bar">
        <div className="sp-macro-heading">
          <h2 className="sp-macro-title">{title}</h2>
          {data.summary.version ? <span className="sp-lozenge">v{data.summary.version}</span> : null}
          <span className="sp-lozenge">{KIND_LABELS[data.summary.kind]}</span>
        </div>
        <div className="sp-row">
          <Button compact appearance="subtle" onClick={onRefresh} disabled={refreshing} title={t('ui.macro.refreshTitle')}>
            {refreshing ? t('ui.macro.refreshing') : t('ui.macro.refresh')}
          </Button>
          {canCompare ? (
            <Button compact appearance="subtle" onClick={() => setShowChanges((v) => !v)} aria-expanded={showChanges} title={t('ui.changes.buttonTitle')}>
              {t('ui.changes.button')}
            </Button>
          ) : null}
          <Button
            compact
            appearance="subtle"
            onClick={() =>
              isAsyncApi(data.summary.kind)
                ? downloadJson(`${slugify(data.summary.title)}.asyncapi.json`, withoutParserExtensions(spec))
                : downloadJson(`${slugify(data.summary.title)}.openapi.json`, spec)
            }
            title={t('ui.macro.downloadTitle')}
          >
            {t('ui.macro.download')}
          </Button>
          <Button
            compact
            appearance="subtle"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}
            title={t('ui.macro.fullscreenTitle')}
          >
            {t('ui.macro.fullscreen')}
          </Button>
        </div>
      </div>
      <p className="sp-small sp-macro-source">
        {data.meta.sourceLink ? (
          <button type="button" className="sp-link-button" onClick={() => router.open(data.meta.sourceLink as string)}>
            {sourceLabel}
          </button>
        ) : (
          sourceLabel
        )}
        {' · '}
        {sourceDetails.join(' · ')}
      </p>
      {isEditing && data.meta.autoConverted ? <Message appearance="info">{t('ui.macro.autoConverted')}</Message> : null}
      {searchStale && !data.meta.autoConverted ? <Message appearance="info">{t('ui.macro.staleSearch')}</Message> : null}
      {warnings.length ? (
        <Message appearance="warning">
          {warnings.map((w) => (
            <span key={w.key}>{noticeText(t, w)}</span>
          ))}
        </Message>
      ) : null}
      {canCompare && showChanges && compareSource ? <ChangesPanel sourceType={compareSource} onClose={() => setShowChanges(false)} /> : null}
      <div className={maxHeight ? 'sp-macro-scroll' : undefined} style={maxHeight ? { maxHeight } : undefined}>
        <SpecView kind={data.summary.kind} spec={spec} config={config} tryItOutAllowed={data.tryItOutAllowed} />
      </div>
    </div>
  );
}

void mount(<MacroApp />);
