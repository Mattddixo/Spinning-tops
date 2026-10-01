import { asUser, route } from '@forge/api';
import { isLicensedUser, type SecureContext } from './context';
import { fail } from './errors';

interface CurrentUser {
  operations?: Array<{ operation?: string; targetType?: string }>;
}

/**
 * Settings changes require a Confluence administrator. The check uses the
 * signed-in user's own permissions via
 * GET /wiki/rest/api/user/current?expand=operations
 * (an "administer" operation on the "application" target).
 */
export async function requireAdmin(ctx: SecureContext): Promise<void> {
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'Only Confluence administrators can change SpecPage settings.');
  const res = await asUser().requestConfluence(route`/wiki/rest/api/user/current?expand=operations`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) fail('FORBIDDEN', 'Could not verify your Confluence permissions.');
  const user = (await res.json()) as CurrentUser;
  const isAdmin = (user.operations ?? []).some((op) => op.operation === 'administer' && op.targetType === 'application');
  if (!isAdmin) fail('FORBIDDEN', 'Only Confluence administrators can change SpecPage settings.');
}
