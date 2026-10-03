import { useMemo } from 'react';
import { hostCovered } from '../../../../src/shared/git';
import type { MacroConfig } from '../../../../src/shared/types';
import { Field, Message } from '../components/ui';
import { useT } from '../i18n';

/** URL source fields, with a warning when the host isn't on the approved spec hosts list. */
export function UrlSource({
  config,
  update,
  approvedHosts,
}: {
  config: MacroConfig;
  update: (patch: Partial<MacroConfig>) => void;
  approvedHosts: string[] | undefined;
}) {
  const t = useT();
  const urlHostApproved = useMemo(() => {
    if (config?.sourceType !== 'url' || !approvedHosts) return true;
    try {
      new URL(config.url ?? '');
    } catch {
      return true; // the field shows its own "invalid URL" message
    }
    return hostCovered(config.url ?? '', approvedHosts);
  }, [config?.sourceType, config?.url, approvedHosts]);

  return (
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
  );
}
