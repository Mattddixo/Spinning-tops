import { permissions, view } from '@forge/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isValidRef, isValidRepo, matchConnection, normaliseRepoPath, parseGitFileLink, PROVIDERS, usesFilePath } from '../../../../src/shared/git';
import { buildSearchText, filterSpec, summarizeSpec } from '../../../../src/shared/spec';
import type { Translate } from '../../../../src/shared/i18n';
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
import { call, invoke, RequestFailed, toAppError } from '../api';
import { mount } from '../bootstrap';
import { SpecView } from '../components/SpecView';
import { Button, ErrorMessage, Field, Loading, Message, splitList, Tabs, Toggle } from '../components/ui';
import { KIND_LABELS, toLanguageTag } from '../format';
import { AttachmentSource } from './AttachmentSource';
import { InlineSource, MAX_INLINE } from './InlineSource';
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

const isHttpsUrl = (value: string | undefined) => /^https:\/\/[^\s/?#]+\S*$/i.test(value?.trim() ?? '');


// Forge rejects null in macro config, so drop empty values.
function cleanConfig(config: MacroConfig): MacroConfig {
  const out: Record<string, unknown> = {};
  const keep = (key: keyof MacroConfig, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = value;
  };
  keep('sourceType', config.sourceType);
  switch (config.sourceType) {
    case 'attachment':
      keep('attachment', config.attachment);
      break;
    case 'git':
      keep('gitConnectionId', config.gitConnectionId);
      keep('gitRepo', config.gitRepo?.trim());
      keep('gitRef', config.gitRef?.trim());
      keep('gitPath', config.gitPath?.trim());
      break;
    case 'url':
      keep('url', config.url?.trim());
      break;
    case 'inline':
      keep('inlineSpec', config.inlineSpec);
      break;
  }
  keep('title', config.title?.trim());
  keep('serverUrl', config.serverUrl?.trim());
  keep('includeTags', config.includeTags);
  keep('includePaths', config.includePaths);
  for (const key of ['hideDeprecated', 'showModels', 'showInfo', 'showServers', 'showFilter', 'tryItOut'] as const) {
    if (typeof config[key] === 'boolean') out[key] = config[key];
  }
  keep('docExpansion', config.docExpansion);
  if (typeof config.maxHeight === 'number' && config.maxHeight > 0) out.maxHeight = config.maxHeight;
  keep('searchText', config.searchText);
  return out as MacroConfig;
}

function validateSource(t: Translate, config: MacroConfig, connections: ConnectionOption[], locale: string): string | undefined {
  switch (config.sourceType) {
    case undefined:
      return t('ui.config.validate.noSource');
    case 'attachment':
      return config.attachment ? undefined : t('ui.config.validate.noAttachment');
    case 'git': {
      const connection = connections.find((c) => c.id === config.gitConnectionId);
      if (!connection) return t('ui.config.validate.noConnection');
      if (!config.gitRepo || !isValidRepo(connection.provider, config.gitRepo.trim())) {
        return t('ui.config.validate.badRepo', { hint: PROVIDERS[connection.provider].repoHint });
      }
      if (config.gitRef && !isValidRef(config.gitRef.trim())) return t('ui.config.validate.badRef');
      if (usesFilePath(connection.provider) && (!config.gitPath || !normaliseRepoPath(config.gitPath))) return t('ui.config.validate.badPath');
      return undefined;
    }
    case 'url':
      return isHttpsUrl(config.url) ? undefined : t('ui.config.validate.badUrl');
    case 'inline':
      if (!config.inlineSpec?.trim()) return t('ui.config.validate.noInline');
      return config.inlineSpec.length > MAX_INLINE
        ? t('ui.config.validate.inlineTooLong', { max: MAX_INLINE.toLocaleString(toLanguageTag(locale)) })
        : undefined;
  }
}

const sourceKey = (c: MacroConfig) =>
  JSON.stringify([c.sourceType, c.attachment, c.gitConnectionId, c.gitRepo, c.gitRef, c.gitPath, c.url, c.inlineSpec]);

function ConfigApp() {
  const { t, locale } = useI18n();
  const [config, setConfig] = useState<MacroConfig | undefined>();
  const [options, setOptions] = useState<EditorOptions | undefined>();
  const [optionsError, setOptionsError] = useState<AppError | undefined>();
  const [attachments, setAttachments] = useState<AttachmentOption[] | undefined>();
  const [attachmentsError, setAttachmentsError] = useState<AppError | undefined>();
  const [approvedHosts, setApprovedHosts] = useState<string[] | undefined>();
  const [tab, setTab] = useState<'source' | 'display'>('source');
  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  const [gitLink, setGitLink] = useState('');
  // Set when the macro was inserted by pasting a link (macro autoconvert).
  const [autoConvertLink, setAutoConvertLink] = useState<string>();
  const [autoConverted, setAutoConverted] = useState(false);
  const [contentId, setContentId] = useState<string>();
  // Bumped when the selected attachment's content changes (same name, new version).
  const [previewNonce, setPreviewNonce] = useState(0);
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
    permissions.egress
      .get({})
      .then((res) => setApprovedHosts(res.results.flatMap((g) => g.configured.map((c) => c.domain))))
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
        const data = await call(invoke('loadSpec', { preview: cleanConfig(current), refresh: true }));
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
  const filteredCount = useMemo(() => {
    if (preview.status !== 'ready' || !config) return undefined;
    const filtered = filterSpec(preview.spec, config);
    return summarizeSpec(filtered, preview.data.summary.kind).operations.length;
  }, [preview, config]);

  const urlHostApproved = useMemo(() => {
    if (config?.sourceType !== 'url' || !approvedHosts) return true;
    try {
      const origin = new URL(config.url ?? '').origin;
      const host = new URL(config.url ?? '').hostname;
      return approvedHosts.some((d) => d === origin || d === host || (d.startsWith('*.') && host.endsWith(d.slice(1))) || d === '*');
    } catch {
      return true;
    }
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
