import { useState, type FormEvent } from 'react';
import type { Translate } from '../../../../src/shared/i18n';
import type { AppError, ChangeLevel, CompareResponse, CompareTarget, SpecChange } from '../../../../src/shared/types';
import { call, invoke, toAppError } from '../api';
import { downloadText, slugify } from '../format';
import { useT } from '../i18n';
import { Button, ErrorMessage, Field, Message } from './ui';

const LEVELS: ChangeLevel[] = ['breaking', 'warning', 'info'];

function levelHeading(t: Translate, level: ChangeLevel): string {
  if (level === 'breaking') return t('ui.changes.breaking');
  if (level === 'warning') return t('ui.changes.warning');
  return t('ui.changes.info');
}

function countText(t: Translate, level: ChangeLevel, count: number): string {
  if (level === 'breaking') return t('ui.changes.countBreaking', { count });
  if (level === 'warning') return t('ui.changes.countWarning', { count });
  return t('ui.changes.countInfo', { count });
}

export const changeText = (t: Translate, c: SpecChange) => t(`changes.${c.code}`, c.params);

/** "request body · items[].name", "response 200", "limit (query)" */
export function changeWhere(t: Translate, c: SpecChange): string {
  const section = c.section === 'requestBody' ? t('ui.changes.requestBody') : c.section === 'response' ? t('ui.changes.response', { status: c.status ?? '' }) : '';
  return [section, c.location].filter(Boolean).join(' · ');
}

const sideLabel = (label: string, version: string) => (version ? `${label} (v${version})` : label);

// Markdown for release notes. Spec text goes in code spans, with backticks
// stripped so a property name can't break out of them.
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

export function changesMarkdown(t: Translate, result: CompareResponse): string {
  const base = sideLabel(result.baseLabel, result.baseVersion);
  const head = sideLabel(result.headLabel, result.headVersion);
  const lines = [`# ${t('ui.changes.reportTitle', { base, head })}`, ''];
  if (!result.changes.length) lines.push(t('ui.changes.none'), '');
  for (const level of LEVELS) {
    const items = result.changes.filter((c) => c.level === level);
    if (!items.length) continue;
    lines.push(`## ${levelHeading(t, level)} (${items.length})`, '');
    for (const c of items) {
      const where = changeWhere(t, c);
      lines.push(`- ${c.operation ? `${code(c.operation)} ` : ''}${changeText(t, c)}${where ? `: ${code(where)}` : ''}`);
    }
    lines.push('');
  }
  if (result.truncated) lines.push(`_${t('ui.changes.truncated')}_`, '');
  return lines.join('\n');
}

export function ChangesPanel({ sourceType, onClose }: { sourceType: 'git' | 'attachment'; onClose: () => void }) {
  const t = useT();
  const [ref, setRef] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const [result, setResult] = useState<CompareResponse>();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const target: CompareTarget = sourceType === 'git' ? { gitRef: ref.trim() } : version.trim() ? { attachmentVersion: Number(version) } : {};
    setBusy(true);
    setError(undefined);
    try {
      setResult(await call(invoke('compareSpec', { target })));
    } catch (err) {
      setResult(undefined);
      setError(toAppError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sp-changes" aria-label={t('ui.changes.title')}>
      <div className="sp-row sp-changes-head">
        <h3>{t('ui.changes.title')}</h3>
        <Button compact appearance="subtle" onClick={onClose}>
          {t('ui.changes.close')}
        </Button>
      </div>
      <form className="sp-row sp-changes-form" onSubmit={onSubmit}>
        {sourceType === 'git' ? (
          <Field label={t('ui.changes.gitRef')} help={t('ui.changes.gitRefHelp')}>
            {(id, describedBy) => (
              <input id={id} className="sp-input" value={ref} onChange={(e) => setRef(e.target.value)} aria-describedby={describedBy} maxLength={250} required />
            )}
          </Field>
        ) : (
          <Field label={t('ui.changes.attachmentVersion')} help={t('ui.changes.attachmentVersionHelp')}>
            {(id, describedBy) => (
              <input id={id} className="sp-input" type="number" min={1} step={1} value={version} onChange={(e) => setVersion(e.target.value)} aria-describedby={describedBy} />
            )}
          </Field>
        )}
        <Button type="submit" appearance="primary" disabled={busy}>
          {busy ? t('ui.changes.comparing') : t('ui.changes.compare')}
        </Button>
      </form>

      {error ? <ErrorMessage error={error} /> : null}

      {result ? (
        <div className="sp-stack" aria-live="polite">
          <div className="sp-row sp-changes-summary">
            <strong>{t('ui.changes.summary', { base: sideLabel(result.baseLabel, result.baseVersion), head: sideLabel(result.headLabel, result.headVersion) })}</strong>
            {LEVELS.filter((l) => result.counts[l]).map((l) => (
              <span key={l} className={`sp-lozenge sp-change-${l}`}>
                {countText(t, l, result.counts[l])}
              </span>
            ))}
            <Button
              compact
              appearance="subtle"
              title={t('ui.changes.downloadTitle')}
              onClick={() => downloadText(`${slugify(result.headLabel)}-changes.md`, changesMarkdown(t, result), 'text/markdown')}
            >
              {t('ui.changes.download')}
            </Button>
          </div>
          {!result.changes.length ? <Message appearance="success">{t('ui.changes.none')}</Message> : null}
          {result.truncated ? <Message appearance="warning">{t('ui.changes.truncated')}</Message> : null}
          {LEVELS.map((level) => {
            const items = result.changes.filter((c) => c.level === level);
            if (!items.length) return null;
            return (
              <div key={level} className="sp-stack-tight">
                <h4>{levelHeading(t, level)}</h4>
                <ul className="sp-change-list">
                  {items.map((c, i) => {
                    const where = changeWhere(t, c);
                    return (
                      <li key={i} className={`sp-change sp-change-${level}`}>
                        {c.operation ? <code className="sp-change-op">{c.operation}</code> : null}
                        <span>{changeText(t, c)}</span>
                        {where ? <code className="sp-change-where">{where}</code> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
