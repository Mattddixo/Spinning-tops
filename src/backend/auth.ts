import { asUser, route } from '@forge/api';
import { isLicensedUser, type SecureContext } from './context';
import { fail } from './errors';

interface CurrentUser {
  operations?: Array<{ operation?: string; targetType?: string }>;
}

// Confluence admin check: user/current?expand=operations should include
// administer on application.
export async function requireAdmin(ctx: SecureContext): Promise<void> {
  if (!isLicensedUser(ctx)) fail('FORBIDDEN', 'errors.adminOnly');
  const res = await asUser().requestConfluence(route`/wiki/rest/api/user/current?expand=operations`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) fail('FORBIDDEN', 'errors.adminCheckFailed');
  const user = (await res.json()) as CurrentUser;
  const isAdmin = (user.operations ?? []).some((op) => op.operation === 'administer' && op.targetType === 'application');
  if (!isAdmin) fail('FORBIDDEN', 'errors.adminOnly');
}
