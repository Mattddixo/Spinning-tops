import type { MacroConfig } from '../shared/types';
import { fail } from './errors';

/**
 * Resolver context values are supplied by the Forge platform and are safe to
 * use for authorization (unlike `view.getContext()` in the browser).
 * https://developer.atlassian.com/platform/forge/app-context-security/
 */
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
    // Fail safe: if the platform ever omits accountType, grant the least privilege.
    accountType: accountType ?? (ctx.accountId && ctx.accountId !== 'unidentified' ? 'unlicensed' : 'anonymous'),
    contentId: ext.content?.id ? String(ext.content.id) : undefined,
    contentType: ext.content?.type,
    spaceKey: ext.space?.key,
    isEditing: ext.isEditing === true,
    config: ext.config ?? {},
    // `license` is only present for paid apps in production; absent means dev/staging or free.
    licenseActive: ctx.license === undefined || ctx.license?.active !== false,
  };
}

export const isLicensedUser = (ctx: SecureContext) => ctx.accountType === 'licensed' && Boolean(ctx.accountId);

export function requireLicense(ctx: SecureContext): void {
  if (!ctx.licenseActive) {
    fail('LICENSE_INACTIVE', 'The SpecPage subscription for this site is not active. Ask a Confluence admin to renew it.');
  }
}

/**
 * Choose the macro configuration to use. Saved configuration always comes from
 * the trusted context; unsaved preview configuration is only accepted from
 * licensed users (page editors in the config modal).
 */
export function effectiveConfig(ctx: SecureContext, preview?: MacroConfig): MacroConfig {
  if (preview && typeof preview === 'object') {
    if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'Previewing unsaved settings requires a licensed Confluence user.');
    return preview;
  }
  return ctx.config;
}
