import type { DocExpansion, MacroConfig } from '../../../../src/shared/types';
import { Field, splitList, Toggle } from '../components/ui';
import { useT } from '../i18n';

/** The Display tab: title, tag/path filters, layout and Try it out. */
export function DisplaySettings({
  config,
  update,
  tags,
  filteredCount,
  totalCount,
  tryItOutEnabled,
  serverUrlError,
}: {
  config: MacroConfig;
  update: (patch: Partial<MacroConfig>) => void;
  tags: string[];
  /** Operations left after the filters, and in total; undefined until the preview loads. */
  filteredCount: number | undefined;
  totalCount: number | undefined;
  tryItOutEnabled: boolean;
  serverUrlError: string | undefined;
}) {
  const t = useT();
  return (
    <div className="sp-stack">
      <Field label={t('ui.config.title')} help={t('ui.config.titleHelp')}>
        {(id, describedBy) => (
          <input id={id} aria-describedby={describedBy} className="sp-input" value={config.title ?? ''} onChange={(e) => update({ title: e.target.value })} />
        )}
      </Field>

      <fieldset className="sp-fieldset">
        <legend className="sp-label">{t('ui.config.tagsLegend')}</legend>
        {tags.length ? (
          <div className="sp-tag-list">
            {tags.map((tag) => (
              <label key={tag} className="sp-checkbox">
                <input
                  type="checkbox"
                  checked={config.includeTags?.includes(tag) ?? false}
                  onChange={(e) =>
                    update({
                      includeTags: e.target.checked ? [...(config.includeTags ?? []), tag] : (config.includeTags ?? []).filter((x) => x !== tag),
                    })
                  }
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
        ) : (
          <span className="sp-help">{t('ui.config.tagsEmpty')}</span>
        )}
      </fieldset>

      <Field label={t('ui.config.paths')} help={t('ui.config.pathsHelp')}>
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            className="sp-input sp-input-short"
            rows={3}
            value={(config.includePaths ?? []).join('\n')}
            onChange={(e) => update({ includePaths: splitList(e.target.value) })}
          />
        )}
      </Field>

      {filteredCount !== undefined && totalCount !== undefined ? (
        <span className="sp-help">{t('ui.config.showingCount', { shown: filteredCount, total: totalCount })}</span>
      ) : null}

      <div className="sp-grid-2">
        <Field label={t('ui.config.expand')}>
          {(id) => (
            <select id={id} className="sp-select" value={config.docExpansion ?? 'list'} onChange={(e) => update({ docExpansion: e.target.value as DocExpansion })}>
              <option value="list">{t('ui.config.expandList')}</option>
              <option value="full">{t('ui.config.expandFull')}</option>
              <option value="none">{t('ui.config.expandNone')}</option>
            </select>
          )}
        </Field>
        <Field label={t('ui.config.maxHeight')}>
          {(id) => (
            <select id={id} className="sp-select" value={String(config.maxHeight ?? 0)} onChange={(e) => update({ maxHeight: Number(e.target.value) })}>
              <option value="0">{t('ui.config.maxHeightAuto')}</option>
              {[400, 600, 800, 1200].map((px) => (
                <option key={px} value={String(px)}>
                  {t('ui.config.maxHeightPx', { px })}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Toggle label={t('ui.config.showInfo')} checked={config.showInfo !== false} onChange={(v) => update({ showInfo: v })} />
      <Toggle label={t('ui.config.showServers')} checked={config.showServers !== false} onChange={(v) => update({ showServers: v })} />
      <Toggle label={t('ui.config.showModels')} checked={config.showModels !== false} onChange={(v) => update({ showModels: v })} />
      <Toggle label={t('ui.config.showFilter')} checked={config.showFilter === true} onChange={(v) => update({ showFilter: v })} />
      <Toggle label={t('ui.config.showCodeSamples')} checked={config.showCodeSamples !== false} onChange={(v) => update({ showCodeSamples: v })} help={t('ui.config.showCodeSamplesHelp')} />
      <Toggle label={t('ui.config.hideDeprecated')} checked={config.hideDeprecated === true} onChange={(v) => update({ hideDeprecated: v })} />
      <Toggle
        label={t('ui.config.tryItOut')}
        checked={config.tryItOut === true}
        disabled={!tryItOutEnabled}
        onChange={(v) => update({ tryItOut: v })}
        help={tryItOutEnabled ? t('ui.config.tryItOutHelp') : t('ui.config.tryItOutOff')}
      />
      {config.tryItOut === true || config.serverUrl ? (
        <Field label={t('ui.config.serverUrl')} help={t('ui.config.serverUrlHelp')} error={serverUrlError}>
          {(id, describedBy) => (
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={serverUrlError ? true : undefined}
              className="sp-input"
              placeholder="https://staging.api.example.com/v1"
              value={config.serverUrl ?? ''}
              onChange={(e) => update({ serverUrl: e.target.value })}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}
