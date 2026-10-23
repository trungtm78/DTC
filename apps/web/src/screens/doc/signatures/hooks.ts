import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import { useSession } from '../../../session/SessionContext';
import { toReport, toVersion, toVersionPage } from './types';
import type { Policy, Report, VersionFacts, VersionPage } from './types';

export const PAGE_SIZE = 50;

export const reportKey = (tenantId: string | undefined, versionId: string | undefined) => ['doc', 'signature-report', tenantId, versionId ?? ''] as const;
export const versionKey = (tenantId: string | undefined, versionId: string | undefined) => ['doc', 'signature-version', tenantId, versionId ?? ''] as const;
export const versionsKey = (tenantId: string | undefined) => ['doc', 'signature-versions', tenantId] as const;

/** The latest verification of a version; only asked for once a version is chosen. */
export function useSignatureReport(versionId: string | undefined, enabled: boolean) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<Report>({
    queryKey: reportKey(tenant?.id, versionId),
    queryFn: async () => toReport(await client.read('getDocumentSignatureReport', { path: { id: versionId ?? '' } })),
    enabled: tenant !== undefined && versionId !== undefined && enabled,
    retry: false,
  });
}

/** The facts of the chosen version, shown in the related-file card. */
export function useVersionFacts(versionId: string | undefined) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<VersionFacts>({
    queryKey: versionKey(tenant?.id, versionId),
    queryFn: async () => toVersion(await client.read('get_resources_document_version_id', { path: { id: versionId ?? '' } })),
    enabled: tenant !== undefined && versionId !== undefined,
    retry: false,
  });
}

/** The versions a person can choose from when the screen is opened without one. */
export function useVersions(enabled: boolean) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useInfiniteQuery<VersionPage, Error, { pages: VersionPage[] }, ReturnType<typeof versionsKey>, string | undefined>({
    queryKey: versionsKey(tenant?.id),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) =>
      toVersionPage(await client.read('get_resources_document_version', { query: { limit: PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }) } })),
    getNextPageParam: (last) => last.nextCursor,
    enabled: tenant !== undefined && enabled,
    retry: false,
  });
}

export interface VerifyInput {
  versionId: string;
  policy: Policy;
  revalidateRevocation: boolean;
}

/** Verifies the signatures again: a new verification is stored, the earlier one stays; one idempotency attempt per intention. */
export function useVerifySignatures() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: VerifyInput) =>
      client.command('verifyDocumentSignatures', {
        path: { id: input.versionId },
        body: { policy: input.policy, revalidate_revocation: input.revalidateRevocation },
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async (_result, input) => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: reportKey(tenant?.id, input.versionId) });
    },
    onError: (error) => attempts.current.ended(error),
  });
}
