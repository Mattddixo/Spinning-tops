import { asApp, asUser, route } from '@forge/api';
import { isSpecFilename } from '../../shared/git';
import type { AttachmentOption } from '../../shared/types';
import type { SecureContext } from '../context';
import { isLicensedUser } from '../context';
import { fail } from '../errors';
import { MAX_SPEC_BYTES } from '../http';
import { syntheticPath, syntheticUrl, type SpecSource } from './types';

interface V2Attachment {
  id: string;
  title: string;
  mediaType?: string;
  fileSize?: number;
}

/**
 * Licensed users read attachments with their own permissions. Guests and
 * anonymous visitors cannot make `asUser()` calls, so the app reads on their
 * behalf — but only attachments of the page that contains the macro, which
 * the visitor is already viewing.
 * https://developer.atlassian.com/platform/forge/access-to-forge-apps-for-unlicensed-users/
 */
function requester(ctx: SecureContext) {
  return isLicensedUser(ctx) ? asUser() : asApp();
}

function contentCollection(ctx: SecureContext): 'pages' | 'blogposts' {
  return ctx.contentType === 'blogpost' ? 'blogposts' : 'pages';
}

function requireContent(ctx: SecureContext): string {
  if (!ctx.contentId) fail('BAD_REQUEST', 'Attachments can only be used inside a Confluence page or blog post.');
  return ctx.contentId as string;
}

async function findAttachment(ctx: SecureContext, filename: string): Promise<V2Attachment> {
  const contentId = requireContent(ctx);
  const collection = contentCollection(ctx);
  const path =
    collection === 'blogposts'
      ? route`/wiki/api/v2/blogposts/${contentId}/attachments?filename=${filename}&limit=10`
      : route`/wiki/api/v2/pages/${contentId}/attachments?filename=${filename}&limit=10`;
  const res = await requester(ctx).requestConfluence(path, { headers: { Accept: 'application/json' } });
  if (res.status === 403 || res.status === 401) fail('FORBIDDEN', 'You do not have permission to view attachments on this page.');
  if (!res.ok) fail('UPSTREAM_ERROR', `Confluence returned HTTP ${res.status} while listing attachments.`);
  const body = (await res.json()) as { results?: V2Attachment[] };
  const match = body.results?.find((a) => a.title === filename);
  if (!match) {
    return fail('NOT_FOUND', `The attachment "${filename}" was not found on this page.`, 'It may have been deleted or renamed. Edit the macro to pick another file.');
  }
  return match;
}

async function downloadAttachment(ctx: SecureContext, attachment: V2Attachment): Promise<string> {
  if (attachment.fileSize && attachment.fileSize > MAX_SPEC_BYTES) {
    fail('TOO_LARGE', `"${attachment.title}" is ${(attachment.fileSize / 1_000_000).toFixed(1)} MB; the limit is 4.5 MB.`);
  }
  const contentId = requireContent(ctx);
  const res = await requester(ctx).requestConfluence(
    route`/wiki/rest/api/content/${contentId}/child/attachment/${attachment.id}/download`,
  );
  if (res.status === 404) fail('NOT_FOUND', `The attachment "${attachment.title}" could not be downloaded.`);
  if (!res.ok) fail('UPSTREAM_ERROR', `Confluence returned HTTP ${res.status} while downloading "${attachment.title}".`);
  const text = await res.text();
  if (text.length > MAX_SPEC_BYTES) fail('TOO_LARGE', `"${attachment.title}" is larger than 4.5 MB.`);
  return text;
}

export function attachmentSource(ctx: SecureContext, filename: string): SpecSource {
  if (!filename || !isSpecFilename(filename)) {
    fail('NOT_CONFIGURED', 'Choose a .yaml, .yml or .json attachment in the macro settings.');
  }
  return {
    label: `Attachment: ${filename}`,
    // Attachments are permission-sensitive, so they are never cached across users.
    cacheKey: undefined,
    baseUrl: syntheticUrl('attachments', filename),
    async read(url: string) {
      // Attachments are flat: "./schemas/pet.yaml" resolves to the attachment "schemas/pet.yaml",
      // falling back to its base name "pet.yaml".
      const path = syntheticPath(url);
      const candidates = [...new Set([path, path.split('/').pop() ?? path])];
      let lastError: unknown;
      for (const name of candidates) {
        try {
          return await downloadAttachment(ctx, await findAttachment(ctx, name));
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    },
  };
}

export async function listSpecAttachments(ctx: SecureContext): Promise<AttachmentOption[]> {
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'Only licensed Confluence users can edit this macro.');
  const contentId = requireContent(ctx);
  const path =
    contentCollection(ctx) === 'blogposts'
      ? route`/wiki/api/v2/blogposts/${contentId}/attachments?limit=250`
      : route`/wiki/api/v2/pages/${contentId}/attachments?limit=250`;
  const res = await asUser().requestConfluence(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) fail('UPSTREAM_ERROR', `Confluence returned HTTP ${res.status} while listing attachments.`);
  const body = (await res.json()) as { results?: V2Attachment[] };
  return (body.results ?? [])
    .filter((a) => isSpecFilename(a.title))
    .map((a) => ({ title: a.title, mediaType: a.mediaType, fileSize: a.fileSize }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
