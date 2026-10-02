import type { AppSettings } from '../../shared/types';
import { fail } from '../errors';
import { externalFetch, upstreamError } from '../http';
import { MAX_SOURCE_BYTES, MB } from '../limits';
import type { SpecSource } from './types';

export function parseHttpsUrl(raw: string | undefined): URL {
  let url: URL;
  try {
    url = new URL((raw ?? '').trim());
  } catch {
    return fail('BAD_REQUEST', 'errors.urlInvalid');
  }
  if (url.protocol !== 'https:') fail('BAD_REQUEST', 'errors.urlNotHttps');
  if (url.username || url.password) fail('BAD_REQUEST', 'errors.urlHasCredentials');
  return url;
}

/** Read a document from a URL on an admin-approved host. */
export async function readUrl(raw: string): Promise<string> {
  const url = parseHttpsUrl(raw);
  const res = await externalFetch(url.toString(), { headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain;q=0.9, */*;q=0.5' } });
  if (res.status !== 200) upstreamError(url.host + url.pathname, res.status, res.statusText);
  if (res.truncated) fail('TOO_LARGE', 'errors.fileTooLarge', { name: url.host + url.pathname, size: MAX_SOURCE_BYTES / MB });
  return res.text;
}

export function urlSource(settings: AppSettings, raw: string | undefined): SpecSource {
  if (!settings.urlSourcesEnabled) {
    fail('SOURCE_DISABLED', 'errors.urlSourcesDisabled', undefined, { hint: 'hints.askAdminEnableUrls' });
  }
  const url = parseHttpsUrl(raw);
  return {
    label: url.toString(),
    link: url.toString(),
    cacheKey: JSON.stringify(['url', url.toString()]),
    baseUrl: url.toString(),
    read: readUrl,
  };
}
