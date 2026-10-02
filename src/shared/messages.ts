import en from '../../locales/en-US.json';
import { createTranslate, type Catalog, type Params } from './i18n';
import type { AppError, ErrorCode, MessageParams, Notice } from './types';

// English is the source of truth for text the backend sends. The UI re-renders
// it in the user's language from `key`/`params`.
export const english = createTranslate(en as Catalog);

const clean = (params?: Params): MessageParams | undefined => {
  if (!params) return undefined;
  const out: MessageParams = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v;
  return out;
};

export interface ErrorExtra {
  hint?: string;
  hintParams?: Params;
  detail?: string;
}

export function appError(code: ErrorCode, key: string, params?: Params, extra: ErrorExtra = {}): AppError {
  const error: AppError = { code, key, message: english(key, params) };
  const p = clean(params);
  if (p) error.params = p;
  if (extra.hint) {
    error.hintKey = extra.hint;
    error.hint = english(extra.hint, extra.hintParams);
    const hp = clean(extra.hintParams);
    if (hp) error.hintParams = hp;
  }
  if (extra.detail) error.detail = extra.detail;
  return error;
}

export function notice(key: string, params?: Params): Notice {
  const n: Notice = { key, message: english(key, params) };
  const p = clean(params);
  if (p) n.params = p;
  return n;
}
