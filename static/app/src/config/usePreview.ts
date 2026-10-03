import { useEffect, useRef, useState } from 'react';
import { appError } from '../../../../src/shared/messages';
import type { AppError, LoadSpecResponse, MacroConfig } from '../../../../src/shared/types';
import { call, invoke, RequestFailed, toAppError } from '../api';
import { decodeSpec } from '../spec-transport';
import { cleanConfig, sourceKey } from './logic';

export type Preview =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: AppError }
  | { status: 'ready'; data: LoadSpecResponse; spec: Record<string, unknown> };

/**
 * Live preview for the settings dialog: reloads 600 ms after the source
 * settings stop changing, and when `previewNonce` changes (an attachment was
 * uploaded or edited).
 */
export function usePreview(config: MacroConfig | undefined, sourceError: string | undefined, previewNonce: number): Preview {
  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  // The preview skips the cache for its first load (so editors see the latest
  // version when they open the dialog) and after an attachment changes, but
  // not on every edit: that would refetch from Git each time and could use up
  // a provider's rate limit.
  const refreshedFor = useRef<number | undefined>(undefined);
  const previewSeq = useRef(0);
  // the preview effect only re-runs on source changes, so read config from a ref
  const configRef = useRef<MacroConfig | undefined>(undefined);
  configRef.current = config;
  const currentSourceKey = config ? sourceKey(config) : '';

  useEffect(() => {
    const current = configRef.current;
    if (!current || sourceError) {
      setPreview({ status: 'idle' });
      return;
    }
    const seq = ++previewSeq.current;
    setPreview({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const refresh = refreshedFor.current !== previewNonce;
        refreshedFor.current = previewNonce;
        const data = await call(invoke('loadSpec', { preview: cleanConfig(current), ...(refresh ? { refresh: true } : {}) }));
        const spec = await decodeSpec(data.specGz).catch((err: unknown) => {
          throw new RequestFailed(appError('INTERNAL', 'ui.macro.decodeFailed', undefined, { detail: err instanceof Error ? err.message : String(err) }));
        });
        if (seq === previewSeq.current) setPreview({ status: 'ready', data, spec });
      } catch (err) {
        if (seq === previewSeq.current) setPreview({ status: 'error', error: toAppError(err) });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [currentSourceKey, sourceError, previewNonce]);

  return preview;
}
