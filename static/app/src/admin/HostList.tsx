import { useState } from 'react';
import { Button } from '../components/ui';
import { useT } from '../i18n';
import { hostErrorString } from './logic';
import { approveHosts, GROUP_INFO, MAX_DOMAINS_PER_GROUP, normaliseHost, removeHost, type EgressGroup, recordHostChange } from './egress';

export function HostList({ group, hosts, onChange }: { group: EgressGroup; hosts: string[]; onChange: () => Promise<void> }) {
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
