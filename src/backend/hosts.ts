import { EgressFilteringService } from '@forge/egress';
import { kvs } from '@forge/kvs';
import type { ApprovedHosts, ApprovedHostGroup } from '../shared/types';
import { fail } from './errors';

// Forge checks every outgoing request against all approved hosts, whatever
// list they were approved in, and the backend can't read the lists. So the
// settings page saves a copy of them here (admins only), and requests are
// also checked against the list for their purpose: Try it out against the
// Try it out hosts, URL sources and $refs against the spec hosts.
//
// The copy can only narrow what Forge allows. A host removed in Atlassian
// Administration is still blocked by Forge; a host added there is refused
// here until an admin opens the SpecPage settings page, which re-syncs.
// Matching uses Forge's own EgressFilteringService so wildcards behave the
// same way.

const KEY = 'approved-hosts';
const MAX_PER_GROUP = 10;
const GROUPS: ApprovedHostGroup[] = ['git', 'specs', 'apis'];
// Host entries in any form Atlassian Administration accepts and Forge's matcher
// understands: optional https://, optional *. wildcard, a dotted host, optional
// port and path. A bare "*" (allow everything) and other schemes are dropped;
// requests are always https, so http:// entries could never match anyway.
const HOST_ENTRY = /^(https:\/\/)?(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?(\/\S*)?$/;

function cleanGroup(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length <= 255 && HOST_ENTRY.test(v));
  return [...new Set(entries)].slice(0, MAX_PER_GROUP);
}

export async function saveApprovedHosts(input: Partial<Record<ApprovedHostGroup, unknown>> | undefined): Promise<ApprovedHosts> {
  const hosts = Object.fromEntries(GROUPS.map((g) => [g, cleanGroup(input?.[g])])) as Record<ApprovedHostGroup, string[]>;
  const value: ApprovedHosts = { ...hosts, syncedAt: new Date().toISOString() };
  await kvs.set(KEY, value);
  return value;
}

export async function getApprovedHosts(): Promise<ApprovedHosts | undefined> {
  return (await kvs.get<ApprovedHosts>(KEY)) ?? undefined;
}

/** Fail unless `url` is on the approved list for `group` (as last synced from the settings page). */
export async function requireApprovedFor(group: Exclude<ApprovedHostGroup, 'git'>, url: URL): Promise<void> {
  const hosts = await getApprovedHosts();
  if (!hosts) {
    fail('EGRESS_NOT_APPROVED', 'errors.hostsNotSynced', undefined, { hint: 'hints.openSettingsToSync' });
  }
  const list = cleanGroup((hosts as ApprovedHosts)[group]);
  if (!list.length || !new EgressFilteringService(list).isValidUrl(url.toString())) {
    fail('EGRESS_NOT_APPROVED', group === 'apis' ? 'errors.hostNotForTryItOut' : 'errors.hostNotForSpecs', { host: url.host }, {
      hint: group === 'apis' ? 'hints.askAdminApproveTryItOutHost' : 'hints.askAdminApproveSpecHost',
    });
  }
}
