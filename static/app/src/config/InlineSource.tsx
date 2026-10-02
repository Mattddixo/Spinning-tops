import { lazy, Suspense, useState } from 'react';
import type { AppError, MacroConfig } from '../../../../src/shared/types';
import { appError } from '../../../../src/shared/messages';
import { toAppError } from '../api';
import { textFile, uploadAttachment, validFilename } from '../attachments';
import { Button, ErrorMessage, Loading } from '../components/ui';
import { toLanguageTag } from '../format';
import { useI18n } from '../i18n';

const SpecEditor = lazy(() => import('../components/SpecEditor'));

export const MAX_INLINE = 100_000;

interface Props {
  config: MacroConfig;
  update: (patch: Partial<MacroConfig>) => void;
  contentId?: string;
  existing: string[];
  /** After converting to an attachment, refresh the dialog's attachment list. */
  onConverted: () => Promise<unknown>;
}

const defaultName = (text: string) => (/^\s*[{[]/.test(text) ? 'openapi.json' : 'openapi.yaml');

export function InlineSource({ config, update, contentId, existing, onConverted }: Props) {
  const { t, locale } = useI18n();
  const text = config.inlineSpec ?? '';
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const name = filename.trim() || defaultName(text);
  const fmt = (n: number) => n.toLocaleString(toLanguageTag(locale));

  // Pasted specs live in the macro settings. Saving them as an attachment
  // lifts the size limit and gives them version history.
  const convert = async () => {
    if (!contentId || !text.trim()) return;
    if (!validFilename(name)) {
      setError(appError('BAD_REQUEST', 'errors.attachmentNotChosen'));
      return;
    }
    if (existing.includes(name) && !window.confirm(t('ui.config.uploadReplaceConfirm', { name }))) return;
    setBusy(true);
    setError(undefined);
    try {
      const uploaded = await uploadAttachment(contentId, textFile(name, text), t('ui.config.uploadComment'));
      await onConverted();
      update({ sourceType: 'attachment', attachment: uploaded.title, inlineSpec: undefined });
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-stack-tight">
      <span className="sp-label" id="sp-inline-label">
        {t('ui.config.inlineLabel')}
      </span>
      <Suspense fallback={<Loading />}>
        <SpecEditor value={text} onChange={(value) => update({ inlineSpec: value })} label={t('ui.config.inlineLabel')} height="340px" describedBy="sp-inline-help" />
      </Suspense>
      <span id="sp-inline-help" className={text.length > MAX_INLINE ? 'sp-error-text' : 'sp-help'}>
        {t('ui.config.inlineHelp', { count: fmt(text.length), max: fmt(MAX_INLINE) })}
      </span>
      <div className="sp-row sp-row-nowrap">
        <input
          className="sp-input"
          aria-label={t('ui.config.saveAsFilename')}
          placeholder={defaultName(text)}
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
        />
        <Button onClick={() => void convert()} disabled={!contentId || !text.trim() || busy}>
          {busy ? t('ui.common.saving') : t('ui.config.saveAsAttachment')}
        </Button>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
    </div>
  );
}
