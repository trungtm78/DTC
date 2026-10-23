import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import { useSession } from '../../../session/SessionContext';
import { toDetail, toPage } from './types';
import { entriesRoot, registersRoot } from '../registers/hooks';
import type { OutgoingDetail, OutgoingPage, OutgoingRow } from './types';

export const QUEUE_LIMIT = 50;

export const queueKey = (tenantId: string | undefined, status: string) => ['doc', 'outgoing-queue', tenantId, status] as const;
export const documentKey = (tenantId: string | undefined, id: string | undefined) => ['doc', 'outgoing-document', tenantId, id ?? ''] as const;

async function refresh(queryClient: QueryClient, tenantId: string | undefined): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['doc', 'outgoing-queue', tenantId] }),
    queryClient.invalidateQueries({ queryKey: ['doc', 'outgoing-document', tenantId] }),
  ]);
}

/** The documents in one state, newest first, page by page: the queue the signing and numbering screens pick from. */
export function useOutgoingQueue(status: string) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useInfiniteQuery<OutgoingPage, Error, { pages: OutgoingPage[] }, ReturnType<typeof queueKey>, string | undefined>({
    queryKey: queueKey(tenant?.id, status),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) =>
      toPage(await client.read('listOutgoingDocuments', { query: { status, limit: QUEUE_LIMIT, ...(pageParam === undefined ? {} : { cursor: pageParam }) } })),
    getNextPageParam: (last) => last.nextCursor,
    enabled: tenant !== undefined,
    retry: false,
  });
}

/** The documents of every page loaded so far. */
export function queueItems(data: { pages: OutgoingPage[] } | undefined): OutgoingRow[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/** One document with its sessions, file versions, certificates and the signatures of its current version. */
export function useOutgoingDocument(id: string | undefined) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<OutgoingDetail>({
    queryKey: documentKey(tenant?.id, id),
    queryFn: async () => toDetail(await client.read('getOutgoingDocument', { path: { id: id ?? '' } })),
    enabled: tenant !== undefined && id !== undefined,
    retry: false,
  });
}

export interface StartInput {
  documentId: string;
  /** The version of the document the screen showed: the server answers 409 when it moved on. */
  version: number;
  certificateId: string | undefined;
  adapterCode: 'REMOTE_CA' | 'LOCAL_AGENT' | undefined;
  certifyDocmdp?: boolean;
}

/** Opens the leader signing session (202): the document stays SUBMITTED until the signer confirms. */
export function useStartLeaderSigning() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: StartInput) =>
      client.command('startLeaderSigning', {
        path: { id: input.documentId },
        body: {
          ...(input.certificateId === undefined ? {} : { certificate_id: input.certificateId }),
          ...(input.adapterCode === undefined ? {} : { adapter_code: input.adapterCode }),
          ...(input.certifyDocmdp === true ? { certify_docmdp: true } : {}),
        },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      attempts.current.done();
      await refresh(queryClient, tenant?.id);
    },
    onError: (error) => attempts.current.ended(error),
  });
}

/** Opens the organisation seal session of a numbered document (202). */
export function useStartSeal() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: Omit<StartInput, 'certifyDocmdp'>) =>
      client.command('startOrganizationSeal', {
        path: { id: input.documentId },
        body: {
          ...(input.certificateId === undefined ? {} : { certificate_id: input.certificateId }),
          ...(input.adapterCode === undefined ? {} : { adapter_code: input.adapterCode }),
        },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      attempts.current.done();
      await refresh(queryClient, tenant?.id);
    },
    onError: (error) => attempts.current.ended(error),
  });
}

export interface CompleteInput {
  sessionId: string;
  version: number;
  /** What the signer typed to confirm on their device, when the provider asks for it. */
  confirmation: string | undefined;
}

/** Completes a signing session of either role: the signature is embedded and checked at once. */
export function useCompleteSigning() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: CompleteInput) =>
      client.command('completeSigningSession', {
        path: { id: input.sessionId },
        body: input.confirmation === undefined || input.confirmation === '' ? {} : { otp_confirmation: input.confirmation },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      attempts.current.done();
      await refresh(queryClient, tenant?.id);
    },
    onError: (error) => attempts.current.ended(error),
  });
}

export interface AssignInput {
  documentId: string;
  version: number;
  registerId: string;
  issuedOn: string;
}

/** Numbers a signed document from a register (BR-DOC-02 to BR-DOC-04); the registers and their logs move on with it. */
export function useAssignNumber() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: AssignInput) =>
      client.command('assignOutgoingDocumentNumber', {
        path: { id: input.documentId },
        body: { register_id: input.registerId, issued_on: input.issuedOn },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      attempts.current.done();
      // The counter of the register moved: its next number, the list of registers and the log must be read again.
      await Promise.all([
        refresh(queryClient, tenant?.id),
        queryClient.invalidateQueries({ queryKey: registersRoot(tenant?.id) }),
        queryClient.invalidateQueries({ queryKey: entriesRoot(tenant?.id) }),
      ]);
    },
    onError: (error) => attempts.current.ended(error),
  });
}

/** A short-lived address of a stored file version (at most 300 seconds). */
export function useDownloadUrl() {
  const client = useApiClient();
  return useMutation({
    mutationFn: async (versionId: string): Promise<string> => {
      const body = (await client.read('getDocumentVersionDownload', { path: { id: versionId } })) as { url?: unknown };
      return typeof body.url === 'string' ? body.url : '';
    },
  });
}
