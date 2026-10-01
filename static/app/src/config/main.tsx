import { permissions, view } from '@forge/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isValidRef, isValidRepo, normaliseRepoPath, parseGitFileLink, PROVIDERS } from '../../../../src/shared/git';
import { buildSearchText, filterSpec, summarizeSpec } from '../../../../src/shared/spec';
import type {
  AppError,
  AttachmentOption,
  ConnectionOption,
  DocExpansion,
  LoadSpecResponse,
  MacroConfig,
  SourceType,
} from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { ApiDocs } from '../components/ApiDocs';
import { Button, ErrorMessage, Field, Loading, Message, splitList, Tabs, Toggle } from '../components/ui';
import { KIND_LABELS } from '../format';
import '../styles/config.css';

const MAX_INLINE = 100_000;

type EditorOptions = { connections: ConnectionOption[]; urlSourcesEnabled: boolean; tryItOutEnabled: boolean };

type Preview = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: AppError } | { status: 'ready'; data: LoadSpecResponse };

const SOURCES: Array<{ id: SourceType; title: string; description: string }> = [
  { id: 'attachment', title: 'Page attachment', description: 'A .yaml or .json file attached to this page' },
  { id: 'git', title: 'Git repository', description: 'GitHub, GitLab or Bitbucket — always up to date' },
  { id: 'url', title: 'URL', description: 'A public or approved https:// address' },
  { id: 'inline', title: 'Paste', description: 'Paste the spec directly' },
];

/** Remove empty values: Forge macro config rejects `null` and nested arrays. */
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

/** Client-side checks so editors get instant feedback before a preview round trip. */
function validateSource(config: MacroConfig, connections: ConnectionOption[]): string | undefined {
  switch (config.sourceType) {
    case undefined:
      return 'Choose where the spec comes from.';
    case 'attachment':
      return config.attachment ? undefined : 'Choose an attachment.';
    case 'git': {
      const connection = connections.find((c) => c.id === config.gitConnectionId);
      if (!connection) return 'Choose a Git connection.';
      if (!config.gitRepo || !isValidRepo(connection.provider, config.gitRepo.trim())) return `Enter a repository like ${PROVIDERS[connection.provider].repoHint}.`;
      if (config.gitRef && !isValidRef(config.gitRef.trim())) return 'The branch, tag or commit contains unsupported characters.';
      if (!config.gitPath || !normaliseRepoPath(config.gitPath)) return 'Enter the path to a .yaml, .yml or .json file.';
      return undefined;
    }
    case 'url':
      return /^https:\/\/\S+$/i.test(config.url?.trim() ?? '') ? undefined : 'Enter a URL starting with https://';
    case 'inline':
      if (!config.inlineSpec?.trim()) return 'Paste an OpenAPI or Swagger document.';
      return config.inlineSpec.length > MAX_INLINE ? 'Pasted specs are limited to 100,000 characters.' : undefined;
  }
}

const sourceKey = (c: MacroConfig) =>
  JSON.stringify([c.sourceType, c.attachment, c.gitConnectionId, c.gitRepo, c.gitRef, c.gitPath, c.url, c.inlineSpec]);

