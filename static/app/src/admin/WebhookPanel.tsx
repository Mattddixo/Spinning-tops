import { useEffect, useState } from 'react';
import type { AppError, GitConnection } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { Button, ErrorMessage, Field } from '../components/ui';
import { useT } from '../i18n';

export function WebhookPanel({ connection, onChange }: { connection: GitConnection; onChange: (c: GitConnection) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [url, setUrl] = useState<string>();
  // Only set right after turning on or making a new secret; it can't be read back later.
  const [secret, setSecret] = useState<string>();

  useEffect(() => {
    if (!connection.webhookEnabled || url) return;
    call(invoke('adminGetWebhookUrl', { id: connection.id }))
      .then((r) => setUrl(r.url))
      .catch((err) => setError(toAppError(err)));
  }, [connection.id, connection.webhookEnabled, url]);

  const act = async (body: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await body();
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(false);
    }
  };
  const enable = () =>
    act(async () => {
      const r = await call(invoke('adminEnableWebhook', { id: connection.id }));
      setUrl(r.url);
      setSecret(r.secret);
      onChange(r.connection);
    });
  const disable = () =>
    act(async () => {
      onChange(await call(invoke('adminDisableWebhook', { id: connection.id })));
      setUrl(undefined);
      setSecret(undefined);
    });

  return (
    <div className="sp-test sp-stack-tight">
      <span className="sp-help">{t('ui.admin.webhookIntro')}</span>
      {connection.webhookEnabled && url ? (
        <>
          <Field label={t('ui.admin.webhookUrl')}>{(id) => <input id={id} className="sp-input" readOnly value={url} onFocus={(e) => e.target.select()} />}</Field>
          {secret ? (
            <Field label={t('ui.admin.webhookSecret')} help={t('ui.admin.webhookSecretOnce')}>
              {(id, describedBy) => <input id={id} className="sp-input" readOnly value={secret} aria-describedby={describedBy} onFocus={(e) => e.target.select()} />}
            </Field>
          ) : null}
          <span className="sp-help">{t(`ui.provider.${connection.provider}Webhook`)}</span>
        </>
      ) : null}
      <div className="sp-row">
        <Button compact appearance={connection.webhookEnabled ? 'default' : 'primary'} onClick={() => void enable()} disabled={busy}>
          {connection.webhookEnabled ? t('ui.admin.webhookNewSecret') : t('ui.admin.webhookTurnOn')}
        </Button>
        {connection.webhookEnabled ? (
          <Button compact appearance="subtle" onClick={() => void disable()} disabled={busy}>
            {t('ui.admin.webhookTurnOff')}
          </Button>
        ) : null}
      </div>
      {error ? <ErrorMessage error={error} /> : null}
    </div>
  );
}
