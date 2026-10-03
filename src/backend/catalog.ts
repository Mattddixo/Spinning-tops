import { asUser, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { createHash } from 'node:crypto';
import type { ApiEntry, ApiListItem, MacroConfig, SpecSummary } from '../shared/types';
import { isLicensedUser, type SecureContext } from './context';
import { fail } from './errors';
import { listByPrefix } from './store';

// A small registry of the API docs on each page, so a space (or the whole
// site) can list its APIs. Each macro instance writes one entry when it
// loads: api:{spaceId}:{contentId}:{localId}. Listing checks every page
// against the reader's own permissions and drops entries whose page or macro
// is gone.

const PREFIX = 'api';
// Rewrite entries at most this often when nothing changed (keeps writes down on busy pages).
const REFRESH_MS = 12 * 60 * 60 * 1000;
// Entries for pages the reader can't see are only removed once nobody has
// viewed the page for this long. "Can't see" may just mean restricted (page
// restrictions can hide pages from the app too), and every view refreshes the
// entry, so a long silence is the only safe sign the page is gone.
const UNSEEN_PRUNE_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
// The site-wide list reads more entries; each 250 costs up to two page lookups.
const MAX_SITE_ENTRIES = 2000;
const PAGE_BATCH = 250;

const keyPart = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
const entryKey = (spaceId: string, contentId: string, localId: string) => `${PREFIX}:${keyPart(spaceId)}:${keyPart(contentId)}:${keyPart(localId)}`;

const sourceFingerprint = (config: MacroConfig) =>
  createHash('sha256')
    .update(JSON.stringify([config.sourceType, config.attachment, config.gitConnectionId, config.gitRepo, config.gitRef, config.gitPath, config.url, config.inlineSpec?.length]))
    .digest('hex')
    .slice(0, 16);

/** Record (or refresh) the entry for this macro. Never throws: it must not break rendering. */
export async function recordApi(ctx: SecureContext, config: MacroConfig, summary: SpecSummary, sourceLabel: string): Promise<void> {
  if (!ctx.spaceId || !ctx.contentId || !ctx.localId || !config.sourceType) return;
  if (ctx.contentType !== 'page' && ctx.contentType !== 'blogpost') return;
  const key = entryKey(ctx.spaceId, ctx.contentId, ctx.localId);
  const entry: ApiEntry = {
    spaceId: ctx.spaceId,
    ...(ctx.spaceKey ? { spaceKey: ctx.spaceKey.slice(0, 255) } : {}),
    contentId: ctx.contentId,
    contentType: ctx.contentType,
    localId: ctx.localId,
    title: config.title?.trim() || summary.title,
    version: summary.version,
    kind: summary.kind,
    operationCount: summary.operations.length,
    sourceType: config.sourceType,
    sourceLabel: config.sourceType === 'inline' ? '' : sourceLabel.slice(0, 300),
    fingerprint: sourceFingerprint(config),
    updatedAt: new Date().toISOString(),
  };
  try {
    const existing = await kvs.get<ApiEntry>(key);
    const same =
      existing &&
      (['spaceKey', 'title', 'version', 'kind', 'operationCount', 'sourceType', 'sourceLabel', 'fingerprint'] as const).every((k) => existing[k] === entry[k]);
    if (same && Date.now() - Date.parse(existing.updatedAt) < REFRESH_MS) return;
    await kvs.set(key, entry);
  } catch (err) {
    console.warn(`[catalog] write failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

interface PageInfo {
  id: string;
  title: string;
  adf?: string;
}

/** v2 bulk read as the reader: only pages they can see come back. */
async function readPages(type: 'page' | 'blogpost', ids: string[], withBody: boolean): Promise<Map<string, PageInfo>> {
  const found = new Map<string, PageInfo>();
  const requester = asUser();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += PAGE_BATCH) batches.push(ids.slice(i, i + PAGE_BATCH));
  // Batches run side by side; there are at most a handful (MAX_SITE_ENTRIES / PAGE_BATCH).
  await Promise.all(
    batches.map(async (batchIds) => {
      const query = new URLSearchParams({ id: batchIds.join(','), limit: String(PAGE_BATCH) });
      if (withBody) query.set('body-format', 'atlas_doc_format');
      const path = type === 'page' ? route`/wiki/api/v2/pages?${query}` : route`/wiki/api/v2/blogposts?${query}`;
      const res = await requester.requestConfluence(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) fail('UPSTREAM_ERROR', 'errors.confluencePagesFailed', { status: res.status });
      const body = (await res.json()) as { results?: Array<{ id: string | number; title?: string; body?: { atlas_doc_format?: { value?: string } } }> };
      for (const p of body.results ?? []) {
        found.set(String(p.id), { id: String(p.id), title: p.title ?? '', adf: p.body?.atlas_doc_format?.value });
      }
    }),
  );
  return found;
}

const MACRO_KEY = 'specpage-viewer';

/**
 * Does the page still have a SpecPage macro? Extension nodes in the page's ADF
 * carry the module key inside extensionKey. This is deliberately loose: an
 * entry is only dropped when no SpecPage macro is left on the page, so a
 * live entry is never pruned by mistake. (A page that had two macros and lost
 * one keeps the extra entry until the page loses them all.)
 */
export const pageHasMacro = (adf: string | undefined) => adf === undefined || adf.includes(MACRO_KEY);

/**
 * Keep the entries whose page the reader can see and that still has a
 * SpecPage macro. Entries for deleted pages, or pages with no macro left, are
 * removed; restricted pages are kept for the readers who can see them.
 */
async function visibleEntries(entries: Array<{ key: string; value: ApiEntry }>, options: { checkMacro: boolean }): Promise<ApiListItem[]> {
  const stale: string[] = [];
  const items: ApiListItem[] = [];
  for (const type of ['page', 'blogpost'] as const) {
    const ofType = entries.filter((e) => e.value.contentType === type);
    if (!ofType.length) continue;
    const ids = [...new Set(ofType.map((e) => e.value.contentId))];
    // Page bodies are only fetched where we check the macro is still there.
    const visible = await readPages(type, ids, options.checkMacro);
    for (const { key, value } of ofType) {
      const page = visible.get(value.contentId);
      if (!page) {
        // Hidden from this reader: keep it for readers who can see it, unless
        // it hasn't been viewed by anyone for a long time.
        if (Date.now() - Date.parse(value.updatedAt) > UNSEEN_PRUNE_MS) stale.push(key);
        continue;
      }
      if (options.checkMacro && !pageHasMacro(page.adf)) {
        stale.push(key);
        continue;
      }
      items.push({ ...value, pageTitle: page.title });
    }
  }
  await Promise.all(stale.map((key) => kvs.delete(key).catch(() => undefined)));
  return items.sort((a, b) => a.title.localeCompare(b.title) || a.pageTitle.localeCompare(b.pageTitle));
}

export async function listSpaceApis(ctx: SecureContext, spaceId: string): Promise<ApiListItem[]> {
  // Page permissions are checked as the reader, which needs a licensed user.
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.catalogLicensedOnly');
  if (!/^\d+$/.test(spaceId)) fail('BAD_REQUEST', 'errors.generic');
  const entries = await listByPrefix<ApiEntry>(`${PREFIX}:${keyPart(spaceId)}:`, MAX_ENTRIES);
  return entries.length ? visibleEntries(entries, { checkMacro: true }) : [];
}

/**
 * Every API on the site the reader can see. `truncated` when there were more
 * entries than one call can check. Page bodies aren't fetched here (that's the
 * expensive part), so entries for pages whose macro was removed are tidied up
 * by their space's list rather than this one.
 */
export async function listSiteApis(ctx: SecureContext): Promise<{ apis: ApiListItem[]; truncated: boolean }> {
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.catalogLicensedOnly');
  // One more than the cap tells us whether anything was left out.
  const entries = await listByPrefix<ApiEntry>(`${PREFIX}:`, MAX_SITE_ENTRIES + 1);
  const truncated = entries.length > MAX_SITE_ENTRIES;
  return { apis: entries.length ? await visibleEntries(entries.slice(0, MAX_SITE_ENTRIES), { checkMacro: false }) : [], truncated };
}
