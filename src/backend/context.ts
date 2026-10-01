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
  isEditing: boolean;
  config: MacroConfig;
  licenseActive: boolean;
}

type RawContext = Record<string, unknown> & {
  accountId?: string;
  accountType?: string;
  license?: { active?: boolean };
  extension?: {
    content?: { id?: string; type?: string };
    space?: { key?: string };
    config?: MacroConfig;
    isEditing?: boolean;
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
    isEditing: ext.isEditing === true,
    config: ext.config ?? {},
    // license is undefined outside production, so treat that as active.
    licenseActive: ctx.license === undefined || ctx.license?.active !== false,
  };
}

export const isLicensedUser = (ctx: SecureContext) => ctx.accountType === 'licensed' && Boolean(ctx.accountId);

export function requireLicense(ctx: SecureContext): void {
  if (!ctx.licenseActive) {
    fail('LICENSE_INACTIVE', 'The SpecPage subscription for this site is not active. Ask a Confluence admin to renew it.');
  }
}

// Saved config comes from the context. Unsaved preview config (from the
// config modal) is only accepted from licensed users.
export function effectiveConfig(ctx: SecureContext, preview?: MacroConfig): MacroConfig {
  if (preview && typeof preview === 'object') {
    if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'Previewing unsaved settings requires a licensed Confluence user.');
    return preview;
  }
  return ctx.config;
}
