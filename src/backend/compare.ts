import { diffSpecs } from '../shared/diff';
import { isValidRef } from '../shared/git';
import { isAsyncApi } from '../shared/spec';
import type { AppSettings, CompareResponse, CompareTarget, MacroConfig, SpecSummary } from '../shared/types';
import { readCache, writeCache } from './cache';
import { isLicensedUser, requireLicense, type SecureContext } from './context';
import { decodeSpec } from './encoding';
import { fail } from './errors';
import { buildSpec, resolveMacroConfig, selectSource, type SourceOverrides } from './loadSpec';
import { findAttachment } from './sources/attachment';
import { resolveGitTarget } from './sources/git';
import { getSettings } from './store';

const MAX_ATTACHMENT_VERSION = 100_000;

interface Loaded {
  label: string;
  spec: Record<string, unknown>;
  summary: SpecSummary;
}

// Same cache as the macro itself, so comparing against a tag that was viewed
// recently doesn't fetch it again.
async function load(ctx: SecureContext, config: MacroConfig, settings: AppSettings, overrides?: SourceOverrides): Promise<Loaded> {
  const { source, rootText } = await selectSource(ctx, config, settings, overrides);
  if (source.cacheKey) {
    const cached = await readCache(source.cacheKey, settings.cacheTtlMinutes);
    if (cached && !isAsyncApi(cached.summary.kind)) return { label: source.label, spec: decodeSpec(cached.specGz), summary: cached.summary };
  }
  const built = await buildSpec(source, settings, rootText);
  if (source.cacheKey) {
    const { spec: _spec, ...cached } = built;
    await writeCache(source.cacheKey, settings.cacheTtlMinutes, { ...cached, ...(source.link ? { sourceLink: source.link } : {}) });
  }
  return { label: source.label, spec: built.spec, summary: built.summary };
}

/** Work out which older version to load, and refuse comparisons that make no sense. */
async function baseOverrides(ctx: SecureContext, config: MacroConfig, target: CompareTarget): Promise<SourceOverrides> {
  switch (config.sourceType) {
    case 'git': {
      const ref = typeof target?.gitRef === 'string' ? target.gitRef.trim() : '';
      if (!ref) return fail('BAD_REQUEST', 'errors.compareRefRequired');
      if (!isValidRef(ref)) return fail('BAD_REQUEST', 'errors.gitRefInvalid', { ref });
      const current = await resolveGitTarget(ctx, { connectionId: config.gitConnectionId, repo: config.gitRepo, ref: config.gitRef, path: config.gitPath });
      if (current.ref === ref) return fail('BAD_REQUEST', 'errors.compareSameRef', { ref });
      return { gitRef: ref };
    }
    case 'attachment': {
      const requested = target?.attachmentVersion;
      if (requested !== undefined) {
        if (!Number.isInteger(requested) || requested < 1 || requested > MAX_ATTACHMENT_VERSION) return fail('BAD_REQUEST', 'errors.compareVersionInvalid');
        return { attachmentVersion: requested };
      }
      // Default: the version before the current one.
      const current = (await findAttachment(ctx, config.attachment ?? '')).version?.number;
      if (!current || current < 2) return fail('NOT_FOUND', 'errors.compareNoOlderVersion', { name: config.attachment ?? '' });
      return { attachmentVersion: current - 1 };
    }
    default:
      return fail('BAD_REQUEST', 'errors.compareUnsupportedSource');
  }
}

/**
 * Compare the macro's spec with an older Git ref or attachment version and
 * list the changes, breaking ones first. Licensed users only: it can fetch
 * any ref the connection allows, the same access the macro editor gives.
 */
export async function compareSpec(ctx: SecureContext, savedConfig: MacroConfig, target: CompareTarget): Promise<CompareResponse> {
  requireLicense(ctx);
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.compareLicensedOnly');
  const { config } = await resolveMacroConfig(ctx, savedConfig);
  const overrides = await baseOverrides(ctx, config, target);
  const settings = await getSettings();
  const [head, base] = await Promise.all([load(ctx, config, settings), load(ctx, config, settings, overrides)]);
  if (isAsyncApi(head.summary.kind) || isAsyncApi(base.summary.kind)) fail('UNSUPPORTED_SPEC', 'errors.compareAsyncApi');
  return {
    ...diffSpecs(base.spec, base.summary.kind, head.spec, head.summary.kind),
    baseLabel: base.label,
    baseVersion: base.summary.version,
    headLabel: head.label,
    headVersion: head.summary.version,
  };
}