function ConfigApp() {
  const [config, setConfig] = useState<MacroConfig | undefined>();
  const [options, setOptions] = useState<EditorOptions | undefined>();
  const [optionsError, setOptionsError] = useState<AppError | undefined>();
  const [attachments, setAttachments] = useState<AttachmentOption[] | undefined>();
  const [attachmentsError, setAttachmentsError] = useState<AppError | undefined>();
  const [approvedHosts, setApprovedHosts] = useState<string[] | undefined>();
  const [tab, setTab] = useState<'source' | 'display'>('source');
  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  const [gitLink, setGitLink] = useState('');
  const [gitLinkError, setGitLinkError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const previewSeq = useRef(0);
  // Latest config for the debounced preview, which only re-runs when source fields change.
  const configRef = useRef<MacroConfig | undefined>(undefined);
  configRef.current = config;

  const update = (patch: Partial<MacroConfig>) => setConfig((c) => ({ ...(c ?? {}), ...patch }));

  const loadAttachments = useCallback(async () => {
    setAttachmentsError(undefined);
    try {
      setAttachments(await call(invoke('listAttachments')));
    } catch (err) {
      setAttachmentsError(toAppError(err));
      setAttachments([]);
    }
  }, []);

  useEffect(() => {
    // Custom macro config reads the saved configuration from getContext().
    view
      .getContext()
      .then((ctx) => setConfig({ docExpansion: 'list', showModels: true, ...((ctx.extension?.config as MacroConfig | undefined) ?? {}) }))
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
  const sourceError = config ? validateSource(config, connections) : undefined;
  const currentSourceKey = config ? sourceKey(config) : '';

  // Debounced live preview whenever the source changes.
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
        if (seq === previewSeq.current) setPreview({ status: 'ready', data });
      } catch (err) {
        if (seq === previewSeq.current) setPreview({ status: 'error', error: toAppError(err) });
      }
    }, 600);
    return () => clearTimeout(timer);
    // Only the source fields trigger a reload; display options re-render locally.
  }, [currentSourceKey, sourceError]);

  const tags = preview.status === 'ready' ? preview.data.summary.tags : [];
  const filteredCount = useMemo(() => {
    if (preview.status !== 'ready' || !config) return undefined;
    const filtered = filterSpec(preview.data.spec, config);
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
      setGitLinkError('Paste a link to a file on GitHub, GitLab or Bitbucket.');
      return;
    }
    const match = connections.find((c) => c.provider === parsed.provider) ?? connections.find((c) => c.id === config?.gitConnectionId);
    setGitLinkError(match ? undefined : `No ${PROVIDERS[parsed.provider].label} connection is available. Ask a Confluence admin to add one.`);
    update({ gitConnectionId: match?.id ?? config?.gitConnectionId, gitRepo: parsed.repo, gitRef: parsed.ref, gitPath: parsed.path });
  };

  const save = async () => {
    if (!config) return;
    if (sourceError) {
      setTab('source');
      setSaveError(sourceError);
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    // Index what readers will actually see, so search results match the filtered docs.
    const searchText =
      preview.status === 'ready'
        ? buildSearchText(summarizeSpec(filterSpec(preview.data.spec, config), preview.data.summary.kind))
        : config.searchText;
    try {
      await view.submit({ config: cleanConfig({ ...config, searchText }) });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setSaveError(`${e.code ? `${e.code}: ` : ''}${e.message ?? 'The settings could not be saved.'}`);
      setSaving(false);
    }
  };

  if (!config || !options) return <Loading label="Loading settings…" />;

  const selectedConnection = connections.find((c) => c.id === config.gitConnectionId);

  return (
    <div className="sp-config">
      <div className="sp-config-form">
        <Tabs
          label="Macro settings"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'source', label: 'Source' },
            { id: 'display', label: 'Display' },
          ]}
        />

        {optionsError ? <ErrorMessage error={optionsError} /> : null}

        {tab === 'source' ? (
          <div className="sp-stack">
            <div className="sp-choices" role="radiogroup" aria-label="Spec source">
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
                    title={disabled ? 'A Confluence admin can enable URL sources in SpecPage settings.' : undefined}
                    onClick={() => update({ sourceType: s.id })}
                  >
                    <span className="sp-choice-title">{s.title}</span>
                    <span className="sp-small">{disabled ? 'Turned off by your admin' : s.description}</span>
                  </button>
                );
              })}
            </div>

            {config.sourceType === 'attachment' ? (
              <div className="sp-stack">
                {attachmentsError ? <ErrorMessage error={attachmentsError} /> : null}
                {attachments && attachments.length === 0 && !attachmentsError ? (
                  <Message title="No spec files are attached to this page yet.">
                    Drag your .yaml or .json file onto the page in the editor (or use Insert → Files), then refresh this list.
                  </Message>
                ) : null}
                <div className="sp-row sp-row-bottom">
                  <div className="sp-grow">
                    <Field label="Attachment">
                      {(id) => (
                        <select id={id} className="sp-select" value={config.attachment ?? ''} onChange={(e) => update({ attachment: e.target.value || undefined })}>
                          <option value="">Select a file…</option>
                          {config.attachment && !attachments?.some((a) => a.title === config.attachment) ? (
                            <option value={config.attachment}>{config.attachment} (not found)</option>
                          ) : null}
                          {attachments?.map((a) => (
                            <option key={a.title} value={a.title}>
                              {a.title}
                              {a.fileSize ? ` — ${Math.max(1, Math.round(a.fileSize / 1024))} KB` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                  <Button onClick={() => void loadAttachments()}>Refresh list</Button>
                </div>
                <span className="sp-help">Files referenced with relative $ref (for example ./schemas/pet.yaml) are loaded from the same page.</span>
              </div>
            ) : null}

            {config.sourceType === 'git' ? (
              connections.length === 0 ? (
                <Message appearance="warning" title="No Git connections are available in this space.">
                  A Confluence admin can add GitHub, GitLab or Bitbucket connections in SpecPage settings (Manage apps → SpecPage → Configure).
                </Message>
              ) : (
                <div className="sp-stack">
                  <div className="sp-row sp-row-bottom">
                    <div className="sp-grow">
                      <Field label="Paste a link to the file (optional)" error={gitLinkError}>
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
                      Fill in
                    </Button>
                  </div>
                  <Field label="Connection">
                    {(id) => (
                      <select id={id} className="sp-select" value={config.gitConnectionId ?? ''} onChange={(e) => update({ gitConnectionId: e.target.value || undefined })}>
                        <option value="">Select a connection…</option>
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({PROVIDERS[c.provider].label})
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field
                    label="Repository"
                    help={selectedConnection ? `Allowed: ${selectedConnection.repos.join(', ')}` : undefined}
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
                  <div className="sp-grid-2">
                    <Field label="Branch, tag or commit" help={selectedConnection?.defaultRef ? `Default: ${selectedConnection.defaultRef}` : 'Leave empty for the default branch'}>
                      {(id, describedBy) => (
                        <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="main" value={config.gitRef ?? ''} onChange={(e) => update({ gitRef: e.target.value })} />
                      )}
                    </Field>
                    <Field label="File path">
                      {(id) => (
                        <input id={id} className="sp-input" placeholder="api/openapi.yaml" value={config.gitPath ?? ''} onChange={(e) => update({ gitPath: e.target.value })} />
                      )}
                    </Field>
                  </div>
                  <span className="sp-help">Relative $ref files in the same repository are resolved automatically. Pages stay in sync with the branch you choose.</span>
                </div>
              )
            ) : null}

            {config.sourceType === 'url' ? (
              <div className="sp-stack">
                <Field label="Spec URL" help="Must start with https://. Use a Git connection for private repositories.">
                  {(id, describedBy) => (
                    <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="https://api.example.com/openapi.json" value={config.url ?? ''} onChange={(e) => update({ url: e.target.value })} />
                  )}
                </Field>
                {!urlHostApproved ? (
                  <Message appearance="warning" title="This host has not been approved yet.">
                    A Confluence admin must approve it in SpecPage settings → Approved hosts before the spec can load.
                  </Message>
                ) : null}
              </div>
            ) : null}

            {config.sourceType === 'inline' ? (
              <Field
                label="OpenAPI or Swagger document (YAML or JSON)"
                help={`${(config.inlineSpec ?? '').length.toLocaleString()} / ${MAX_INLINE.toLocaleString()} characters. For larger specs, attach the file instead.`}
              >
                {(id, describedBy) => (
                  <textarea
                    id={id}
                    aria-describedby={describedBy}
                    className="sp-input sp-code"
                    rows={14}
                    spellCheck={false}
                    value={config.inlineSpec ?? ''}
                    onChange={(e) => update({ inlineSpec: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </div>
        ) : (
          <div className="sp-stack">
            <Field label="Title" help="Leave empty to use the title from the spec.">
              {(id, describedBy) => (
                <input id={id} aria-describedby={describedBy} className="sp-input" value={config.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
              )}
            </Field>

            <fieldset className="sp-fieldset">
              <legend className="sp-label">Show only these tags</legend>
              {tags.length ? (
                <div className="sp-tag-list">
                  {tags.map((t) => (
                    <label key={t} className="sp-checkbox">
                      <input
                        type="checkbox"
                        checked={config.includeTags?.includes(t) ?? false}
                        onChange={(e) =>
                          update({
                            includeTags: e.target.checked ? [...(config.includeTags ?? []), t] : (config.includeTags ?? []).filter((x) => x !== t),
                          })
                        }
                      />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <span className="sp-help">Tags appear here once the spec has loaded.</span>
              )}
            </fieldset>

            <Field label="Show only paths starting with" help="One per line, for example /payments. Leave empty to show everything.">
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
              <span className="sp-help">
                Showing {filteredCount} of {preview.data.summary.operations.length} operations.
              </span>
            ) : null}

            <div className="sp-grid-2">
              <Field label="Expand operations">
                {(id) => (
                  <select id={id} className="sp-select" value={config.docExpansion ?? 'list'} onChange={(e) => update({ docExpansion: e.target.value as DocExpansion })}>
                    <option value="list">Show tags, collapse operations</option>
                    <option value="full">Expand everything</option>
                    <option value="none">Collapse everything</option>
                  </select>
                )}
              </Field>
              <Field label="Maximum height">
                {(id) => (
                  <select id={id} className="sp-select" value={String(config.maxHeight ?? 0)} onChange={(e) => update({ maxHeight: Number(e.target.value) })}>
                    <option value="0">Grow with content</option>
                    <option value="400">400 px (scroll)</option>
                    <option value="600">600 px (scroll)</option>
                    <option value="800">800 px (scroll)</option>
                    <option value="1200">1200 px (scroll)</option>
                  </select>
                )}
              </Field>
            </div>

            <Toggle label="Show API description and contact details" checked={config.showInfo !== false} onChange={(v) => update({ showInfo: v })} />
            <Toggle label="Show servers and authorization bar" checked={config.showServers !== false} onChange={(v) => update({ showServers: v })} />
            <Toggle label="Show schemas section" checked={config.showModels !== false} onChange={(v) => update({ showModels: v })} />
            <Toggle label="Show operation search box" checked={config.showFilter === true} onChange={(v) => update({ showFilter: v })} />
            <Toggle label="Hide deprecated operations" checked={config.hideDeprecated === true} onChange={(v) => update({ hideDeprecated: v })} />
            <Toggle
              label='Enable "Try it out"'
              checked={config.tryItOut === true}
              disabled={!options.tryItOutEnabled}
              onChange={(v) => update({ tryItOut: v })}
              help={
                options.tryItOutEnabled
                  ? 'Signed-in users can send requests to admin-approved API hosts. Requests are relayed by SpecPage.'
                  : 'Turned off for this site. A Confluence admin can enable it in SpecPage settings.'
              }
            />
          </div>
        )}

        <div className="sp-config-footer">
          {saveError ? <span className="sp-error-text">{saveError}</span> : null}
          <div className="sp-spacer" />
          <Button appearance="subtle" onClick={() => void view.close()}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <section className="sp-config-preview" aria-label="Preview">
        <div className="sp-row">
          <h2>Preview</h2>
          {preview.status === 'ready' ? (
            <>
              <span className="sp-lozenge">{KIND_LABELS[preview.data.summary.kind]}</span>
              <span className="sp-small">{preview.data.meta.sourceLabel}</span>
            </>
          ) : null}
        </div>
        {preview.status === 'idle' ? <Message>{sourceError ?? 'Choose a source to see a preview.'}</Message> : null}
        {preview.status === 'loading' ? <Loading label="Loading preview…" /> : null}
        {preview.status === 'error' ? <ErrorMessage error={preview.error} /> : null}
        {preview.status === 'ready' ? (
          <>
            {preview.data.meta.warnings.map((w) => (
              <Message key={w}>{w}</Message>
            ))}
            <ApiDocs spec={preview.data.spec} config={config} tryItOutAllowed={options.tryItOutEnabled && config.tryItOut === true} preview={cleanConfig(config)} />
          </>
        ) : null}
      </section>
    </div>
  );
}

void mount(<ConfigApp />);
