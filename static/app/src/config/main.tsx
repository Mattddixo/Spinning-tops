import { permissions, view } from '@forge/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hostCovered, matchConnection, parseGitFileLink, PROVIDERS } from '../../../../src/shared/git';
import { buildSearchText, filterSpec, isAsyncApi, summarizeSpec } from '../../../../src/shared/spec';
import type {
  AppError,
  AttachmentOption,
  ConnectionOption,
  DocExpansion,
  LoadSpecResponse,
  MacroConfig,
  SourceType,
} from '../../../../src/shared/types';
import { appError } from '../../../../src/shared/messages';
import { EGRESS_GROUPS } from '../../../../src/shared/types';
import { call, invoke, RequestFailed, toAppError } from '../api';
import { mount } from '../bootstrap';
import { QualityReport } from '../components/QualityReport';
import { SpecView } from '../components/SpecView';
import { Button, ErrorMessage, Field, Loading, Message, splitList, Tabs, Toggle } from '../components/ui';
import { KIND_LABELS } from '../format';
import { AttachmentSource } from './AttachmentSource';
import { InlineSource } from './InlineSource';
import { cleanConfig, isHttpsUrl, sourceKey, validateSource } from './logic';
import { noticeText, useI18n } from '../i18n';
import { decodeSpec } from '../spec-transport';
import '../styles/config.css';


type EditorOptions = { connections: ConnectionOption[]; urlSourcesEnabled: boolean; tryItOutEnabled: boolean };

type Preview =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; data: LoadSpecResponse; spec: Record<string, unknown> };

const SOURCES: Array<{ id: SourceType; title: string; description: string }> = [
  { id: 'attachment', title: 'ui.config.sourceAttachment', description: 'ui.config.sourceAttachmentDesc' },
  { id: 'git', title: 'ui.config.sourceGit', description: 'ui.config.sourceGitDesc' },
  { id: 'url', title: 'ui.config.sourceUrl', description: 'ui.config.sourceUrlDesc' },
  { id: 'inline', title: 'ui.config.sourceInline', description: 'ui.config.sourceInlineDesc' },
];

