import { permissions } from '@forge/bridge';
import type { EgressType } from '@forge/egress';
import { EGRESS_GROUPS } from '../../../../src/shared/types';

/**
 * Customer-managed egress: admins approve every external host SpecPage may
 * contact. `permissions.egress.set` shows an Atlassian consent dialog.
 * Limits: 10 groups per installation, 10 domains per group.
 * https://developer.atlassian.com/platform/forge/customer-managed-egress-and-remotes/
 */
export type EgressGroup = keyof typeof EGRESS_GROUPS;

export const GROUP_INFO: Record<EgressGroup, { title: string; description: string }> = {
  git: {
    title: 'Git hosts',
    description: 'SpecPage: read OpenAPI files from your Git provider API (added automatically for Git connections).',
  },
  specs: {
    title: 'Spec hosts',
    description: 'SpecPage: load OpenAPI documents from these https:// hosts when URL sources are enabled.',
  },
  apis: {
    title: 'API hosts for "Try it out"',
    description: 'SpecPage: relay "Try it out" requests from signed-in users to these API hosts.',
  },
};

export const MAX_DOMAINS_PER_GROUP = 10;

// Typed as the enum without importing @forge/egress at runtime (it carries Node-only helpers).
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

/** Normalise admin input to an https origin or a "*.example.com" wildcard. */
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

export async function approveHosts(group: EgressGroup, hosts: string[]): Promise<void> {
  const current = (await getApprovedHosts())[group];
  const all = [...new Set([...current, ...hosts])];
  if (all.length > MAX_DOMAINS_PER_GROUP) {
    throw new Error(`Each list can hold up to ${MAX_DOMAINS_PER_GROUP} hosts. Remove one first or use a wildcard such as *.example.com.`);
  }
  if (all.length === current.length) return;
  await permissions.egress.set({
    egresses: [
      {
        key: EGRESS_GROUPS[group],
        description: GROUP_INFO[group].description,
        configured: all.map((domain) => ({ domain, type: [FETCH_BACKEND] })),
      },
    ],
  });
}

export async function removeHost(group: EgressGroup, domain: string): Promise<void> {
  await permissions.egress.deleteDomain({ key: EGRESS_GROUPS[group], domain, type: FETCH_BACKEND });
}
