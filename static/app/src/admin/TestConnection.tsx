import { useState } from 'react';
import { PROVIDERS, usesFilePath } from '../../../../src/shared/git';
import type { AppError, GitConnection } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { Button, ErrorMessage, Message } from '../components/ui';
import { useT } from '../i18n';

export function TestConnection({ connection }: { connection: GitConnection }) {
  const t = useT();
  const needsPath = usesFilePath(connection.provider);
  const [repo, setRepo] = useState(connection.repos.find((r) => !r.includes('*')) ?? '');
  const [path, setPath] = useState('openapi.yaml');
  const [ref, setRef] = useState(connection.defaultRef ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; text: string } | { ok: false; error: AppError }>();

  const run = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      const r = await call(invoke('adminTestConnection', { id: connection.id, repo, ref, ...(needsPath ? { path } : {}) }));
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
        <input
          className="sp-input"
          aria-label={needsPath ? t('ui.admin.testBranch') : t('ui.config.version')}
          placeholder={needsPath ? 'main' : '1.0.0'}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        {needsPath ? (
          <input className="sp-input" aria-label={t('ui.admin.testPath')} placeholder="openapi.yaml" value={path} onChange={(e) => setPath(e.target.value)} />
        ) : null}
        <Button onClick={() => void run()} disabled={busy || !repo || (needsPath && !path)}>
          {busy ? t('ui.common.testing') : t('ui.common.test')}
        </Button>
      </div>
      {result ? result.ok ? <Message appearance="success">{result.text}</Message> : <ErrorMessage error={result.error} /> : null}
    </div>
  );
}
