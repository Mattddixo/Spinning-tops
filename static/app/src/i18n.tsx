import { createContext, useContext, type ReactNode } from 'react';
import en from '../../../locales/en-US.json';
import { createTranslate, type Catalog, type Params, type Translate } from '../../../src/shared/i18n';
import type { AppError, Notice } from '../../../src/shared/types';

// All UI text lives in locales/en-US.json and is looked up by key. Only English
// ships for now; adding a language means loading another catalog here (and
// registering it under `translations` in manifest.yml).
interface I18nValue {
  t: Translate;
  /** Used for number and date formatting only. */
  locale: string;
}

const value: I18nValue = {
  t: createTranslate(en as Catalog),
  locale: typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US',
};

const I18nContext = createContext<I18nValue>(value);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;

/** Prefer the catalog text for a backend message, fall back to the English it shipped with. */
export function translateMessage(t: Translate, key: string | undefined, params: Params | undefined, fallback: string): string {
  if (!key) return fallback;
  const text = t(key, params);
  return text === key ? fallback : text;
}

export function errorText(t: Translate, error: AppError): { title: string; hint?: string } {
  return {
    title: translateMessage(t, error.key, error.params, error.message),
    hint: error.hintKey ? translateMessage(t, error.hintKey, error.hintParams, error.hint ?? '') : error.hint,
  };
}

export const noticeText = (t: Translate, n: Notice) => translateMessage(t, n.key, n.params, n.message);
