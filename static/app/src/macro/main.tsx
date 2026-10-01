import { router, view } from '@forge/bridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppError, LoadSpecResponse, MacroConfig } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { ApiDocs } from '../components/ApiDocs';
import { Button, ErrorMessage, Loading } from '../components/ui';
import { downloadJson, KIND_LABELS, relativeTime, slugify } from '../format';
import '../styles/macro.css';

type State = { status: 'loading' } | { status: 'error'; error: AppError } | { status: 'ready'; data: LoadSpecResponse };

function MacroApp() {
  const [config, setConfig] = useState<MacroConfig>({});
  const [isEditing, setIsEditing] = useState(false);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const readySent = useRef(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const data = await call(invoke('loadSpec', refresh ? { refresh: true } : {}));
      setState({ status: 'ready', data });
    } catch (err) {
      setState({ status: 'error', error: toAppError(err) });
    }
  }, []);

  useEffect(() => {
    view
      .getContext()
      .then((ctx) => {
        // display only; the backend uses its own copy of the config
        setConfig((ctx.extension?.config as MacroConfig | undefined) ?? {});
        setIsEditing(ctx.extension?.isEditing === true);
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

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  if (state.status === 'loading') return <Loading label="Loading API documentation…" />;

  if (state.status === 'error') {
    const error =
      state.error.code === 'NOT_CONFIGURED' && !isEditing
        ? { ...state.error, detail: state.error.detail ?? 'Edit the page, select this macro and choose Edit to pick an API spec.' }
        : state.error;
    return (
      <div className="sp-macro">
        <ErrorMessage
          error={error}
          actions={
            error.code !== 'NOT_CONFIGURED' && error.code !== 'LICENSE_INACTIVE' ? (
              <Button compact onClick={onRefresh} disabled={refreshing}>
                {refreshing ? 'Retrying…' : 'Try again'}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const { data } = state;
  const effective: MacroConfig = { ...config };
  const title = config.title?.trim() || data.summary.title;
  const maxHeight = Number(config.maxHeight) > 0 ? Number(config.maxHeight) : undefined;

  return (
    <div className="sp-macro">
      <div className="sp-macro-bar">
        <div className="sp-macro-heading">
          <h2 className="sp-macro-title">{title}</h2>
          {data.summary.version ? <span className="sp-lozenge">v{data.summary.version}</span> : null}
          <span className="sp-lozenge">{KIND_LABELS[data.summary.kind]}</span>
        </div>
        <div className="sp-row">
          <Button compact appearance="subtle" onClick={onRefresh} disabled={refreshing} title="Reload the spec from its source">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            compact
            appearance="subtle"
            onClick={() => downloadJson(`${slugify(data.summary.title)}.openapi.json`, data.spec)}
            title="Download the bundled spec as JSON"
          >
            Download
          </Button>
          <Button
            compact
            appearance="subtle"
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}
            title="Show the documentation full screen"
          >
            Full screen
          </Button>
        </div>
      </div>
      <p className="sp-small sp-macro-source">
        {data.meta.sourceLink ? (
          <button type="button" className="sp-link-button" onClick={() => router.open(data.meta.sourceLink as string)}>
            {data.meta.sourceLabel}
          </button>
        ) : (
          data.meta.sourceLabel
        )}
        {' · '}
        {data.meta.fromCache ? `cached ${relativeTime(data.meta.fetchedAt)}` : `loaded ${relativeTime(data.meta.fetchedAt)}`}
        {data.meta.fileCount > 1 ? ` · ${data.meta.fileCount} files` : ''}
        {' · '}
        {data.summary.operations.length} operations
      </p>
      <div className={maxHeight ? 'sp-macro-scroll' : undefined} style={maxHeight ? { maxHeight } : undefined}>
        <ApiDocs spec={data.spec} config={effective} tryItOutAllowed={data.tryItOutAllowed} />
      </div>
    </div>
  );
}

void mount(<MacroApp />);
