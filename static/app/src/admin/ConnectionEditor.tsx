import { useState } from 'react';
import { PROVIDERS } from '../../../../src/shared/git';
import type { AppError, GitAuthType, GitConnection, GitConnectionInput, GitProvider } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { Button, ErrorMessage, Field, splitList } from '../components/ui';
import { useT } from '../i18n';
import { AUTH_OPTIONS, type Draft } from './logic';

const API_URL_HELP: Partial<Record<GitProvider, string>> = {
  github: 'ui.admin.apiUrlGithubHelp',
  gitlab: 'ui.admin.apiUrlGitlabHelp',
  swaggerhub: 'ui.admin.apiUrlSwaggerhubHelp',
};

export function ConnectionEditor({
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

  const apiHelpKey = API_URL_HELP[draft.provider];
  const apiHelp = apiHelpKey ? t(apiHelpKey) : undefined;

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
