import { PROVIDERS } from '../../../../src/shared/git';
import type { Translate } from '../../../../src/shared/i18n';
import type { AuditEntryView, GitAuthType, GitConnection, GitConnectionInput, GitProvider } from '../../../../src/shared/types';
import { toAppError } from '../api';
import { errorText } from '../i18n';
import { GROUP_INFO, HostLimitError, MAX_DOMAINS_PER_GROUP, type EgressGroup } from './egress';

// Pure helpers for the settings page, kept out of the components so they can
// be unit tested.

// Values are translation keys.
export const AUTH_OPTIONS: Record<GitProvider, Array<{ id: GitAuthType; label: string }>> = {
  github: [
    { id: 'bearer', label: 'ui.admin.authBearerGithub' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
  gitlab: [
    { id: 'private-token', label: 'ui.admin.authPrivateToken' },
    { id: 'bearer', label: 'ui.admin.authBearerGitlab' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
  bitbucket: [
    { id: 'bearer', label: 'ui.admin.authBearerBitbucket' },
    { id: 'basic', label: 'ui.admin.authBasicBitbucket' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
  azure: [
    { id: 'pat', label: 'ui.admin.authPat' },
    { id: 'none', label: 'ui.admin.authNone' },
  ],
  swaggerhub: [
    { id: 'bearer', label: 'ui.admin.authSwaggerhubKey' },
    { id: 'none', label: 'ui.admin.authNonePublicApis' },
  ],
};

export type Draft = Omit<GitConnectionInput, 'repos' | 'spaceKeys'> & { repos: string; spaceKeys: string };

export const emptyDraft = (provider: GitProvider = 'github'): Draft => ({
  name: '',
  provider,
  apiBaseUrl: PROVIDERS[provider].apiBaseUrl,
  webBaseUrl: PROVIDERS[provider].webBaseUrl,
  authType: AUTH_OPTIONS[provider][0].id,
  username: '',
  repos: '',
  spaceKeys: '',
  defaultRef: '',
  token: '',
});

export const toDraft = (c: GitConnection): Draft => ({
  id: c.id,
  name: c.name,
  provider: c.provider,
  apiBaseUrl: c.apiBaseUrl,
  webBaseUrl: c.webBaseUrl,
  authType: c.authType,
  username: c.username ?? '',
  repos: c.repos.join('\n'),
  spaceKeys: c.spaceKeys.join(', '),
  defaultRef: c.defaultRef ?? '',
  token: undefined,
});

export const errorString = (t: Translate, err: unknown) => {
  const { title, hint } = errorText(t, toAppError(err));
  return hint ? `${title} ${hint}` : title;
};

export function hostErrorString(t: Translate, err: unknown, fallbackKey: string) {
  if (err instanceof HostLimitError) return t('ui.admin.hostLimit', { max: MAX_DOMAINS_PER_GROUP });
  // Bridge errors from the consent flow are plain Errors without a key.
  return err instanceof Error && err.message ? `${t(fallbackKey)} ${err.message}` : t(fallbackKey);
}

export function describeAudit(t: Translate, entry: AuditEntryView): string {
  const action = t(`ui.audit.${entry.action}`);
  let details = entry.target ?? '';
  if (entry.action === 'host.approve' || entry.action === 'host.remove') {
    // changes holds the egress group for host entries.
    const group = entry.changes?.[0] as EgressGroup | undefined;
    if (group && GROUP_INFO[group]) details = `${details} (${t(GROUP_INFO[group].title)})`;
  } else if (entry.changes?.length) {
    details = details ? `${details}: ${entry.changes.join(', ')}` : entry.changes.join(', ');
  }
  return details ? `${action}: ${details}` : action;
}
