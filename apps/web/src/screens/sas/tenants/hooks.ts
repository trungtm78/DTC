import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { useSession } from '../../../session/SessionContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import type { TenantProvisionBody } from './rules';
import { toTenantDetail, toTenantSummary } from './types';
import type { TenantDetail, TenantSummary } from './types';

export const PAGE_SIZE = 50;

export const tenantsKey = (sessionTenantId: string | undefined) => ['sas', 'tenants', sessionTenantId] as const;
const tenantKey = (sessionTenantId: string | undefined, tenantId: string) => ['sas', 'tenant', sessionTenantId, tenantId] as const;
export const entitlementsKey = (sessionTenantId: string | undefined, tenantId: string | undefined) => ['sas', 'entitlements', sessionTenantId, tenantId ?? 'mine'] as const;

export interface TenantPage {
  items: TenantSummary[];
  nextCursor: string | undefined;
}

/** The registry, page by page (keyset cursor); the next page is loaded on request. */
export function useTenantList(enabled = true) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useInfiniteQuery<TenantPage, Error, { pages: TenantPage[] }, ReturnType<typeof tenantsKey>, string | undefined>({
    queryKey: tenantsKey(tenant?.id),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const page = (await client.read('listSystemTenants', { query: { limit: PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }) } })) as {
        items?: unknown[];
        next_cursor?: string | null;
      };
      return { items: (page.items ?? []).map(toTenantSummary), nextCursor: page.next_cursor ?? undefined };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && tenant !== undefined,
    retry: false,
  });
}

/** The provisioning run of one tenant; only asked for tenants whose saga is working or has failed. */
export function useTenantDetail(tenantId: string, enabled: boolean) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<TenantDetail>({
    queryKey: tenantKey(tenant?.id, tenantId),
    queryFn: async () => toTenantDetail(await client.read('getSystemTenant', { path: { tenantId } })),
    enabled: enabled && tenant !== undefined,
    retry: false,
  });
}

export interface EntitlementRow {
  featureCode: string;
  allowed: boolean;
  limit: string | undefined;
  used: string | undefined;
  source: string;
  mode: string;
}

export interface EntitlementTable {
  versionNo: number;
  hash: string;
  licenseStatus: string | undefined;
  features: EntitlementRow[];
}

function toTable(raw: unknown): EntitlementTable {
  const view = (raw ?? {}) as Record<string, unknown>;
  const features = Array.isArray(view.features) ? (view.features as Array<Record<string, unknown>>) : [];
  return {
    versionNo: typeof view.version_no === 'number' ? view.version_no : 0,
    hash: typeof view.entitlements_hash === 'string' ? view.entitlements_hash : '',
    licenseStatus: typeof view.license_status === 'string' ? view.license_status : undefined,
    features: features.map((feature) => ({
      featureCode: typeof feature.feature_code === 'string' ? feature.feature_code : '',
      allowed: feature.allowed === true,
      limit: typeof feature.limit === 'string' ? feature.limit : undefined,
      used: typeof feature.used === 'string' ? feature.used : undefined,
      source: typeof feature.source === 'string' ? feature.source : 'PLAN',
      mode: typeof feature.mode === 'string' ? feature.mode : 'DENIED',
    })),
  };
}

/**
 * What a tenant may do: the control plane reads any tenant (`getTenantEntitlements`), the tenant plane reads its own
 * (`getMyEntitlements`, when no tenant id is given). The query is keyed by the session tenant, so a switch never shows
 * another tenant's table, and it is invalidated when the entitlement push arrives.
 */
export function useEntitlements(tenantId: string | undefined, enabled = true) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<EntitlementTable>({
    queryKey: entitlementsKey(tenant?.id, tenantId),
    queryFn: async () =>
      toTable(tenantId === undefined ? await client.read('getMyEntitlements') : await client.read('getTenantEntitlements', { path: { tenantId } })),
    enabled: enabled && tenant !== undefined,
    retry: false,
  });
}

/** Requests provisioning of a tenant; one idempotency attempt per payload, so a double click or a retry runs it once. */
export function useProvisionTenant() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: async (body: TenantProvisionBody) =>
      (await client.command('requestTenantProvisioning', { body, attempt: attempts.current.forPayload(body) })) as {
        tenant_id: string;
        status: string;
        provisioning_run_id?: string;
        version: number;
      },
    onSuccess: async () => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: tenantsKey(tenant?.id) });
    },
  });
}

export interface RetryInput {
  tenantId: string;
  version: number;
  reason: string;
}

/** Retries the provisioning of a Failed tenant (versioned: the registry answers 409 for a stale version). */
export function useRetryProvisioning() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: async (input: RetryInput) =>
      client.command('retryTenantProvisioning', {
        path: { tenantId: input.tenantId },
        body: { reason: input.reason },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async (_result, input) => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: tenantsKey(tenant?.id) });
      await queryClient.invalidateQueries({ queryKey: tenantKey(tenant?.id, input.tenantId) });
    },
  });
}
