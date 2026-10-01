import { useCallback, useEffect, useState } from 'react';
import { originOf, PROVIDERS } from '../../../../src/shared/git';
import type { AppError, AppSettings, GitAuthType, GitConnection, GitConnectionInput, GitProvider } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { Button, ErrorMessage, Field, Loading, Message, splitList, Toggle } from '../components/ui';
import '../styles/admin.css';
import { approveHosts, getApprovedHosts, GROUP_INFO, MAX_DOMAINS_PER_GROUP, normaliseHost, removeHost, type EgressGroup } from './egress';

const AUTH_OPTIONS: Record<GitProvider, Array<{ id: GitAuthType; label: string }>> = {
  github: [
    { id: 'bearer', label: 'Personal access token (Bearer)' },
    { id: 'none', label: 'No token (public repositories only)' },
  ],
  gitlab: [
    { id: 'private-token', label: 'Access token (PRIVATE-TOKEN header)' },
    { id: 'bearer', label: 'OAuth token (Bearer)' },
    { id: 'none', label: 'No token (public projects only)' },
  ],
  bitbucket: [
    { id: 'bearer', label: 'Repository, project or workspace access token (Bearer)' },
    { id: 'basic', label: 'API token with Atlassian account email (Basic)' },
    { id: 'none', label: 'No token (public repositories only)' },
  ],
};

type Draft = Omit<GitConnectionInput, 'repos' | 'spaceKeys'> & { repos: string; spaceKeys: string };

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

