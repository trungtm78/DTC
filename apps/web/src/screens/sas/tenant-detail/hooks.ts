import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import { useSession } from '../../../session/SessionContext';
import { tenantKey, tenantsKey } from '../tenants/hooks';
import { accessPolicyOf } from './rules';
import type { SuspensionReasonCode } from './rules';

/** What a lifecycle command answers (`TenantLifecycleResult`). */
export interface LifecycleResult {
  tenant_id: string;
  status: string;
  version: number;
}

export interface SuspendInput {
  tenantId: string;
  version: number;
  reasonCode: SuspensionReasonCode;
  reason: string;
}

export interface ResumeInput {
  tenantId: string;
  version: number;
  reason: string;
}

// The tenant and the registry both show the status: a change refreshes the two, so no screen keeps the old state.
function useRefreshTenant() {
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  return async (tenantId: string): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: tenantsKey(tenant?.id) });
    await queryClient.invalidateQueries({ queryKey: tenantKey(tenant?.id, tenantId) });
  };
}

/** Suspends an Active tenant (versioned: the control plane answers 409 for a version that is no longer current). One idempotency attempt per intention. */
export function useSuspendTenant() {
  const client = useApiClient();
  const refresh = useRefreshTenant();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: async (input: SuspendInput) =>
      (await client.command('suspendTenant', {
        path: { tenantId: input.tenantId },
        body: { reason_code: input.reasonCode, reason: input.reason, access_policy: accessPolicyOf(input.reasonCode) },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      })) as LifecycleResult,
    onSuccess: async (_result, input) => {
      attempts.current.done();
      await refresh(input.tenantId);
    },
    onError: (error) => attempts.current.ended(error),
  });
}

/** Resumes a Suspended tenant. */
export function useResumeTenant() {
  const client = useApiClient();
  const refresh = useRefreshTenant();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: async (input: ResumeInput) =>
      (await client.command('resumeTenant', {
        path: { tenantId: input.tenantId },
        body: { reason: input.reason },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      })) as LifecycleResult,
    onSuccess: async (_result, input) => {
      attempts.current.done();
      await refresh(input.tenantId);
    },
    onError: (error) => attempts.current.ended(error),
  });
}
