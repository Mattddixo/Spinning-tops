import { useCallback, useEffect, useState } from 'react';
import { hostCovered, originOf } from '../../../../src/shared/git';
import type { AppError, AppSettings, GitConnection } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { mount } from '../bootstrap';
import { Button, ErrorMessage, Loading, Message } from '../components/ui';
import { useT } from '../i18n';
import { emptyDraft, errorString, hostErrorString, toDraft, type Draft, type Status } from './logic';
import { approveHosts, getApprovedHosts, GROUP_INFO, type EgressGroup, recordHostChange } from './egress';
import { GeneralSettings } from './GeneralSettings';
import { HostList } from './HostList';
import { ConnectionEditor } from './ConnectionEditor';
import { TestConnection } from './TestConnection';
import { WebhookPanel } from './WebhookPanel';
import { Activity } from './Activity';
import '../styles/admin.css';

function AdminApp() {
  const t = useT();
  const [state, setState] = useState<{ settings: AppSettings; connections: GitConnection[] }>();
  const [error, setError] = useState<AppError>();
  const [hosts, setHosts] = useState<Record<EgressGroup, string[]>>();
  const [hostsError, setHostsError] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [testing, setTesting] = useState<string>();
  const [webhookFor, setWebhookFor] = useState<string>();
  const [notice, setNotice] = useState<Status>();
  // Bumped after each change so the activity log reloads.
  const [activityKey, setActivityKey] = useState(0);
  const changed = () => setActivityKey((k) => k + 1);

  const loadHosts = useCallback(async () => {
    try {
      const approved = await getApprovedHosts();
      setHosts(approved);
      setHostsError(undefined);
      // Give the backend a copy, so each list only works for its own purpose
      // (Try it out hosts for Try it out, spec hosts for spec URLs). Only after
      // a successful load: a failed one must not clear the copy.
      call(invoke('adminSyncHosts', { hosts: approved })).catch(() => setHostsError('sync-failed'));
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
    if (origin && hosts && !hostCovered(origin, hosts.git)) {
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
                const approved = Boolean(origin) && hostCovered(origin as string, hosts.git);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="sp-small">{t(`ui.provider.${c.provider}`)}</div>
                      {testing === c.id ? <TestConnection connection={c} /> : null}
                      {webhookFor === c.id ? (
                        <WebhookPanel
                          connection={c}
                          onChange={(updated) => setState((s) => (s ? { ...s, connections: s.connections.map((x) => (x.id === updated.id ? updated : x)) } : s))}
                        />
                      ) : null}
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
                        {c.webhookEnabled ? <span className="sp-lozenge sp-lozenge-success">{t('ui.admin.statusWebhook')}</span> : null}
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
                        {c.provider !== 'swaggerhub' ? (
                          <Button compact onClick={() => setWebhookFor(webhookFor === c.id ? undefined : c.id)} aria-expanded={webhookFor === c.id}>
                            {t('ui.admin.webhook')}
                          </Button>
                        ) : null}
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
        <p className="sp-muted">{t('ui.admin.hostsListsNote')}</p>
        {hostsError ? (
          <Message appearance="warning">
            {hostsError === 'sync-failed'
              ? t('ui.admin.hostsSyncFailed')
              : hostsError === 'load-failed'
                ? t('ui.admin.hostsLoadFailed')
                : `${t('ui.admin.hostsLoadFailed')} ${hostsError}`}
          </Message>
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
