import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { useSession } from '../../../session/SessionContext';
import type { RoleView } from '../roles/types';
import { PAGE_SIZE, toContractOption, toMemberPage, toUnitOption } from './types';
import type { ContractOption, MemberPage, MembershipType, UnitOption } from './types';

const MEMBERS_KEY = 'adm-members';
const UNITS_KEY = 'adm-members-units';
const ROLES_KEY = 'adm-members-roles';
const CONTRACTS_KEY = 'adm-members-contracts';

/** The memberships of the directory, page by page; `type` limits them to one kind (ADM-17 lists the guests only). */
export function useMembers(type: MembershipType | undefined, enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useInfiniteQuery<MemberPage, Error, { pages: MemberPage[] }, readonly unknown[], string | undefined>({
    queryKey: [MEMBERS_KEY, tenantId, type ?? 'all'],
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) =>
      toMemberPage(
        await client.read('get_resources_membership', {
          query: { limit: PAGE_SIZE, ...(type === undefined ? {} : { membership_type: type }), ...(pageParam === undefined ? {} : { cursor: pageParam }) },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && tenantId !== undefined,
    retry: false,
  });
}

/** The units of the tenant the caller may read: the invitation picks the unit of the new member from them. */
export function useUnits(enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useQuery<UnitOption[]>({
    queryKey: [UNITS_KEY, tenantId],
    queryFn: async () => (await client.readAll('get_resources_organization_unit')).flatMap(toUnitOption),
    enabled: enabled && tenantId !== undefined,
    retry: false,
  });
}

/** The roles the signed-in user could hand out; the invitation offers nothing else. */
export function useGrantableRoles(enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useQuery<RoleView[]>({
    queryKey: [ROLES_KEY, tenantId],
    queryFn: async () => (await client.readAll('get_resources_role_definition', { query: { grantable: true } })) as RoleView[],
    enabled: enabled && tenantId !== undefined,
    retry: false,
  });
}

/** The contracts the caller reaches (the picker of the guest invitation). */
export function useContracts(enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useQuery<ContractOption[]>({
    queryKey: [CONTRACTS_KEY, tenantId],
    queryFn: async () => (await client.readAll('get_resources_contract')).flatMap(toContractOption),
    enabled: enabled && tenantId !== undefined,
    retry: false,
  });
}

/** Reloads the directory after a command changed a membership. */
export function useRefreshMembers(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: [MEMBERS_KEY] }), [queryClient]);
}
