import { permissions, view } from '@forge/bridge';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { matchConnection, parseGitFileLink } from '../../../../src/shared/git';
import { buildSearchText, filterSpec, isAsyncApi, summarizeSpec } from '../../../../src/shared/spec';
import type { AppError, AttachmentOption, ConnectionOption, MacroConfig, SourceType } from '../../../../src/shared/types';
import { EGRESS_GROUPS } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { QualityReport } from '../components/QualityReport';
import { Button, ErrorMessage, Loading, Message, Tabs } from '../components/ui';
import { AttachmentSource } from './AttachmentSource';
import { DisplaySettings } from './DisplaySettings';
import { PreviewPanel } from './PreviewPanel';
import { GitSource } from './GitSource';
import { InlineSource } from './InlineSource';
import { UrlSource } from './UrlSource';
import { usePreview } from './usePreview';
import { cleanConfig, isHttpsUrl, validateSource } from './logic';
import { useI18n } from '../i18n';
import '../styles/config.css';


type EditorOptions = { connections: ConnectionOption[]; urlSourcesEnabled: boolean; tryItOutEnabled: boolean };

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
  const preview = usePreview(config, sourceError, previewNonce);

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
              <GitSource
                config={config}
                update={update}
                connections={connections}
                gitLink={gitLink}
                setGitLink={setGitLink}
                gitLinkError={gitLinkError}
                setGitLinkError={setGitLinkError}
              />
            ) : null}

            {config.sourceType === 'url' ? <UrlSource config={config} update={update} approvedHosts={approvedHosts} /> : null}

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
          <DisplaySettings
            config={config}
            update={update}
            tags={tags}
            filteredCount={preview.status === 'ready' ? filteredCount : undefined}
            totalCount={preview.status === 'ready' ? preview.data.summary.operations.length : undefined}
            tryItOutEnabled={options.tryItOutEnabled}
            serverUrlError={serverUrlError}
          />
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

      <PreviewPanel
        preview={preview}
        config={config}
        sourceError={sourceError}
        tryItOutAllowed={options.tryItOutEnabled && config.tryItOut === true}
      />
    </div>
  );
}

void mount(<ConfigApp />);