function ConfigApp() {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState<MacroConfig | undefined>();
  const [options, setOptions] = useState<EditorOptions | undefined>();
  const [optionsError, setOptionsError] = useState<AppError | undefined>();
  const [attachments, setAttachments] = useState<AttachmentOption[] | undefined>();
  const [attachmentsError, setAttachmentsError] = useState<AppError | undefined>();
  const [approvedHosts, setApprovedHosts] = useState<string[] | undefined>();
  const [tab, setTab] = useState<'source' | 'display' | 'quality'>('source');
  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  const [gitLink, setGitLink] = useState('');
  // Set when the macro was inserted by pasting a link (macro autoconvert).
  const [autoConvertLink, setAutoConvertLink] = useState<string>();
  const [autoConverted, setAutoConverted] = useState(false);
  const [contentId, setContentId] = useState<string>();
  // Bumped when the selected attachment's content changes (same name, new version).
  const [previewNonce, setPreviewNonce] = useState(0);
  // The preview skips the cache for its first load (so editors see the latest
  // version when they open the dialog) and after an attachment changes, but
  // not on every edit: that would refetch from Git each time and could use up
  // a provider's rate limit.
  const refreshedFor = useRef<number | undefined>(undefined);
  const [gitLinkError, setGitLinkError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const previewSeq = useRef(0);
  // the preview effect only re-runs on source changes, so read config from a ref
  const configRef = useRef<MacroConfig | undefined>(undefined);
  configRef.current = config;

  const update = (patch: Partial<MacroConfig>) => setConfig((c) => ({ ...(c ?? {}), ...patch }));

  const loadAttachments = useCallback(async () => {
    setAttachmentsError(undefined);
    try {
      const list = await call(invoke('listAttachments'));
      setAttachments(list);
      return list;
    } catch (err) {
      setAttachmentsError(toAppError(err));
      setAttachments([]);
      return undefined;
    }
  }, []);

  useEffect(() => {
    view
      .getContext()
      .then((ctx) => {
        setConfig({ docExpansion: 'list', showModels: true, ...((ctx.extension?.config as MacroConfig | undefined) ?? {}) });
        const content = (ctx.extension as { content?: { id?: string | number } } | undefined)?.content;
        if (content?.id !== undefined) setContentId(String(content.id));
        const link = (ctx.extension as { autoConvertLink?: unknown } | undefined)?.autoConvertLink;
        if (typeof link === 'string') setAutoConvertLink(link);
      })
      .catch(() => setConfig({ docExpansion: 'list', showModels: true }));
    call(invoke('getEditorOptions'))
      .then(setOptions)
      .catch((err) => {
        setOptionsError(toAppError(err));
        setOptions({ connections: [], urlSourcesEnabled: false, tryItOutEnabled: false });
      });
    void loadAttachments();
    // Only the spec list: URL sources are refused for hosts approved for other purposes.
    permissions.egress
      .get({ keys: [EGRESS_GROUPS.specs] })
      .then((res) => setApprovedHosts(res.results.filter((g) => g.key === EGRESS_GROUPS.specs).flatMap((g) => g.configured.map((c) => c.domain))))
      .catch(() => setApprovedHosts(undefined));
  }, [loadAttachments]);

  const connections = options?.connections ?? [];

  // Turn the pasted link into settings once, for a macro that has none yet.
  useEffect(() => {
    if (!autoConvertLink || !options || !config || config.sourceType || autoConverted) return;
    setAutoConverted(true);
    const parsed = parseGitFileLink(autoConvertLink);
    setGitLink(autoConvertLink);
    if (!parsed) return;
    const match = matchConnection(parsed, options.connections);
    if (!match) setGitLinkError(t('ui.config.pasteLinkNoConnection', { provider: t(`ui.provider.${parsed.provider}`) }));
    update({ sourceType: 'git', gitConnectionId: match?.id, gitRepo: parsed.repo, gitRef: parsed.ref || undefined, gitPath: parsed.path || undefined });
  }, [autoConvertLink, options, config, autoConverted, t]);
  const sourceError = config ? validateSource(t, config, connections, locale) : undefined;
  const serverUrlError = config?.serverUrl?.trim() && !isHttpsUrl(config.serverUrl) ? t('ui.config.serverUrlInvalid') : undefined;
  const currentSourceKey = config ? sourceKey(config) : '';

  useEffect(() => {
    const current = configRef.current;
    if (!current || sourceError) {
      setPreview({ status: 'idle' });
      return;
    }
    const seq = ++previewSeq.current;
    setPreview({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const refresh = refreshedFor.current !== previewNonce;
        refreshedFor.current = previewNonce;
        const data = await call(invoke('loadSpec', { preview: cleanConfig(current), ...(refresh ? { refresh: true } : {}) }));
        const spec = await decodeSpec(data.specGz).catch((err: unknown) => {
          throw new RequestFailed(appError('INTERNAL', 'ui.macro.decodeFailed', undefined, { detail: err instanceof Error ? err.message : String(err) }));
        });
        if (seq === previewSeq.current) setPreview({ status: 'ready', data, spec });
      } catch (err) {
        if (seq === previewSeq.current) setPreview({ status: 'error', error: toAppError(err) });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [currentSourceKey, sourceError, previewNonce]);

  const tags = preview.status === 'ready' ? preview.data.summary.tags : [];
  // The report covers what readers will see, so tag/path filters apply.
  const qualitySpec = useMemo(() => {
    if (tab !== 'quality' || preview.status !== 'ready' || !config || isAsyncApi(preview.data.summary.kind)) return undefined;
    return filterSpec(preview.spec, config);
  }, [tab, preview, config]);
  const filteredCount = useMemo(() => {
    if (preview.status !== 'ready' || !config) return undefined;
    const filtered = filterSpec(preview.spec, config);
    return summarizeSpec(filtered, preview.data.summary.kind).operations.length;
  }, [preview, config]);

  const urlHostApproved = useMemo(() => {
    if (config?.sourceType !== 'url' || !approvedHosts) return true;
    try {
      new URL(config.url ?? '');
    } catch {
      return true; // the field shows its own "invalid URL" message
    }
    return hostCovered(config.url ?? '', approvedHosts);
  }, [config?.sourceType, config?.url, approvedHosts]);

  const applyGitLink = () => {
    const parsed = parseGitFileLink(gitLink);
    if (!parsed) {
      setGitLinkError(t('ui.config.pasteLinkInvalid'));
      return;
    }
    const match = matchConnection(parsed, connections);
    setGitLinkError(match ? undefined : t('ui.config.pasteLinkNoConnection', { provider: t(`ui.provider.${parsed.provider}`) }));
    update({
      gitConnectionId: match?.id ?? config?.gitConnectionId,
      gitRepo: parsed.repo,
      gitRef: parsed.ref || undefined,
      gitPath: parsed.path || undefined,
    });
  };

  const save = async () => {
    if (!config) return;
    if (sourceError) {
      setTab('source');
      setSaveError(sourceError);
      return;
    }
    if (serverUrlError) {
      setTab('display');
      setSaveError(serverUrlError);
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    // index the filtered spec, not the whole thing
    const searchText =
      preview.status === 'ready'
        ? buildSearchText(summarizeSpec(filterSpec(preview.spec, config), preview.data.summary.kind))
        : config.searchText;
    try {
      await view.submit({ config: cleanConfig({ ...config, searchText }) });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setSaveError([t('ui.config.saveFailed'), e.code, e.message].filter(Boolean).join(' '));
      setSaving(false);
    }
  };

  if (!config || !options) return <Loading label={t('ui.config.loadingSettings')} />;

  const selectedConnection = connections.find((c) => c.id === config.gitConnectionId);

  return (
    <div className="sp-config">
      <div className="sp-config-form">
        <Tabs
          label={t('ui.config.tabsLabel')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'source', label: t('ui.config.tabSource') },
            { id: 'display', label: t('ui.config.tabDisplay') },
            { id: 'quality', label: t('ui.quality.tab') },
          ]}
        />

        {optionsError ? <ErrorMessage error={optionsError} /> : null}
        {autoConverted && tab === 'source' ? <Message>{t('ui.config.autoConverted')}</Message> : null}

        {tab === 'source' ? (
          <div className="sp-stack">
            <div className="sp-choices" role="radiogroup" aria-label={t('ui.config.sourceGroup')}>
              {SOURCES.map((s) => {
                const disabled = s.id === 'url' && !options.urlSourcesEnabled && config.sourceType !== 'url';
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={config.sourceType === s.id}
                    className="sp-choice"
                    disabled={disabled}
                    title={disabled ? t('ui.config.urlsOffTitle') : undefined}
                    onClick={() => update({ sourceType: s.id })}
                  >
                    <span className="sp-choice-title">{t(s.title)}</span>
                    <span className="sp-small">{disabled ? t('ui.config.turnedOffByAdmin') : t(s.description)}</span>
                  </button>
                );
              })}
            </div>

            {config.sourceType === 'attachment' ? (
              <AttachmentSource
                config={config}
                update={update}
                attachments={attachments}
                attachmentsError={attachmentsError}
                reload={loadAttachments}
                contentId={contentId}
                onFileChanged={() => setPreviewNonce((n) => n + 1)}
              />
            ) : null}

            {config.sourceType === 'git' ? (
              connections.length === 0 ? (
                <Message appearance="warning" title={t('ui.config.noConnectionsTitle')}>
                  {t('ui.config.noConnectionsBody')}
                </Message>
              ) : (
                <div className="sp-stack">
                  <div className="sp-row sp-row-bottom">
                    <div className="sp-grow">
                      <Field label={t('ui.config.pasteLink')} error={gitLinkError}>
                        {(id, describedBy) => (
                          <input
                            id={id}
                            aria-describedby={describedBy}
                            className="sp-input"
                            placeholder="https://github.com/acme/api/blob/main/openapi.yaml"
                            value={gitLink}
                            onChange={(e) => setGitLink(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && applyGitLink()}
                          />
                        )}
                      </Field>
                    </div>
                    <Button onClick={applyGitLink} disabled={!gitLink.trim()}>
                      {t('ui.config.fillIn')}
                    </Button>
                  </div>
                  <Field label={t('ui.config.connection')}>
                    {(id) => (
                      <select id={id} className="sp-select" value={config.gitConnectionId ?? ''} onChange={(e) => update({ gitConnectionId: e.target.value || undefined })}>
                        <option value="">{t('ui.config.selectConnection')}</option>
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({t(`ui.provider.${c.provider}`)})
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field
                    label={t('ui.config.repository')}
                    help={selectedConnection ? t('ui.config.allowedRepos', { repos: selectedConnection.repos.join(', ') }) : undefined}
                  >
                    {(id, describedBy) => (
                      <>
                        <input
                          id={id}
                          aria-describedby={describedBy}
                          className="sp-input"
                          list={`${id}-repos`}
                          placeholder={selectedConnection ? PROVIDERS[selectedConnection.provider].repoHint : 'owner/repository'}
                          value={config.gitRepo ?? ''}
                          onChange={(e) => update({ gitRepo: e.target.value })}
                        />
                        <datalist id={`${id}-repos`}>
                          {selectedConnection?.repos.filter((r) => !r.includes('*')).map((r) => <option key={r} value={r} />)}
                        </datalist>
                      </>
                    )}
                  </Field>
                  {selectedConnection?.provider === 'swaggerhub' ? (
                    <Field label={t('ui.config.version')} help={t('ui.config.versionHelp')}>
                      {(id, describedBy) => (
                        <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="1.0.0" value={config.gitRef ?? ''} onChange={(e) => update({ gitRef: e.target.value })} />
                      )}
                    </Field>
                  ) : (
                    <>
                      <div className="sp-grid-2">
                        <Field
                          label={t('ui.config.ref')}
                          help={selectedConnection?.defaultRef ? t('ui.config.refDefault', { ref: selectedConnection.defaultRef }) : t('ui.config.refHelp')}
                        >
                          {(id, describedBy) => (
                            <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="main" value={config.gitRef ?? ''} onChange={(e) => update({ gitRef: e.target.value })} />
                          )}
                        </Field>
                        <Field label={t('ui.config.filePath')}>
                          {(id) => (
                            <input id={id} className="sp-input" placeholder="api/openapi.yaml" value={config.gitPath ?? ''} onChange={(e) => update({ gitPath: e.target.value })} />
                          )}
                        </Field>
                      </div>
                      <span className="sp-help">{t('ui.config.gitRefsHelp')}</span>
                    </>
                  )}
                </div>
              )
            ) : null}

            {config.sourceType === 'url' ? (
              <div className="sp-stack">
                <Field label={t('ui.config.specUrl')} help={t('ui.config.specUrlHelp')}>
                  {(id, describedBy) => (
                    <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="https://api.example.com/openapi.json" value={config.url ?? ''} onChange={(e) => update({ url: e.target.value })} />
                  )}
                </Field>
                {!urlHostApproved ? (
                  <Message appearance="warning" title={t('ui.config.hostNotApprovedTitle')}>
                    {t('ui.config.hostNotApprovedBody')}
                  </Message>
                ) : null}
              </div>
            ) : null}

            {config.sourceType === 'inline' ? (
              <InlineSource
                config={config}
                update={update}
                contentId={contentId}
                existing={(attachments ?? []).map((a) => a.title)}
                onConverted={loadAttachments}
              />
            ) : null}
          </div>
        ) : tab === 'quality' ? (
          preview.status !== 'ready' ? (
            <Message>{t('ui.quality.waiting')}</Message>
          ) : isAsyncApi(preview.data.summary.kind) ? (
            <Message>{t('ui.quality.notAvailable')}</Message>
          ) : (
            <QualityReport spec={qualitySpec ?? preview.spec} kind={preview.data.summary.kind} />
          )
        ) : (
          <div className="sp-stack">
            <Field label={t('ui.config.title')} help={t('ui.config.titleHelp')}>
              {(id, describedBy) => (
                <input id={id} aria-describedby={describedBy} className="sp-input" value={config.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
              )}
            </Field>

            <fieldset className="sp-fieldset">
              <legend className="sp-label">{t('ui.config.tagsLegend')}</legend>
              {tags.length ? (
                <div className="sp-tag-list">
                  {tags.map((tag) => (
                    <label key={tag} className="sp-checkbox">
                      <input
                        type="checkbox"
                        checked={config.includeTags?.includes(tag) ?? false}
                        onChange={(e) =>
                          update({
                            includeTags: e.target.checked ? [...(config.includeTags ?? []), tag] : (config.includeTags ?? []).filter((x) => x !== tag),
                          })
                        }
                      />
                      <span>{tag}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <span className="sp-help">{t('ui.config.tagsEmpty')}</span>
              )}
            </fieldset>

            <Field label={t('ui.config.paths')} help={t('ui.config.pathsHelp')}>
              {(id, describedBy) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  className="sp-input sp-input-short"
                  rows={3}
                  value={(config.includePaths ?? []).join('\n')}
                  onChange={(e) => update({ includePaths: splitList(e.target.value) })}
                />
              )}
            </Field>

            {filteredCount !== undefined && preview.status === 'ready' ? (
              <span className="sp-help">{t('ui.config.showingCount', { shown: filteredCount, total: preview.data.summary.operations.length })}</span>
            ) : null}

            <div className="sp-grid-2">
              <Field label={t('ui.config.expand')}>
                {(id) => (
                  <select id={id} className="sp-select" value={config.docExpansion ?? 'list'} onChange={(e) => update({ docExpansion: e.target.value as DocExpansion })}>
                    <option value="list">{t('ui.config.expandList')}</option>
                    <option value="full">{t('ui.config.expandFull')}</option>
                    <option value="none">{t('ui.config.expandNone')}</option>
                  </select>
                )}
              </Field>
              <Field label={t('ui.config.maxHeight')}>
                {(id) => (
                  <select id={id} className="sp-select" value={String(config.maxHeight ?? 0)} onChange={(e) => update({ maxHeight: Number(e.target.value) })}>
                    <option value="0">{t('ui.config.maxHeightAuto')}</option>
                    {[400, 600, 800, 1200].map((px) => (
                      <option key={px} value={String(px)}>
                        {t('ui.config.maxHeightPx', { px })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            <Toggle label={t('ui.config.showInfo')} checked={config.showInfo !== false} onChange={(v) => update({ showInfo: v })} />
            <Toggle label={t('ui.config.showServers')} checked={config.showServers !== false} onChange={(v) => update({ showServers: v })} />
            <Toggle label={t('ui.config.showModels')} checked={config.showModels !== false} onChange={(v) => update({ showModels: v })} />
            <Toggle label={t('ui.config.showFilter')} checked={config.showFilter === true} onChange={(v) => update({ showFilter: v })} />
            <Toggle label={t('ui.config.showCodeSamples')} checked={config.showCodeSamples !== false} onChange={(v) => update({ showCodeSamples: v })} help={t('ui.config.showCodeSamplesHelp')} />
            <Toggle label={t('ui.config.hideDeprecated')} checked={config.hideDeprecated === true} onChange={(v) => update({ hideDeprecated: v })} />
            <Toggle
              label={t('ui.config.tryItOut')}
              checked={config.tryItOut === true}
              disabled={!options.tryItOutEnabled}
              onChange={(v) => update({ tryItOut: v })}
              help={options.tryItOutEnabled ? t('ui.config.tryItOutHelp') : t('ui.config.tryItOutOff')}
            />
            {config.tryItOut === true || config.serverUrl ? (
              <Field label={t('ui.config.serverUrl')} help={t('ui.config.serverUrlHelp')} error={serverUrlError}>
                {(id, describedBy) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={serverUrlError ? true : undefined}
                    className="sp-input"
                    placeholder="https://staging.api.example.com/v1"
                    value={config.serverUrl ?? ''}
                    onChange={(e) => update({ serverUrl: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </div>
        )}

        <div className="sp-config-footer">
          {saveError ? <span className="sp-error-text">{saveError}</span> : null}
          <div className="sp-spacer" />
          <Button appearance="subtle" onClick={() => void view.close()}>
            {t('ui.common.cancel')}
          </Button>
          <Button appearance="primary" onClick={() => void save()} disabled={saving}>
            {saving ? t('ui.common.saving') : t('ui.common.save')}
          </Button>
        </div>
      </div>

      <section className="sp-config-preview" aria-label={t('ui.config.preview')}>
        <div className="sp-row">
          <h2>{t('ui.config.preview')}</h2>
          {preview.status === 'ready' ? (
            <>
              <span className="sp-lozenge">{KIND_LABELS[preview.data.summary.kind]}</span>
              <span className="sp-small">{config.sourceType === 'inline' ? t('ui.macro.pastedSpec') : preview.data.meta.sourceLabel}</span>
            </>
          ) : null}
        </div>
        {preview.status === 'idle' ? <Message>{sourceError ?? t('ui.config.previewChooseSource')}</Message> : null}
        {preview.status === 'loading' ? <Loading label={t('ui.config.previewLoading')} /> : null}
        {preview.status === 'error' ? <ErrorMessage error={preview.error} /> : null}
        {preview.status === 'ready' ? (
          <>
            {preview.data.meta.warnings
              // Worked out here rather than trusted from the backend: the editor
              // may have toggled Try it out or typed a server URL since it loaded.
              .filter((w) => w.key !== 'warnings.relativeServers')
              .map((w) => (
                <Message key={w.key}>{noticeText(t, w)}</Message>
              ))}
            {!preview.data.meta.serversResolvable && config.tryItOut === true && !config.serverUrl?.trim() ? (
              <Message appearance="warning">{t('warnings.relativeServers')}</Message>
            ) : null}
            <SpecView kind={preview.data.summary.kind} spec={preview.spec} config={config} tryItOutAllowed={options.tryItOutEnabled && config.tryItOut === true} preview={cleanConfig(config)} />
          </>
        ) : null}
      </section>
    </div>
  );
}

void mount(<ConfigApp />);