function GeneralSettings({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      const saved = await call(invoke('adminSaveSettings', { settings: draft }));
      onSaved(saved);
      setDraft(saved);
      setStatus({ kind: 'success', text: 'Settings saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: toAppError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const clearCache = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      await call(invoke('adminClearCache'));
      setStatus({ kind: 'success', text: 'Cache cleared. Pages will reload specs from their sources.' });
    } catch (err) {
      setStatus({ kind: 'error', text: toAppError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sp-card sp-stack" aria-labelledby="general-heading">
      <h2 id="general-heading">General</h2>
      <Toggle
        label="Allow specs from URLs"
        checked={draft.urlSourcesEnabled}
        onChange={(v) => setDraft({ ...draft, urlSourcesEnabled: v })}
        help="Page editors can load specs from https:// URLs on the spec hosts you approve below."
      />
      <Toggle
        label='Allow "Try it out"'
        checked={draft.tryItOutEnabled}
        onChange={(v) => setDraft({ ...draft, tryItOutEnabled: v })}
        help="Signed-in users can send test requests to the API hosts you approve below. Guests and anonymous visitors can never send requests."
      />
      <Field label="Cache specs from Git and URLs for" help="Attachments are never cached because access depends on the reader's page permissions.">
        {(id, describedBy) => (
          <select id={id} aria-describedby={describedBy} className="sp-select sp-select-narrow" value={draft.cacheTtlMinutes} onChange={(e) => setDraft({ ...draft, cacheTtlMinutes: Number(e.target.value) })}>
            <option value={0}>Do not cache</option>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={360}>6 hours</option>
            <option value={1440}>24 hours</option>
          </select>
        )}
      </Field>
      <div className="sp-row">
        <Button appearance="primary" onClick={() => void save()} disabled={!dirty || busy}>
          Save settings
        </Button>
        <Button onClick={() => void clearCache()} disabled={busy}>
          Clear cache
        </Button>
        {status ? <span className={status.kind === 'error' ? 'sp-error-text' : 'sp-help'}>{status.text}</span> : null}
      </div>
    </section>
  );
}

function HostList({ group, hosts, onChange }: { group: EgressGroup; hosts: string[]; onChange: () => Promise<void> }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const host = normaliseHost(input);
    if (!host) {
      setError('Enter an https host such as api.example.com or a wildcard such as *.example.com.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await approveHosts(group, [host]);
      setInput('');
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The host was not approved.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (domain: string) => {
    setBusy(true);
    try {
      await removeHost(group, domain);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The host could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-stack-tight">
      <h3>{GROUP_INFO[group].title}</h3>
      {hosts.length ? (
        <ul className="sp-host-list">
          {hosts.map((h) => (
            <li key={h}>
              <code>{h}</code>
              <Button compact appearance="subtle" onClick={() => void remove(h)} disabled={busy} aria-label={`Remove ${h}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="sp-help">No hosts approved.</span>
      )}
      {group !== 'git' ? (
        <div className="sp-row sp-row-nowrap">
          <input
            className="sp-input"
            aria-label={`Add to ${GROUP_INFO[group].title}`}
            placeholder="api.example.com or *.example.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            disabled={busy || hosts.length >= MAX_DOMAINS_PER_GROUP}
          />
          <Button onClick={() => void add()} disabled={busy || !input.trim() || hosts.length >= MAX_DOMAINS_PER_GROUP}>
            Approve
          </Button>
        </div>
      ) : null}
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
  const [error, setError] = useState<AppError>();
  const [busy, setBusy] = useState(false);
  const isNew = !draft.id;

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

  return (
    <div className="sp-card sp-stack" role="group" aria-label={isNew ? 'New Git connection' : `Edit ${draft.name}`}>
      <h3>{isNew ? 'Add a Git connection' : `Edit “${draft.name}”`}</h3>
      {error ? <ErrorMessage error={error} /> : null}
      <div className="sp-grid-2">
        <Field label="Provider">
          {(id) => (
            <select id={id} className="sp-select" value={draft.provider} onChange={(e) => changeProvider(e.target.value as GitProvider)}>
              {(Object.keys(PROVIDERS) as GitProvider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDERS[p].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Name" help="Shown to page editors.">
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Acme GitHub" />}
        </Field>
        <Field label="API URL" help={draft.provider === 'github' ? 'GitHub Enterprise Server: https://HOST/api/v3' : draft.provider === 'gitlab' ? 'Self-managed: https://HOST/api/v4' : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.apiBaseUrl} onChange={(e) => setDraft({ ...draft, apiBaseUrl: e.target.value })} />}
        </Field>
        <Field label="Web URL" help="Used for “view source” links.">
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.webBaseUrl} onChange={(e) => setDraft({ ...draft, webBaseUrl: e.target.value })} />}
        </Field>
      </div>
      <Field label="Authentication">
        {(id) => (
          <select id={id} className="sp-select" value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as GitAuthType })}>
            {AUTH_OPTIONS[draft.provider].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {draft.authType === 'basic' ? (
        <Field label="Atlassian account email">
          {(id) => <input id={id} className="sp-input" type="email" autoComplete="off" value={draft.username ?? ''} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />}
        </Field>
      ) : null}
      {draft.authType !== 'none' ? (
        <Field
          label="Access token"
          help={
            <>
              {PROVIDERS[draft.provider].tokenHint} Stored encrypted with Forge secret storage and never sent back to the browser.
              {!isNew ? ' Leave empty to keep the current token.' : ''}
            </>
          }
        >
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              className="sp-input"
              type="password"
              autoComplete="new-password"
              placeholder={isNew ? '' : '••••••••  (stored)'}
              value={draft.token ?? ''}
              onChange={(e) => setDraft({ ...draft, token: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      <Field label="Allowed repositories" help={`One per line, e.g. ${PROVIDERS[draft.provider].repoHint} or a wildcard such as acme/*. Page editors can only use these.`}>
        {(id, d) => <textarea id={id} aria-describedby={d} className="sp-input sp-input-short" rows={3} value={draft.repos} onChange={(e) => setDraft({ ...draft, repos: e.target.value })} />}
      </Field>
      <div className="sp-grid-2">
        <Field label="Limit to spaces (optional)" help="Comma-separated space keys. Empty means all spaces.">
          {(id, d) => <input id={id} aria-describedby={d} className="sp-input" value={draft.spaceKeys} onChange={(e) => setDraft({ ...draft, spaceKeys: e.target.value })} placeholder="ENG, API" />}
        </Field>
        <Field label="Default branch (optional)">
          {(id) => <input id={id} className="sp-input" value={draft.defaultRef ?? ''} onChange={(e) => setDraft({ ...draft, defaultRef: e.target.value })} placeholder="main" />}
        </Field>
      </div>
      <div className="sp-row sp-row-end">
        <Button appearance="subtle" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save connection'}
        </Button>
      </div>
    </div>
  );
}

function TestConnection({ connection }: { connection: GitConnection }) {
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
      setResult({ ok: true, text: `Loaded ${r.title}${r.version ? ` v${r.version}` : ''}: ${r.operationCount} operations, ${r.fileCount} file(s).` });
    } catch (err) {
      setResult({ ok: false, error: toAppError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-test sp-stack-tight">
      <div className="sp-row sp-row-nowrap">
        <input className="sp-input" aria-label="Repository" placeholder={PROVIDERS[connection.provider].repoHint} value={repo} onChange={(e) => setRepo(e.target.value)} />
        <input className="sp-input" aria-label="Branch" placeholder="branch" value={ref} onChange={(e) => setRef(e.target.value)} />
        <input className="sp-input" aria-label="File path" placeholder="openapi.yaml" value={path} onChange={(e) => setPath(e.target.value)} />
        <Button onClick={() => void run()} disabled={busy || !repo || !path}>
          {busy ? 'Testing…' : 'Test'}
        </Button>
      </div>
      {result ? result.ok ? <Message appearance="success">{result.text}</Message> : <ErrorMessage error={result.error} /> : null}
    </div>
  );
}

function AdminApp() {
  const [state, setState] = useState<{ settings: AppSettings; connections: GitConnection[] }>();
  const [error, setError] = useState<AppError>();
  const [hosts, setHosts] = useState<Record<EgressGroup, string[]>>();
  const [hostsError, setHostsError] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [testing, setTesting] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'success' | 'warning' | 'error'; text: string }>();

  const loadHosts = useCallback(async () => {
    try {
      setHosts(await getApprovedHosts());
      setHostsError(undefined);
    } catch (err) {
      setHostsError(err instanceof Error ? err.message : 'Approved hosts could not be loaded.');
      setHosts({ git: [], specs: [], apis: [] });
    }
  }, []);

  useEffect(() => {
    call(invoke('adminGetState')).then(setState).catch((err) => setError(toAppError(err)));
    void loadHosts();
  }, [loadHosts]);

  const onConnectionSaved = async (saved: GitConnection) => {
    setState((s) => s && { ...s, connections: s.connections.some((c) => c.id === saved.id) ? s.connections.map((c) => (c.id === saved.id ? saved : c)) : [...s.connections, saved] });
    setDraft(undefined);
    const origin = originOf(saved.apiBaseUrl);
    if (origin && hosts && !hostApproved(origin, hosts.git)) {
      try {
        await approveHosts('git', [origin]);
        await loadHosts();
        setNotice({ kind: 'success', text: `Connection saved and ${origin} approved.` });
      } catch (err) {
        setNotice({ kind: 'warning', text: `Connection saved, but ${origin} was not approved, so pages cannot load from it yet. ${err instanceof Error ? err.message : ''}` });
      }
    } else {
      setNotice({ kind: 'success', text: 'Connection saved.' });
    }
  };

  const remove = async (connection: GitConnection) => {
    if (!window.confirm(`Delete the connection “${connection.name}”? Macros that use it will stop loading.`)) return;
    try {
      await call(invoke('adminDeleteConnection', { id: connection.id }));
      setState((s) => s && { ...s, connections: s.connections.filter((c) => c.id !== connection.id) });
      setNotice({ kind: 'success', text: 'Connection deleted.' });
    } catch (err) {
      setNotice({ kind: 'error', text: toAppError(err).message });
    }
  };

  if (error) {
    return (
      <main className="sp-admin">
        <ErrorMessage error={error} />
      </main>
    );
  }
  if (!state || !hosts) return <Loading label="Loading SpecPage settings…" />;

  return (
    <main className="sp-admin sp-stack">
      <header className="sp-stack-tight">
        <h1>SpecPage settings</h1>
        <p className="sp-muted">Control where API specs can be loaded from and whether readers can send test requests.</p>
      </header>

      {notice ? <Message appearance={notice.kind}>{notice.text}</Message> : null}

      <GeneralSettings settings={state.settings} onSaved={(settings) => setState({ ...state, settings })} />

      <section className="sp-card sp-stack" aria-labelledby="git-heading">
        <div className="sp-row">
          <h2 id="git-heading">Git connections</h2>
          <div className="sp-spacer" />
          {!draft ? (
            <Button appearance="primary" onClick={() => setDraft(emptyDraft())}>
              Add connection
            </Button>
          ) : null}
        </div>
        <p className="sp-muted">Connect GitHub, GitLab or Bitbucket so pages always show the latest spec. Use read-only tokens scoped to the repositories you list.</p>
        {draft ? <ConnectionEditor draft={draft} setDraft={setDraft} onCancel={() => setDraft(undefined)} onSaved={onConnectionSaved} /> : null}
        {state.connections.length ? (
          <table className="sp-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Repositories</th>
                <th scope="col">Spaces</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sp-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.connections.map((c) => {
                const approved = hostApproved(originOf(c.apiBaseUrl), hosts.git);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="sp-small">{PROVIDERS[c.provider].label}</div>
                      {testing === c.id ? <TestConnection connection={c} /> : null}
                    </td>
                    <td>{c.repos.join(', ')}</td>
                    <td>{c.spaceKeys.length ? c.spaceKeys.join(', ') : 'All'}</td>
                    <td>
                      <div className="sp-stack-tight">
                        <span className={`sp-lozenge ${c.hasToken || c.authType === 'none' ? 'sp-lozenge-success' : 'sp-lozenge-warning'}`}>
                          {c.authType === 'none' ? 'Public' : c.hasToken ? 'Token stored' : 'No token'}
                        </span>
                        <span className={`sp-lozenge ${approved ? 'sp-lozenge-success' : 'sp-lozenge-warning'}`}>{approved ? 'Host approved' : 'Host not approved'}</span>
                        {!approved ? (
                          <Button
                            compact
                            onClick={() => {
                              const origin = originOf(c.apiBaseUrl);
                              if (origin) {
                                approveHosts('git', [origin])
                                  .then(loadHosts)
                                  .catch((err) => setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Not approved.' }));
                              }
                            }}
                          >
                            Approve host
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="sp-row sp-row-nowrap">
                        <Button compact onClick={() => setTesting(testing === c.id ? undefined : c.id)}>
                          Test
                        </Button>
                        <Button compact onClick={() => setDraft(toDraft(c))}>
                          Edit
                        </Button>
                        <Button compact appearance="subtle" onClick={() => void remove(c)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : !draft ? (
          <span className="sp-help">No connections yet.</span>
        ) : null}
      </section>

      <section className="sp-card sp-stack" aria-labelledby="hosts-heading">
        <h2 id="hosts-heading">Approved hosts</h2>
        <p className="sp-muted">
          SpecPage can only contact hosts you approve here. Atlassian asks you to confirm each change, and you can review or revoke them at any time in Atlassian Administration → Connected apps.
        </p>
        {hostsError ? <Message appearance="warning">{hostsError}</Message> : null}
        <div className="sp-host-grid">
          {(Object.keys(GROUP_INFO) as EgressGroup[]).map((g) => (
            <HostList key={g} group={g} hosts={hosts[g]} onChange={loadHosts} />
          ))}
        </div>
      </section>
    </main>
  );
}

void mount(<AdminApp />);
