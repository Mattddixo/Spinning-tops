import { matchConnection, parseGitFileLink, PROVIDERS } from '../../../../src/shared/git';
import type { ConnectionOption, MacroConfig } from '../../../../src/shared/types';
import { Button, Field, Message } from '../components/ui';
import { useT } from '../i18n';

/** Git / SwaggerHub source fields, including "paste a link" to fill them in. */
export function GitSource({
  config,
  update,
  connections,
  gitLink,
  setGitLink,
  gitLinkError,
  setGitLinkError,
}: {
  config: MacroConfig;
  update: (patch: Partial<MacroConfig>) => void;
  connections: ConnectionOption[];
  gitLink: string;
  setGitLink: (value: string) => void;
  gitLinkError: string | undefined;
  setGitLinkError: (value: string | undefined) => void;
}) {
  const t = useT();
  const selectedConnection = connections.find((c) => c.id === config.gitConnectionId);

  const applyGitLink = () => {
    const parsed = parseGitFileLink(gitLink);
    if (!parsed) {
      setGitLinkError(t('ui.config.pasteLinkInvalid'));
      return;
    }
    const match = matchConnection(parsed, connections);
    setGitLinkError(match ? undefined : t('ui.config.pasteLinkNoConnection', { provider: t(`ui.provider.${parsed.provider}`) }));
    update({
      gitConnectionId: match?.id ?? config?.gitConnectionId,
      gitRepo: parsed.repo,
      gitRef: parsed.ref || undefined,
      gitPath: parsed.path || undefined,
    });
  };

  return connections.length === 0 ? (
    <Message appearance="warning" title={t('ui.config.noConnectionsTitle')}>
      {t('ui.config.noConnectionsBody')}
    </Message>
  ) : (
    <div className="sp-stack">
      <div className="sp-row sp-row-bottom">
        <div className="sp-grow">
          <Field label={t('ui.config.pasteLink')} error={gitLinkError}>
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
          {t('ui.config.fillIn')}
        </Button>
      </div>
      <Field label={t('ui.config.connection')}>
        {(id) => (
          <select id={id} className="sp-select" value={config.gitConnectionId ?? ''} onChange={(e) => update({ gitConnectionId: e.target.value || undefined })}>
            <option value="">{t('ui.config.selectConnection')}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({t(`ui.provider.${c.provider}`)})
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label={t('ui.config.repository')}
        help={selectedConnection ? t('ui.config.allowedRepos', { repos: selectedConnection.repos.join(', ') }) : undefined}
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
      {selectedConnection?.provider === 'swaggerhub' ? (
        <Field label={t('ui.config.version')} help={t('ui.config.versionHelp')}>
          {(id, describedBy) => (
            <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="1.0.0" value={config.gitRef ?? ''} onChange={(e) => update({ gitRef: e.target.value })} />
          )}
        </Field>
      ) : (
        <>
          <div className="sp-grid-2">
            <Field
              label={t('ui.config.ref')}
              help={selectedConnection?.defaultRef ? t('ui.config.refDefault', { ref: selectedConnection.defaultRef }) : t('ui.config.refHelp')}
            >
              {(id, describedBy) => (
                <input id={id} aria-describedby={describedBy} className="sp-input" placeholder="main" value={config.gitRef ?? ''} onChange={(e) => update({ gitRef: e.target.value })} />
              )}
            </Field>
            <Field label={t('ui.config.filePath')}>
              {(id) => (
                <input id={id} className="sp-input" placeholder="api/openapi.yaml" value={config.gitPath ?? ''} onChange={(e) => update({ gitPath: e.target.value })} />
              )}
            </Field>
          </div>
          <span className="sp-help">{t('ui.config.gitRefsHelp')}</span>
        </>
      )}
    </div>
  );
}
