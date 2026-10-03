import type { MacroConfig } from '../shared/types';
import { fail } from './errors';

// The resolver context comes from Forge, so it's safe to use for auth checks.
// view.getContext() in the browser is not.
export interface SecureContext {
  accountId?: string;
  accountType: 'licensed' | 'unlicensed' | 'customer' | 'anonymous';
  contentId?: string;
  contentType?: string;
  spaceKey?: string;
  spaceId?: string;
  /** This macro instance on the page. */
  localId?: string;
  isEditing: boolean;
  /** The pasted link when the macro was inserted by autoconvert. */
  autoConvertLink?: string;
  config: MacroConfig;
  licenseActive: boolean;
}

type RawContext = Record<string, unknown> & {
  accountId?: string;
  localId?: string;
  accountType?: string;
  license?: { active?: boolean };
  extension?: {
    content?: { id?: string; type?: string };
    space?: { key?: string; id?: string | number };
    config?: MacroConfig;
    isEditing?: boolean;
    autoConvertLink?: string;
  };
};

export function readContext(raw: unknown): SecureContext {
  const ctx = (raw ?? {}) as RawContext;
  const accountType = (['licensed', 'unlicensed', 'customer', 'anonymous'] as const).find((t) => t === ctx.accountType);
  const ext = ctx.extension ?? {};
  return {
    accountId: ctx.accountId && ctx.accountId !== 'unidentified' ? ctx.accountId : undefined,
    // If accountType is ever missing, treat the user as unlicensed.
    accountType: accountType ?? (ctx.accountId && ctx.accountId !== 'unidentified' ? 'unlicensed' : 'anonymous'),
    contentId: ext.content?.id ? String(ext.content.id) : undefined,
    contentType: ext.content?.type,
    spaceKey: ext.space?.key,
    spaceId: ext.space?.id !== undefined ? String(ext.space.id) : undefined,
    localId: typeof ctx.localId === 'string' && ctx.localId ? ctx.localId : undefined,
    isEditing: ext.isEditing === true,
    autoConvertLink: typeof ext.autoConvertLink === 'string' && ext.autoConvertLink.length <= 2048 ? ext.autoConvertLink : undefined,
    config: ext.config ?? {},
    // license is undefined outside production, so treat that as active.
    licenseActive: ctx.license === undefined || ctx.license?.active !== false,
  };
}

export const isLicensedUser = (ctx: SecureContext) => ctx.accountType === 'licensed' && Boolean(ctx.accountId);

export function requireLicense(ctx: SecureContext): void {
  if (!ctx.licenseActive) {
    fail('LICENSE_INACTIVE', 'errors.licenseInactive');
  }
}

// Saved config comes from the context. Unsaved preview config (from the
// config modal) is only accepted from licensed users. A licensed user could
// put any macro settings in a preview, but nothing more than inserting their
// own macro would give them: Git access is still limited by each connection's
// repos and spaces, URL sources by the site setting, and Try it out by the
// site setting plus admin-approved hosts. The macro's own Try it out switch is
// a display choice, not a security boundary.
export function effectiveConfig(ctx: SecureContext, preview?: MacroConfig): MacroConfig {
  if (preview && typeof preview === 'object') {
    if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.previewNeedsLicense');
    return preview;
  }
  return ctx.config;
}
