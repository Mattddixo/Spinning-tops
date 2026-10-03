import { useState } from 'react';
import type { AppSettings } from '../../../../src/shared/types';
import { call, invoke } from '../api';
import { Button, Field, Toggle } from '../components/ui';
import { useT } from '../i18n';
import { errorString, type Status } from './logic';

const CACHE_OPTIONS = [0, 5, 10, 30, 60, 360, 1440];

export function GeneralSettings({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
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
