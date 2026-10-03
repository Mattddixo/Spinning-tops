import { permissions } from '@forge/bridge';
import type { EgressType } from '@forge/egress';
import { EGRESS_GROUPS } from '../../../../src/shared/types';
import { call, invoke } from '../api';

// Host approvals (customer-managed egress). egress.set pops Atlassian's consent
// dialog. Forge allows 10 groups per install and 10 domains per group.
export type EgressGroup = keyof typeof EGRESS_GROUPS;

// `title` is a translation key. `description` is stored by Atlassian and shown in
// its consent dialog and admin pages, so it stays in English for every admin.
export const GROUP_INFO: Record<EgressGroup, { title: string; description: string }> = {
  git: {
    title: 'ui.admin.groupGit',
    description: 'SpecPage: read OpenAPI files from your Git provider API (added automatically for Git connections).',
  },
  specs: {
    title: 'ui.admin.groupSpecs',
    description: 'SpecPage: load OpenAPI documents from these https:// hosts when URL sources are enabled.',
  },
  apis: {
    title: 'ui.admin.groupApis',
    description: 'SpecPage: relay "Try it out" requests from signed-in users to these API hosts.',
  },
};

export const MAX_DOMAINS_PER_GROUP = 10;

export class HostLimitError extends Error {
  constructor() {
    super(`Each list holds up to ${MAX_DOMAINS_PER_GROUP} hosts.`);
    this.name = 'HostLimitError';
  }
}

// @forge/egress pulls in Node-only code, so only import the type.
const FETCH_BACKEND = 'FETCH_BACKEND_SIDE' as unknown as EgressType;

export async function getApprovedHosts(): Promise<Record<EgressGroup, string[]>> {
  const res = await permissions.egress.get({ keys: Object.values(EGRESS_GROUPS) });
  const byKey = new Map(res.results.map((g) => [g.key, g.configured.map((c) => c.domain)]));
  return {
    git: byKey.get(EGRESS_GROUPS.git) ?? [],
    specs: byKey.get(EGRESS_GROUPS.specs) ?? [],
    apis: byKey.get(EGRESS_GROUPS.apis) ?? [],
  };
}

export function normaliseHost(input: string): string | undefined {
  const value = input.trim().toLowerCase();
  if (!value) return undefined;
  if (/^\*\.[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return value;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Resolves to the hosts that were newly approved (empty if all were already there). */
export async function approveHosts(group: EgressGroup, hosts: string[]): Promise<string[]> {
  const current = (await getApprovedHosts())[group];
  const all = [...new Set([...current, ...hosts])];
  if (all.length > MAX_DOMAINS_PER_GROUP) {
    throw new HostLimitError();
  }
  const added = all.filter((h) => !current.includes(h));
  if (!added.length) return [];
  const res = await permissions.egress.set({
    egresses: [
      {
        key: EGRESS_GROUPS[group],
        description: GROUP_INFO[group].description,
        configured: all.map((domain) => ({ domain, type: [FETCH_BACKEND] })),
      },
    ],
  });
  // Report what Atlassian actually stored, in case the admin declined the
  // consent dialog for some of it.
  const stored = res?.results?.find((g) => g.key === EGRESS_GROUPS[group])?.configured.map((c) => c.domain);
  return stored ? added.filter((h) => stored.includes(h)) : added;
}

export async function removeHost(group: EgressGroup, domain: string): Promise<void> {
  await permissions.egress.deleteDomain({ key: EGRESS_GROUPS[group], domain, type: FETCH_BACKEND });
}

// Host approvals go through Atlassian's consent dialog in the browser, so the
// backend never sees them. Report them so they show up in the activity log.
// A failed log write never undoes or blocks the approval itself.
export async function recordHostChange(action: 'host.approve' | 'host.remove', group: EgressGroup, hosts: string[]): Promise<void> {
  await Promise.allSettled(hosts.map((host) => call(invoke('adminRecordHostChange', { action, host, group }))));
}
