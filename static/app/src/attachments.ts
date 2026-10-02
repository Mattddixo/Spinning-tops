import { requestConfluence } from '@forge/bridge';
import { isSpecFilename } from '../../../src/shared/git';
import { appError } from '../../../src/shared/messages';
import { RequestFailed } from './api';

// Uploads go straight from the dialog to Confluence as the editing user
// (PUT /wiki/rest/api/content/{id}/child/attachment creates the file or adds a
// new version; scope write:confluence-file). The bridge rebuilds the multipart
// body on Atlassian's side as long as the file field is named "file".

export const MAX_UPLOAD_BYTES = 20_000_000;

export function validFilename(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) && !/[\\/:*?"<>|]/.test(trimmed) && trimmed.length <= 200 && isSpecFilename(trimmed);
}

const mediaTypeFor = (name: string) => (name.toLowerCase().endsWith('.json') ? 'application/json' : 'application/yaml');

export interface UploadedAttachment {
  title: string;
  version?: number;
}

export async function uploadAttachment(contentId: string, file: File, comment: string): Promise<UploadedAttachment> {
  if (file.size > MAX_UPLOAD_BYTES) throw new RequestFailed(appError('TOO_LARGE', 'errors.fileTooLarge', { name: file.name, size: MAX_UPLOAD_BYTES / 1_000_000 }));
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('minorEdit', 'true');
  form.append('comment', comment);
  let res: Response;
  try {
    res = await requestConfluence(`/wiki/rest/api/content/${encodeURIComponent(contentId)}/child/attachment`, {
      method: 'PUT',
      headers: { 'X-Atlassian-Token': 'no-check', Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    throw new RequestFailed(appError('UPSTREAM_ERROR', 'errors.uploadFailed', { status: 0 }, { detail: err instanceof Error ? err.message : String(err) }));
  }
  if (res.status === 401 || res.status === 403) throw new RequestFailed(appError('FORBIDDEN', 'errors.uploadForbidden'));
  if (res.status === 413) throw new RequestFailed(appError('TOO_LARGE', 'errors.uploadTooLarge', { name: file.name }));
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new RequestFailed(appError('UPSTREAM_ERROR', 'errors.uploadFailed', { status: res.status }, { detail: detail.slice(0, 300) || undefined }));
  }
  const body = (await res.json().catch(() => ({}))) as { results?: Array<{ title?: string; version?: { number?: number } }> };
  const first = body.results?.[0];
  return { title: first?.title ?? file.name, version: first?.version?.number };
}

export function textFile(name: string, text: string): File {
  return new File([text], name.trim(), { type: mediaTypeFor(name) });
}
