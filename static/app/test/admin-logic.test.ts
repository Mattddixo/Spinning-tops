import { describe, expect, it, vi } from 'vitest';
import type { AuditEntryView, GitConnection } from '../../../src/shared/types';
import { appError } from '../../../src/shared/messages';
import { RequestFailed } from '../src/api';
import { AUTH_OPTIONS, describeAudit, emptyDraft, errorString, hostErrorString, toDraft } from '../src/admin/logic';
import { HostLimitError, normaliseHost } from '../src/admin/egress';
import { t } from './helpers/i18n';

// The real bridge throws on import outside Confluence.
vi.mock('@forge/bridge', () => ({ makeInvoke: () => vi.fn(), permissions: {} }));

const entry = (e: Partial<AuditEntryView>): AuditEntryView => ({ at: '2026-01-01T00:00:00Z', accountId: 'a', action: 'settings.update', ...e });

describe('describeAudit', () => {
  it('names the host list for host changes', () => {
    expect(describeAudit(t, entry({ action: 'host.approve', target: 'https://api.example.com', changes: ['apis'] }))).toBe(
      'Approved host: https://api.example.com (API hosts for "Try it out")',
    );
    expect(describeAudit(t, entry({ action: 'host.remove', target: '*.example.com', changes: ['unknown'] }))).toBe('Removed host: *.example.com');
  });

  it('lists what changed', () => {
    expect(describeAudit(t, entry({ action: 'connection.update', target: 'GitHub', changes: ['repos', 'token'] }))).toBe('Updated connection: GitHub: repos, token');
    expect(describeAudit(t, entry({ action: 'settings.update', changes: ['cacheTtl'] }))).toBe('Changed settings: cacheTtl');
    expect(describeAudit(t, entry({ action: 'cache.clear' }))).toBe('Cleared the cache');
  });
});

describe('drafts', () => {
  it('starts with the provider defaults and its first auth option', () => {
    const draft = emptyDraft('gitlab');
    expect(draft.authType).toBe(AUTH_OPTIONS.gitlab[0].id);
    expect(draft.apiBaseUrl).toMatch(/^https:\/\//);
  });

  it('never copies a stored token into the form', () => {
    const connection = {
      id: 'c1',
      name: 'GitHub',
      provider: 'github',
      apiBaseUrl: 'https://api.github.com',
      webBaseUrl: 'https://github.com',
      authType: 'bearer',
      repos: ['acme/api', 'acme/web'],
      spaceKeys: ['DOCS', 'ENG'],
      hasToken: true,
    } as GitConnection;
    const draft = toDraft(connection);
    expect(draft.token).toBeUndefined();
    expect(draft.repos).toBe('acme/api\nacme/web');
    expect(draft.spaceKeys).toBe('DOCS, ENG');
    expect(draft.username).toBe('');
  });
});

describe('error strings', () => {
  it('joins the translated title and hint', () => {
    const err = new RequestFailed(appError('EGRESS_NOT_APPROVED', 'errors.hostsNotSynced', undefined, { hint: 'hints.openSettingsToSync' }));
    expect(errorString(t, err)).toBe(`${t('errors.hostsNotSynced')} ${t('hints.openSettingsToSync')}`);
    expect(errorString(t, 'boom')).toBe(t('errors.generic'));
  });

  it('explains the host limit and passes bridge messages through', () => {
    expect(hostErrorString(t, new HostLimitError(), 'ui.admin.notApproved')).toMatch(/^Each list holds up to 10 hosts\./);
    expect(hostErrorString(t, new Error('User declined'), 'ui.admin.notApproved')).toBe(`${t('ui.admin.notApproved')} User declined`);
    expect(hostErrorString(t, undefined, 'ui.admin.notApproved')).toBe(t('ui.admin.notApproved'));
  });
});

describe('normaliseHost', () => {
  it('turns what admins type into an https origin', () => {
    expect(normaliseHost(' API.Example.com ')).toBe('https://api.example.com');
    expect(normaliseHost('https://api.example.com/v1/openapi.yaml')).toBe('https://api.example.com');
    expect(normaliseHost('https://api.example.com:8443')).toBe('https://api.example.com:8443');
  });

  it('keeps subdomain wildcards', () => {
    expect(normaliseHost('*.example.com')).toBe('*.example.com');
  });

  it('refuses anything else', () => {
    for (const input of ['', '   ', '*', 'http://example.com', 'localhost', 'ftp://example.com', '*.com', 'a*.example.com', 'https://*.com', 'https://exa mple.com']) {
      expect(normaliseHost(input), input).toBeUndefined();
    }
  });
});
