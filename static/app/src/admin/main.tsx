import { useCallback, useEffect, useState } from 'react';
import { originOf, PROVIDERS } from '../../../../src/shared/git';
import type { Translate } from '../../../../src/shared/i18n';
import type { AppError, AppSettings, AuditEntryView, GitAuthType, GitConnection, GitConnectionInput, GitProvider } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { Button, ErrorMessage, Field, Loading, Message, splitList, Toggle } from '../components/ui';
import { formatDate } from '../format';
import { errorText, useI18n, useT } from '../i18n';
import '../styles/admin.css';
import { approveHosts, getApprovedHosts, GROUP_INFO, HostLimitError, MAX_DOMAINS_PER_GROUP, normaliseHost, removeHost, type EgressGroup } from './egress';

// Values are translation keys.
const AUTH_OPTIONS: Record<GitProvider, Array<{ id: GitAuthType; label: string }>> = {
  github: [
    { id: 'bearer', label: 'ui.admin.authBearerGithub' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
  gitlab: [
    { id: 'private-token', label: 'ui.admin.authPrivateToken' },
    { id: 'bearer', label: 'ui.admin.authBearerGitlab' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
  bitbucket: [
    { id: 'bearer', label: 'ui.admin.authBearerBitbucket' },
    { id: 'basic', label: 'ui.admin.authBasicBitbucket' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
};

const CACHE_OPTIONS = [0, 5, 10, 30, 60, 360, 1440];

type Draft = Omit<GitConnectionInput, 'repos' | 'spaceKeys'> & { repos: string; spaceKeys: string };
type Status = { kind: 'success' | 'warning' | 'error'; text: string };

const emptyDraft = (provider: GitProvider = 'github'): Draft => ({
  name: '',
  provider,
  apiBaseUrl: PROVIDERS[provider].apiBaseUrl,
  webBaseUrl: PROVIDERS[provider].webBaseUrl,
  authType: AUTH_OPTIONS[provider][0].id,
  username: '',
  repos: '',
  spaceKeys: '',
  defaultRef: '',
  token: '',
});

const toDraft = (c: GitConnection): Draft => ({
  id: c.id,
  name: c.name,
  provider: c.provider,
  apiBaseUrl: c.apiBaseUrl,
  webBaseUrl: c.webBaseUrl,
  authType: c.authType,
  username: c.username ?? '',
  repos: c.repos.join('\n'),
  spaceKeys: c.spaceKeys.join(', '),
  defaultRef: c.defaultRef ?? '',
  token: undefined,
});

function hostApproved(origin: string | undefined, hosts: string[]): boolean {
  if (!origin) return false;
  const host = new URL(origin).hostname;
  return hosts.some((h) => h === origin || h === '*' || (h.startsWith('*.') && host.endsWith(h.slice(1))));
}

const errorString = (t: Translate, err: unknown) => {
  const { title, hint } = errorText(t, toAppError(err));
  return hint ? `${title} ${hint}` : title;
};

function hostErrorString(t: Translate, err: unknown, fallbackKey: string) {
  if (err instanceof HostLimitError) return t('ui.admin.hostLimit', { max: MAX_DOMAINS_PER_GROUP });
  // Bridge errors from the consent flow are plain Errors without a key.
  return err instanceof Error && err.message ? `${t(fallbackKey)} ${err.message}` : t(fallbackKey);
}

// Host approvals go through Atlassian's consent dialog in the browser, so the
// backend never sees them. Report them so they show up in the activity log.
// A failed log write never undoes or blocks the approval itself.
async function recordHostChange(action: 'host.approve' | 'host.remove', group: EgressGroup, hosts: string[]): Promise<void> {
  await Promise.allSettled(hosts.map((host) => call(invoke('adminRecordHostChange', { action, host, group }))));
}

function GeneralSettings({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      const saved = await call(invoke('adminSaveSettings', { settings: draft }));
      onSaved(saved);
      setDraft(saved);
      setStatus({ kind: 'success', text: t('ui.admin.settingsSaved') });
    } catch (err) {
      setStatus({ kind: 'error', text: errorString(t, err) });
    } finally {
      setBusy(false);
    }
  };

  const clearCache = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      await call(invoke('adminClearCache'));
      setStatus({ kind: 'success', text: t('ui.admin.cacheCleared') });
    } catch (err) {
      setStatus({ kind: 'error', text: errorString(t, err) });
    } finally {
      setBusy(false);
    }
  };

  const cacheLabel = (minutes: number) =>
    minutes === 0
      ? t('ui.admin.cacheNone')
      : minutes < 60
        ? t('ui.admin.cacheMinutes', { n: minutes })
        : minutes === 60
          ? t('ui.admin.cacheHour')
          : t('ui.admin.cacheHours', { n: minutes / 60 });

  return (
    <section className="sp-card sp-stack" aria-labelledby="general-heading">
      <h2 id="general-heading">{t('ui.admin.general')}</h2>
      <Toggle
        label={t('ui.admin.allowUrls')}
        checked={draft.urlSourcesEnabled}
        onChange={(v) => setDraft({ ...draft, urlSourcesEnabled: v })}
        help={t('ui.admin.allowUrlsHelp')}
      />
      <Toggle
        label={t('ui.admin.allowTryItOut')}
        checked={draft.tryItOutEnabled}
        onChange={(v) => setDraft({ ...draft, tryItOutEnabled: v })}
        help={t('ui.admin.allowTryItOutHelp')}
      />
      <Field label={t('ui.admin.cacheFor')} help={t('ui.admin.cacheHelp')}>
        {(id, describedBy) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className="sp-select sp-select-narrow"
            value={draft.cacheTtlMinutes}
            onChange={(e) => setDraft({ ...draft, cacheTtlMinutes: Number(e.target.value) })}
          >
            {CACHE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {cacheLabel(m)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="sp-row">
        <Button appearance="primary" onClick={() => void save()} disabled={!dirty || busy}>
          {t('ui.admin.saveSettings')}
        </Button>
        <Button onClick={() => void clearCache()} disabled={busy}>
          {t('ui.admin.clearCache')}
        </Button>
        {status ? <span className={status.kind === 'error' ? 'sp-error-text' : 'sp-help'}>{status.text}</span> : null}
      </div>
    </section>
  );
}

function HostList({ group, hosts, onChange }: { group: EgressGroup; hosts: string[]; onChange: () => Promise<void> }) {
  const t = useT();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const full = hosts.length >= MAX_DOMAINS_PER_GROUP;

  const add = async () => {
    const host = normaliseHost(input);
    if (!host) {
      setError(t('ui.admin.hostInvalid'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const added = await approveHosts(group, [host]);
      await recordHostChange('host.approve', group, added);
      setInput('');
      await onChange();
    } catch (err) {
      setError(hostErrorString(t, err, 'ui.admin.hostNotApproved'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (domain: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await removeHost(group, domain);
      await recordHostChange('host.remove', group, [domain]);
      await onChange();
    } catch (err) {
      setError(hostErrorString(t, err, 'ui.admin.hostNotRemoved'));
    } finally {
      setBusy(false);
    }
  };

  const title = t(GROUP_INFO[group].title);
  return (
    <div className="sp-stack-tight">
      <h3>{title}</h3>
      {hosts.length ? (
        <ul className="sp-host-list">
          {hosts.map((h) => (
            <li key={h}>
              <code>{h}</code>
              <Button compact appearance="subtle" onClick={() => void remove(h)} disabled={busy} aria-label={t('ui.admin.hostRemoveLabel', { host: h })}>
                {t('ui.common.remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="sp-help">{t('ui.admin.hostsNone')}</span>
      )}
      {group !== 'git' ? (
        <div className="sp-row sp-row-nowrap">
          <input
            className="sp-input"
            aria-label={t('ui.admin.hostAddTo', { list: title })}
            placeholder={t('ui.admin.hostPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            disabled={busy || full}
          />
          <Button onClick={() => void add()} disabled={busy || !input.trim() || full}>
            {t('ui.common.approve')}
          </Button>
        </div>
      ) : null}
      {full && group !== 'git' ? <span className="sp-help">{t('ui.admin.hostLimit', { max: MAX_DOMAINS_PER_GROUP })}</span> : null}
      {error ? <span className="sp-error-text">{error}</span> : null}
    </div>
  );
}

function ConnectionEditor({
  draft,
  setDraft,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onCancel: () => void;
  onSaved: (c: GitConnection) => Promise<void>;
}) {
  const t = useT();
  const [error, setError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const isNew = !draft.id;
  const heading = isNew ? t('ui.admin.newConnection') : t('ui.admin.editConnection', { name: draft.name });

  const changeProvider = (provider: GitProvider) =>
    setDraft({ ...draft, provider, apiBaseUrl: PROVIDERS[provider].apiBaseUrl, webBaseUrl: PROVIDERS[provider].webBaseUrl, authType: AUTH_OPTIONS[provider][0].id });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const input: GitConnectionInput = {
        ...draft,
        repos: splitList(draft.repos),
        spaceKeys: splitList(draft.spaceKeys),
        // undefined = keep the existing token
        token: draft.token === undefined || (draft.token === '' && !isNew) ? undefined : draft.token,
      };
      const saved = await call(invoke('adminSaveConnection', { connection: input }));
      await onSaved(saved);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(false);
    }
  };

  const apiHelp = draft.provider === 'github' ? t('ui.admin.apiUrlGithubHelp') : draft.provider === 'gitlab' ? t('ui.admin.apiUrlGitlabHelp') : undefined;

  return (
    <div className="sp-card sp-stack" role="group" aria-label={heading}>
      <h3>{heading}</h3>
      {error ? <ErrorMessage error={error} /> : null}
      <div className="sp-grid-2">
        <Field label={t('ui.admin.provider')}>
          {(id) => (
            <select id={id} className="sp-select" value={draft.provider} onChange={(e) => changeProvider(e.target.value as GitProvider)}>
              {(Object.keys(PROVIDERS) as GitProvider[]).map((p) => (
                <option key={p} value={p}>
                  {t(`ui.provider.${p}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('ui.admin.name')} help={t('ui.admin.nameHelp')}>
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Acme GitHub" />}
        </Field>
        <Field label={t('ui.admin.apiUrl')} help={apiHelp}>
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} />}
        </Field>
        <Field label={t('ui.admin.webUrl')} help={t('ui.admin.webUrlHelp')}>
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.webBaseUrl} onChange={(e) => setDraft({ ...draft, webBaseUrl: e.target.value })} />}
        </Field>
      </div>
      <Field label={t('ui.admin.auth')}>
        {(id) => (
          <select id={id} className="sp-select" value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as GitAuthType })}>
            {AUTH_OPTIONS[draft.provider].map((o) => (
              <option key={o.id} value={o.id}>
                {t(o.label)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {draft.authType === 'basic' ? (
        <Field label={t('ui.admin.email')}>
          {(id) => <input id={id} className="sp-input" type="email" autoComplete="off" value={draft.username ?? ''} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />}
        </Field>
      ) : null}
      {draft.authType !== 'none' ? (
        <Field
          label={t('ui.admin.token')}
          help={[t(`ui.provider.${draft.provider}Token`), t('ui.admin.tokenHelpSuffix'), isNew ? '' : t('ui.admin.tokenKeep')].filter(Boolean).join(' ')}
        >
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              className="sp-input"
              type="password"
              autoComplete="new-password"
              placeholder={isNew ? '' : t('ui.admin.tokenStored')}
              value={draft.token ?? ''}
              onChange={(e) => setDraft({ ...draft, token: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      <Field label={t('ui.admin.repos')} help={t('ui.admin.reposHelp', { hint: PROVIDERS[draft.provider].repoHint })}>
        {(id, d) => <textarea id={id} aria-describedby={d} className="sp-input sp-input-short" rows={3} value={draft.repos} onChange={(e) => setDraft({ ...draft, repos: e.target.value })} />}
      </Field>
      <div className="sp-grid-2">
        <Field label={t('ui.admin.spaces')} help={t('ui.admin.spacesHelp')}>
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.spaceKeys} onChange={(e) => setDraft({ ...draft, spaceKeys: e.target.value })} placeholder="ENG, API" />}
        </Field>
        <Field label={t('ui.admin.defaultRef')}>
          {(id) => <input id={id} className="sp-input" value={draft.defaultRef ?? ''} onChange={(e) => setDraft({ ...draft, defaultRef: e.target.value })} placeholder="main" />}
        </Field>
      </div>
      <div className="sp-row sp-row-end">
        <Button appearance="subtle" onClick={onCancel} disabled={busy}>
          {t('ui.common.cancel')}
        </Button>
        <Button appearance="primary" onClick={() => void save()} disabled={busy}>
          {busy ? t('ui.common.saving') : t('ui.admin.saveConnection')}
        </Button>
      </div>
    </div>
  );
}

function TestConnection({ connection }: { connection: GitConnection }) {
  const t = useT();
  const [repo, setRepo] = useState(connection.repos.find((r) => !r.includes('*')) ?? '');
  const [path, setPath] = useState('openapi.yaml');
  const [ref, setRef] = useState(connection.defaultRef ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; text: string } | { ok: false; error: AppError }>();

  const run = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      const r = await call(invoke('adminTestConnection', { id: connection.id, repo, path, ref }));
      setResult({
        ok: true,
        text: t('ui.admin.testResult', { title: r.title, version: r.version ? ` v${r.version}` : '', ops: r.operationCount, files: r.fileCount }),
      });
    } catch (err) {
      setResult({ ok: false, error: toAppError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-test sp-stack-tight">
      <div className="sp-row sp-row-nowrap">
        <input className="sp-input" aria-label={t('ui.admin.testRepo')} placeholder={PROVIDERS[connection.provider].repoHint} value={repo} onChange={(e) => setRepo(e.target.value)} />
        <input className="sp-input" aria-label={t('ui.admin.testBranch')} placeholder="main" value={ref} onChange={(e) => setRef(e.target.value)} />
        <input className="sp-input" aria-label={t('ui.admin.testPath')} placeholder="openapi.yaml" value={path} onChange={(e) => setPath(e.target.value)} />
        <Button onClick={() => void run()} disabled={busy || !repo || !path}>
          {busy ? t('ui.common.testing') : t('ui.common.test')}
        </Button>
      </div>
      {result ? result.ok ? <Message appearance="success">{result.text}</Message> : <ErrorMessage error={result.error} /> : null}
    </div>
  );
}

function describeAudit(t: Translate, entry: AuditEntryView): string {
  const action = t(`ui.audit.${entry.action}`);
  let details = entry.target ?? '';
  if (entry.action === 'host.approve' || entry.action === 'host.remove') {
    // changes holds the egress group for host entries.
    const group = entry.changes?.[0] as EgressGroup | undefined;
    if (group && GROUP_INFO[group]) details = `${details} (${t(GROUP_INFO[group].title)})`;
  } else if (entry.changes?.length) {
    details = details ? `${details}: ${entry.changes.join(', ')}` : entry.changes.join(', ');
  }
  return details ? `${action}: ${details}` : action;
}

function Activity({ refreshKey }: { refreshKey: number }) {
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

function AdminApp() {
  const t = useT();
  const [state, setState] = useState<{ settings: AppSettings; connections: GitConnection[] }>();
  const [error, setError] = useState<AppError>();
  const [hosts, setHosts] = useState<Record<EgressGroup, string[]>>();
  const [hostsError, setHostsError] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [testing, setTesting] = useState<string>();
  const [notice, setNotice] = useState<Status>();
  // Bumped after each change so the activity log reloads.
  const [activityKey, setActivityKey] = useState(0);
  const changed = () => setActivityKey((k) => k + 1);

  const loadHosts = useCallback(async () => {
    try {
      setHosts(await getApprovedHosts());
      setHostsError(undefined);
    } catch (err) {
      setHostsError(err instanceof Error && err.message ? err.message : 'load-failed');
      setHosts({ git: [], specs: [], apis: [] });
    }
  }, []);

  const hostsChanged = useCallback(async () => {
    await loadHosts();
    setActivityKey((k) => k + 1);
  }, [loadHosts]);

  useEffect(() => {
    call(invoke('adminGetState')).then(setState).catch((err) => setError(toAppError(err)));
    void loadHosts();
  }, [loadHosts]);

  const approveGitHost = async (origin: string): Promise<boolean> => {
    const added = await approveHosts('git', [origin]);
    await recordHostChange('host.approve', 'git', added);
    await hostsChanged();
    return added.length > 0;
  };

  const onConnectionSaved = async (saved: GitConnection) => {
    setState((s) => s && { ...s, connections: s.connections.some((c) => c.id === saved.id) ? s.connections.map((c) => (c.id === saved.id ? saved : c)) : [...s.connections, saved] });
    setDraft(undefined);
    changed();
    const origin = originOf(saved.apiBaseUrl);
    if (origin && hosts && !hostApproved(origin, hosts.git)) {
      try {
        const ok = await approveGitHost(origin);
        setNotice(
          ok
            ? { kind: 'success', text: t('ui.admin.connectionSavedApproved', { host: origin }) }
            : { kind: 'warning', text: t('ui.admin.connectionSavedNotApproved', { host: origin, reason: '' }).trim() },
        );
      } catch (err) {
        setNotice({ kind: 'warning', text: t('ui.admin.connectionSavedNotApproved', { host: origin, reason: hostErrorString(t, err, 'ui.admin.notApproved') }) });
      }
    } else {
      setNotice({ kind: 'success', text: t('ui.admin.connectionSaved') });
    }
  };

  const remove = async (connection: GitConnection) => {
    if (!window.confirm(t('ui.admin.deleteConfirm', { name: connection.name }))) return;
    try {
      await call(invoke('adminDeleteConnection', { id: connection.id }));
      setState((s) => s && { ...s, connections: s.connections.filter((c) => c.id !== connection.id) });
      setNotice({ kind: 'success', text: t('ui.admin.connectionDeleted') });
      changed();
    } catch (err) {
      setNotice({ kind: 'error', text: errorString(t, err) });
    }
  };

  if (error) {
    return (
      <main className="sp-admin">
        <ErrorMessage error={error} />
      </main>
    );
  }
  if (!state || !hosts) return <Loading label={t('ui.admin.loading')} />;

  return (
    <main className="sp-admin sp-stack">
      <header className="sp-stack-tight">
        <h1>{t('ui.admin.title')}</h1>
        <p className="sp-muted">{t('ui.admin.intro')}</p>
      </header>

      {notice ? <Message appearance={notice.kind}>{notice.text}</Message> : null}

      <GeneralSettings
        settings={state.settings}
        onSaved={(settings) => {
          setState({ ...state, settings });
          changed();
        }}
      />

      <section className="sp-card sp-stack" aria-labelledby="git-heading">
        <div className="sp-row">
          <h2 id="git-heading">{t('ui.admin.git')}</h2>
          <div className="sp-spacer" />
          {!draft ? (
            <Button appearance="primary" onClick={() => setDraft(emptyDraft())}>
              {t('ui.admin.addConnection')}
            </Button>
          ) : null}
        </div>
        <p className="sp-muted">{t('ui.admin.gitIntro')}</p>
        {draft ? <ConnectionEditor draft={draft} setDraft={setDraft} onCancel={() => setDraft(undefined)} onSaved={onConnectionSaved} /> : null}
        {state.connections.length ? (
          <table className="sp-table">
            <thead>
              <tr>
                <th scope="col">{t('ui.admin.colName')}</th>
                <th scope="col">{t('ui.admin.colRepos')}</th>
                <th scope="col">{t('ui.admin.colSpaces')}</th>
                <th scope="col">{t('ui.admin.colStatus')}</th>
                <th scope="col">
                  <span className="sp-visually-hidden">{t('ui.admin.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.connections.map((c) => {
                const origin = originOf(c.apiBaseUrl);
                const approved = hostApproved(origin, hosts.git);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="sp-small">{t(`ui.provider.${c.provider}`)}</div>
                      {testing === c.id ? <TestConnection connection={c} /> : null}
                    </td>
                    <td>{c.repos.join(', ')}</td>
                    <td>{c.spaceKeys.length ? c.spaceKeys.join(', ') : t('ui.common.all')}</td>
                    <td>
                      <div className="sp-stack-tight">
                        <span className={`sp-lozenge ${c.hasToken || c.authType === 'none' ? 'sp-lozenge-success' : 'sp-lozenge-warning'}`}>
                          {c.authType === 'none' ? t('ui.admin.statusPublic') : c.hasToken ? t('ui.admin.statusToken') : t('ui.admin.statusNoToken')}
                        </span>
                        <span className={`sp-lozenge ${approved ? 'sp-lozenge-success' : 'sp-lozenge-warning'}`}>
                          {approved ? t('ui.admin.statusHostOk') : t('ui.admin.statusHostMissing')}
                        </span>
                        {!approved && origin ? (
                          <Button
                            compact
                            onClick={() => approveGitHost(origin).catch((err) => setNotice({ kind: 'error', text: hostErrorString(t, err, 'ui.admin.notApproved') }))}
                          >
                            {t('ui.admin.approveHost')}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="sp-row sp-row-nowrap">
                        <Button compact onClick={() => setTesting(testing === c.id ? undefined : c.id)}>
                          {t('ui.common.test')}
                        </Button>
                        <Button compact onClick={() => setDraft(toDraft(c))}>
                          {t('ui.common.edit')}
                        </Button>
                        <Button compact appearance="subtle" onClick={() => void remove(c)}>
                          {t('ui.common.delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : !draft ? (
          <span className="sp-help">{t('ui.admin.noConnections')}</span>
        ) : null}
      </section>

      <section className="sp-card sp-stack" aria-labelledby="hosts-heading">
        <h2 id="hosts-heading">{t('ui.admin.hosts')}</h2>
        <p className="sp-muted">{t('ui.admin.hostsIntro')}</p>
        {hostsError ? (
          <Message appearance="warning">{hostsError === 'load-failed' ? t('ui.admin.hostsLoadFailed') : `${t('ui.admin.hostsLoadFailed')} ${hostsError}`}</Message>
        ) : null}
        <div className="sp-host-grid">
          {(Object.keys(GROUP_INFO) as EgressGroup[]).map((g) => (
            <HostList key={g} group={g} hosts={hosts[g]} onChange={hostsChanged} />
          ))}
        </div>
      </section>

      <Activity refreshKey={activityKey} />
    </main>
  );
}

void mount(<AdminApp />);
