import type { MacroConfig } from '../../../../src/shared/types';
import { SpecView } from '../components/SpecView';
import { ErrorMessage, Loading, Message } from '../components/ui';
import { KIND_LABELS } from '../format';
import { noticeText, useT } from '../i18n';
import { cleanConfig } from './logic';
import type { Preview } from './usePreview';

/** The live preview beside the settings form. */
export function PreviewPanel({
  preview,
  config,
  sourceError,
  tryItOutAllowed,
}: {
  preview: Preview;
  config: MacroConfig;
  sourceError: string | undefined;
  tryItOutAllowed: boolean;
}) {
  const t = useT();
  return (
    <section className="sp-config-preview" aria-label={t('ui.config.preview')}>
      <div className="sp-row">
        <h2>{t('ui.config.preview')}</h2>
        {preview.status === 'ready' ? (
          <>
            <span className="sp-lozenge">{KIND_LABELS[preview.data.summary.kind]}</span>
            <span className="sp-small">{config.sourceType === 'inline' ? t('ui.macro.pastedSpec') : preview.data.meta.sourceLabel}</span>
          </>
        ) : null}
      </div>
      {preview.status === 'idle' ? <Message>{sourceError ?? t('ui.config.previewChooseSource')}</Message> : null}
      {preview.status === 'loading' ? <Loading label={t('ui.config.previewLoading')} /> : null}
      {preview.status === 'error' ? <ErrorMessage error={preview.error} /> : null}
      {preview.status === 'ready' ? (
        <>
          {preview.data.meta.warnings
            // Worked out here rather than trusted from the backend: the editor
            // may have toggled Try it out or typed a server URL since it loaded.
            .filter((w) => w.key !== 'warnings.relativeServers')
            .map((w) => (
              <Message key={w.key}>{noticeText(t, w)}</Message>
            ))}
          {!preview.data.meta.serversResolvable && config.tryItOut === true && !config.serverUrl?.trim() ? (
            <Message appearance="warning">{t('warnings.relativeServers')}</Message>
          ) : null}
          <SpecView kind={preview.data.summary.kind} spec={preview.spec} config={config} tryItOutAllowed={tryItOutAllowed} preview={cleanConfig(config)} />
        </>
      ) : null}
    </section>
  );
}
