import en from '../../../../locales/en-US.json';
import { createTranslate, type Catalog } from '../../../../src/shared/i18n';

/** The shipped English catalog, so tests read like what users see. */
export const t = createTranslate(en as Catalog);
