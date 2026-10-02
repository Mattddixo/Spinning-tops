import { i18n } from '@forge/bridge';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from '../../../locales/en-US.json';
import { createTranslate, type Catalog, type Params, type Translate } from '../../../src/shared/i18n';
import type { AppError, Notice } from '../../../src/shared/types';

// English ships with the bundle so text is right even before (or without)
// Forge returning the user's catalog.
const english = en as Catalog;

interface I18nValue {
  t: Translate;
  locale: string;
}

const I18nContext = createContext<I18nValue>({ t: createTranslate(english), locale: 'en-US' });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ catalog: Catalog | null; locale: string }>({ catalog: null, locale: 'en-US' });

  useEffect(() => {
    let cancelled = false;
    i18n
      .getTranslations()
      .then((res) => {
        if (!cancelled && res?.translations) setState({ catalog: res.translations as Catalog, locale: res.locale ?? 'en-US' });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ t: createTranslate(state.catalog, english), locale: state.locale }), [state]);
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
