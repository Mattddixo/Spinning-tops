export interface SpecSource {
  label: string;
  link?: string;
  // undefined = don't cache
  cacheKey?: string;
  // base for resolving relative $refs
  baseUrl: string;
  read(url: string): Promise<string>;
}

// .invalid is reserved (RFC 2606), so these fake base URLs can't hit a real host.
export const SYNTHETIC_TLD = '.specpage.invalid';

export const isSyntheticUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname.endsWith(SYNTHETIC_TLD);
  } catch {
    return false;
  }
};

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
