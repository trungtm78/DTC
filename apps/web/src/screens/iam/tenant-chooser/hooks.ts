import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../../session/SessionContext';
import type { SessionTenant, TenantCandidate } from '../../../session/SessionContext';

/** A tenant of a session that has no memberships to ask for (the development session) shown as an ordinary membership. */
function candidateOf(tenant: SessionTenant): TenantCandidate {
  return {
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    tenant_status: 'Active',
    membership_id: tenant.membershipId,
    membership_type: 'STAFF',
    status: 'Active',
    valid_from: '1970-01-01T00:00:00.000Z',
    valid_until: null,
  };
}

/** The memberships the person may choose from: asked of the API after a real sign-in, the session's own tenants otherwise. */
export function useCandidates() {
  const session = useSession();
  const { loadCandidates, tenants } = session;
  return useQuery({
    queryKey: ['iam-tenant-candidates', session.identity?.subject ?? 'development', tenants.map((tenant) => tenant.id).join(',')],
    queryFn: async (): Promise<readonly TenantCandidate[]> => (loadCandidates === undefined ? tenants.map(candidateOf) : await loadCandidates()),
    retry: false,
    gcTime: 0,
  });
}
