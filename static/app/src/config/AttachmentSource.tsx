import { lazy, Suspense, useRef, useState } from 'react';
import type { AppError, AttachmentOption, MacroConfig } from '../../../../src/shared/types';
import { appError } from '../../../../src/shared/messages';
import { call, invoke, toAppError } from '../api';
import { textFile, uploadAttachment, validFilename } from '../attachments';
import { Button, ErrorMessage, Field, Loading, Message } from '../components/ui';
import { useT } from '../i18n';

const SpecEditor = lazy(() => import('../components/SpecEditor'));

interface Props {
  config: MacroConfig;
  update: (patch: Partial<MacroConfig>) => void;
  attachments?: AttachmentOption[];
  attachmentsError?: AppError;
  reload: () => Promise<AttachmentOption[] | undefined>;
  contentId?: string;
  /** Called after the selected file's content changed, so the preview reloads. */
  onFileChanged: () => void;
}

type Editing = { name: string; text: string; version?: number; original: string };

export function AttachmentSource({ config, update, attachments, attachmentsError, reload, contentId, onFileChanged }: Props) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'open' | 'save'>();
  const [error, setError] = useState<AppError>();
  const [notice, setNotice] = useState<string>();
  const [editing, setEditing] = useState<Editing>();
  // Second click on Save after a conflict warning overwrites anyway.
  const [overwrite, setOverwrite] = useState(false);

  const selected = attachments?.find((a) => a.title === config.attachment);
  const dirty = editing ? editing.text !== editing.original : false;

  const pick = (name: string | undefined) => {
    if (dirty && !window.confirm(t('ui.config.discardEdits'))) return;
    setEditing(undefined);
    setError(undefined);
    setNotice(undefined);
    update({ attachment: name });
  };

  const onUpload = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file || !contentId) return;
    setError(undefined);
    setNotice(undefined);
    if (!validFilename(file.name)) {
      setError(appError('BAD_REQUEST', 'errors.attachmentNotChosen'));
      return;
    }
    if (attachments?.some((a) => a.title === file.name) && !window.confirm(t('ui.config.uploadReplaceConfirm', { name: file.name }))) return;
    setBusy('upload');
    try {
      const uploaded = await uploadAttachment(contentId, file, t('ui.config.uploadComment'));
      await reload();
      setEditing(undefined);
      update({ attachment: uploaded.title });
      setNotice(t('ui.config.uploaded', { name: uploaded.title }));
      onFileChanged();
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(undefined);
    }
  };

  const openEditor = async () => {
    if (!config.attachment) return;
    setBusy('open');
    setError(undefined);
    setNotice(undefined);
    try {
      const { text, version } = await call(invoke('readAttachment', { filename: config.attachment }));
      setEditing({ name: config.attachment, text, version, original: text });
      setOverwrite(false);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    if (!editing || !contentId) return;
    setBusy('save');
    setError(undefined);
    setNotice(undefined);
    try {
      // Don't silently overwrite a version someone else saved meanwhile.
      const latest = (await reload())?.find((a) => a.title === editing.name)?.version;
      if (!overwrite && latest !== undefined && editing.version !== undefined && latest !== editing.version) {
        setError(appError('CONFLICT', 'errors.attachmentChanged', { name: editing.name, current: latest, edited: editing.version }));
        setOverwrite(true);
        return;
      }
      const uploaded = await uploadAttachment(contentId, textFile(editing.name, editing.text), t('ui.config.editComment'));
      await reload();
      setEditing({ ...editing, original: editing.text, version: uploaded.version });
      setOverwrite(false);
      setNotice(t('ui.config.savedVersion', { name: editing.name, version: uploaded.version ?? '?' }));
      onFileChanged();
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="sp-stack">
      {attachmentsError ? <ErrorMessage error={attachmentsError} /> : null}
      {attachments && attachments.length === 0 && !attachmentsError ? (
        <Message title={t('ui.config.noAttachmentsTitle')}>{t('ui.config.noAttachmentsBodyUpload')}</Message>
      ) : null}
      <div className="sp-row sp-row-bottom">
        <div className="sp-grow">
          <Field label={t('ui.config.attachment')}>
            {(id) => (
              <select id={id} className="sp-select" value={config.attachment ?? ''} onChange={(e) => pick(e.target.value || undefined)}>
                <option value="">{t('ui.config.selectFile')}</option>
                {config.attachment && !attachments?.some((a) => a.title === config.attachment) ? (
                  <option value={config.attachment}>{t('ui.config.notFoundSuffix', { name: config.attachment })}</option>
                ) : null}
                {attachments?.map((a) => (
                  <option key={a.title} value={a.title}>
                    {a.title}
                    {a.fileSize ? ` (${t('ui.common.kb', { size: Math.max(1, Math.round(a.fileSize / 1024)) })})` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Button onClick={() => void reload()}>{t('ui.config.refreshList')}</Button>
      </div>

      <div className="sp-row">
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml,.json"
          className="sp-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void onUpload(e.target.files?.[0])}
        />
        <Button onClick={() => fileInput.current?.click()} disabled={!contentId || busy !== undefined}>
          {busy === 'upload' ? t('ui.config.uploading') : t('ui.config.uploadFile')}
        </Button>
        {selected && !editing ? (
          <Button onClick={() => void openEditor()} disabled={busy !== undefined}>
            {busy === 'open' ? t('ui.common.loading') : t('ui.config.editFile')}
          </Button>
        ) : null}
      </div>

      {error ? (
        <ErrorMessage
          error={error}
          actions={
            error.key === 'errors.attachmentChanged' ? (
              <Button compact onClick={() => void openEditor()}>
                {t('ui.config.reloadFile')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {notice ? <Message appearance="success">{notice}</Message> : null}

      {editing ? (
        <div className="sp-stack-tight">
          <Suspense fallback={<Loading />}>
            <SpecEditor value={editing.text} onChange={(text) => setEditing((e) => e && { ...e, text })} label={t('ui.config.editorLabel', { name: editing.name })} height="360px" />
          </Suspense>
          <div className="sp-row">
            <Button appearance="primary" onClick={() => void save()} disabled={!dirty || busy !== undefined}>
              {busy === 'save' ? t('ui.common.saving') : overwrite ? t('ui.config.saveAnyway') : t('ui.config.saveVersion')}
            </Button>
            <Button
              appearance="subtle"
              onClick={() => {
                if (dirty && !window.confirm(t('ui.config.discardEdits'))) return;
                setEditing(undefined);
                setError(undefined);
              }}
              disabled={busy !== undefined}
            >
              {t('ui.config.closeEditor')}
            </Button>
            <span className="sp-help">{t('ui.config.editHelp')}</span>
          </div>
        </div>
      ) : (
        <span className="sp-help">{t('ui.config.attachmentRefsHelp')}</span>
      )}
    </div>
  );
}
