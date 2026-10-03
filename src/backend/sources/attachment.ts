import { asApp, asUser, route } from '@forge/api';
import { isSpecFilename } from '../../shared/git';
import type { AttachmentOption } from '../../shared/types';
import { checkBudget, remainingMs } from '../budget';
import type { SecureContext } from '../context';
import { isLicensedUser } from '../context';
import { fail } from '../errors';
import { MAX_EDIT_BYTES, MAX_SOURCE_BYTES, MB } from '../limits';
import { syntheticPath, syntheticUrl, type SpecSource } from './types';

export interface V2Attachment {
  id: string;
  title: string;
  mediaType?: string;
  fileSize?: number;
  version?: { number?: number };
}

// Licensed users read as themselves. Guests/anonymous can't use asUser(), so
// we read as the app, but only from the page the macro is on (which they can
// already see).
function requester(ctx: SecureContext) {
  return isLicensedUser(ctx) ? asUser() : asApp();
}

function requireContent(ctx: SecureContext): string {
  if (!ctx.contentId) fail('BAD_REQUEST', 'errors.attachmentsNeedPage');
  return ctx.contentId as string;
}

function attachmentsRoute(ctx: SecureContext, query: { filename?: string; limit: number; cursor?: string }) {
  const id = requireContent(ctx);
  const { filename, limit, cursor } = query;
  if (ctx.contentType === 'blogpost') {
    if (cursor) return route`/wiki/api/v2/blogposts/${id}/attachments?limit=${limit}&cursor=${cursor}`;
    return filename
      ? route`/wiki/api/v2/blogposts/${id}/attachments?filename=${filename}&limit=${limit}`
      : route`/wiki/api/v2/blogposts/${id}/attachments?limit=${limit}`;
  }
  if (cursor) return route`/wiki/api/v2/pages/${id}/attachments?limit=${limit}&cursor=${cursor}`;
  return filename
    ? route`/wiki/api/v2/pages/${id}/attachments?filename=${filename}&limit=${limit}`
    : route`/wiki/api/v2/pages/${id}/attachments?limit=${limit}`;
}

// The cursor from a v2 `_links.next` link. Only the cursor is reused; the
// request itself is rebuilt with route`` like the first one.
function nextCursor(next: string | undefined): string | undefined {
  if (!next) return undefined;
  try {
    return new URL(next, 'https://confluence.invalid').searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}

const ATTACHMENT_PAGE = 250;
const MAX_ATTACHMENT_PAGES = 8;
// Stop paging with this much of the time budget left, keeping what was found.
const PAGING_RESERVE_MS = 4_000;

export async function findAttachment(ctx: SecureContext, filename: string): Promise<V2Attachment> {
  checkBudget();
  const res = await requester(ctx).requestConfluence(attachmentsRoute(ctx, { filename, limit: 10 }), {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 403 || res.status === 401) fail('FORBIDDEN', 'errors.attachmentsForbidden');
  if (!res.ok) fail('UPSTREAM_ERROR', 'errors.confluenceListFailed', { status: res.status });
  const body = (await res.json()) as { results?: V2Attachment[] };
  const match = body.results?.find((a) => a.title === filename);
  if (!match) return fail('NOT_FOUND', 'errors.attachmentNotFound', { name: filename }, { hint: 'hints.attachmentRenamed' });
  return match;
}

/** Download the current version, or an older one when `version` is set. */
export async function downloadAttachment(ctx: SecureContext, attachment: V2Attachment, version?: number): Promise<string> {
  if (attachment.fileSize && attachment.fileSize > MAX_SOURCE_BYTES) {
    fail('TOO_LARGE', 'errors.fileTooLarge', { name: attachment.title, size: MAX_SOURCE_BYTES / MB });
  }
  checkBudget();
  const id = requireContent(ctx);
  const path = version
    ? route`/wiki/rest/api/content/${id}/child/attachment/${attachment.id}/download?version=${version}`
    : route`/wiki/rest/api/content/${id}/child/attachment/${attachment.id}/download`;
  const res = await requester(ctx).requestConfluence(path);
  if (res.status === 404) fail('NOT_FOUND', 'errors.attachmentDownloadFailed', { name: attachment.title });
  if (!res.ok) fail('UPSTREAM_ERROR', 'errors.confluenceDownloadFailed', { status: res.status, name: attachment.title });
  const text = await res.text();
  if (text.length > MAX_SOURCE_BYTES) fail('TOO_LARGE', 'errors.fileTooLarge', { name: attachment.title, size: MAX_SOURCE_BYTES / MB });
  return text;
}

export function attachmentSource(ctx: SecureContext, filename: string, options: { version?: number } = {}): SpecSource {
  if (!filename || !isSpecFilename(filename)) fail('NOT_CONFIGURED', 'errors.attachmentNotChosen');
  return {
    label: options.version ? `${filename} (v${options.version})` : filename,
    // don't cache: access depends on who is reading
    cacheKey: undefined,
    baseUrl: syntheticUrl('attachments', filename),
    async read(url: string) {
      // Attachments have no folders, so try "schemas/pet.yaml" then "pet.yaml".
      const path = syntheticPath(url);
      const isRoot = path === filename;
      const candidates = [...new Set([path, path.split('/').pop() ?? path])];
      let lastError: unknown;
      for (const name of candidates) {
        try {
          // Only the root file is pinned to an old version; referenced files use their current version.
          return await downloadAttachment(ctx, await findAttachment(ctx, name), isRoot ? options.version : undefined);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    },
  };
}

/** Text of an attachment for the in-dialog editor, with its version so saves can spot conflicts. */
export async function readAttachmentForEditing(ctx: SecureContext, filename: string): Promise<{ text: string; version?: number }> {
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.editorOnly');
  if (!filename || !isSpecFilename(filename)) fail('BAD_REQUEST', 'errors.attachmentNotChosen');
  const attachment = await findAttachment(ctx, filename);
  if (attachment.fileSize && attachment.fileSize > MAX_EDIT_BYTES) {
    fail('TOO_LARGE', 'errors.editTooLarge', { name: filename, size: MAX_EDIT_BYTES / MB });
  }
  const text = await downloadAttachment(ctx, attachment);
  if (text.length > MAX_EDIT_BYTES) fail('TOO_LARGE', 'errors.editTooLarge', { name: filename, size: MAX_EDIT_BYTES / MB });
  return { text, version: attachment.version?.number };
}

export async function listSpecAttachments(ctx: SecureContext): Promise<AttachmentOption[]> {
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.editorOnly');
  const all: V2Attachment[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ATTACHMENT_PAGES; page++) {
    const res = await asUser().requestConfluence(attachmentsRoute(ctx, { limit: ATTACHMENT_PAGE, cursor }), { headers: { Accept: 'application/json' } });
    if (!res.ok) fail('UPSTREAM_ERROR', 'errors.confluenceListFailed', { status: res.status });
    const body = (await res.json()) as { results?: V2Attachment[]; _links?: { next?: string } };
    all.push(...(body.results ?? []));
    cursor = nextCursor(body._links?.next);
    if (!cursor || remainingMs() < PAGING_RESERVE_MS) break;
  }
  return all
    .filter((a) => isSpecFilename(a.title))
    .map((a) => ({ title: a.title, mediaType: a.mediaType, fileSize: a.fileSize, version: a.version?.number }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
