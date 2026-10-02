// Tiny translation helpers shared by backend and UI. Catalogs live in /locales
// (registered in manifest.yml under `translations`). Keys are dotted paths,
// placeholders look like {name}.

export type Catalog = { [key: string]: string | Catalog };
export type Params = Record<string, string | number | undefined>;

export function lookup(catalog: Catalog | null | undefined, key: string): string | undefined {
  if (!catalog) return undefined;
  // Forge allows both "a.b" flat keys and nested objects; flat wins.
  const flat = catalog[key];
  if (typeof flat === 'string') return flat;
  let node: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export type Translate = (key: string, params?: Params) => string;

/** Look in each catalog in order, then fall back to the key itself. */
export function createTranslate(...catalogs: Array<Catalog | null | undefined>): Translate {
  return (key, params) => {
    for (const catalog of catalogs) {
      const hit = lookup(catalog, key);
      if (hit !== undefined) return format(hit, params);
    }
    return key;
  };
}
