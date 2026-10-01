/**
 * A spec source knows how to read the root document and any files it
 * references through relative `$ref`s.
 */
export interface SpecSource {
  /** Human-readable description, e.g. "acme/payments-api@main:openapi.yaml". */
  label: string;
  /** Web link to view the source, if one exists. */
  link?: string;
  /** Cache key material; undefined means the result must not be cached (permission-sensitive). */
  cacheKey?: string;
  /** Absolute URL of the root document used as the base for resolving `$ref`s. */
  baseUrl: string;
  /** Read a document by absolute URL (root or referenced). */
  read(url: string): Promise<string>;
}

/** Reserved TLD (RFC 2606) used for synthetic base URLs of non-HTTP sources. */
export const SYNTHETIC_TLD = '.specpage.invalid';

export const isSyntheticUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname.endsWith(SYNTHETIC_TLD);
  } catch {
    return false;
  }
};

/** Decode the path portion of a synthetic URL into a slash-separated relative path. */
export function syntheticPath(url: string): string {
  const { pathname } = new URL(url);
  return pathname
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
    .join('/');
}

export function syntheticUrl(host: string, path: string): string {
  return `https://${host}${SYNTHETIC_TLD}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
