import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { codeSamples } from '../../../../src/shared/samples';
import type { SpecKind } from '../../../../src/shared/types';
import { useT } from '../i18n';

// The chosen language is shared by every operation on the page and kept for
// next time. Storage can be unavailable in sandboxed iframes, so it's optional.
const STORAGE_KEY = 'specpage.sampleLanguage';
const listeners = new Set<() => void>();
let chosen: string | undefined = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
})();

function choose(id: string) {
  chosen = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // not persisted; fine
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function CodeSamples({ spec, kind, path, method }: { spec: Record<string, unknown>; kind: SpecKind; path: string; method: string }) {
  const t = useT();
  const samples = useMemo(() => codeSamples(spec, kind, path, method), [spec, kind, path, method]);
  const preferred = useSyncExternalStore(subscribe, () => chosen);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  if (!samples.length) return null;
  // Remember by label so "Python" carries across operations even when a spec sample sits before it.
  const active = samples.find((s) => s.label === preferred) ?? samples[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked in the Confluence iframe; select the text instead.
      const node = codeRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  return (
    <div className="sp-samples">
      <div className="sp-samples-head">
        <h4>{t('ui.samples.title')}</h4>
        <div className="sp-samples-tabs" role="tablist" aria-label={t('ui.samples.title')}>
          {samples.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === active.id} className="sp-samples-tab" onClick={() => choose(s.label)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="sp-samples-copy" onClick={() => void copy()}>
          {copied ? t('ui.samples.copied') : t('ui.samples.copy')}
        </button>
      </div>
      <pre className="sp-samples-code" role="tabpanel">
        <code ref={codeRef}>{active.code}</code>
      </pre>
      {!active.fromSpec ? <p className="sp-samples-note">{t('ui.samples.generated')}</p> : null}
    </div>
  );
}
