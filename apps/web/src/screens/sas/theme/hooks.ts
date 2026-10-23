import { uploadFile } from '@machvon/api-client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import { useSession } from '../../../session/SessionContext';
import { publishedThemeKey } from '../../../theme/PublishedThemeProvider';
import { VERSIONS_PAGE_SIZE } from './types';
import type { ThemeConfig, ThemeDraft, ThemeReview, ThemeVersion } from './types';

// Every key starts with the session tenant: a switch of tenant never shows what another tenant read.
const root = (sessionTenantId: string | undefined) => ['sas', 'theme', sessionTenantId] as const;
export const draftKey = (sessionTenantId: string | undefined, tenantId: string) => [...root(sessionTenantId), 'draft', tenantId] as const;
export const versionsKey = (sessionTenantId: string | undefined, tenantId: string) => [...root(sessionTenantId), 'versions', tenantId] as const;

export interface VersionPage {
  items: ThemeVersion[];
  nextCursor: string | undefined;
}

/** The draft of one tenant (revision 0 holds the published theme until someone edits it). */
export function useThemeDraft(tenantId: string | undefined, enabled: boolean) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<ThemeDraft>({
    queryKey: draftKey(tenant?.id, tenantId ?? ''),
    queryFn: () => client.read('getSystemTenantThemeDraft', { path: { tenantId: tenantId ?? '' } }),
    enabled: enabled && tenant !== undefined && tenantId !== undefined,
    retry: false,
    // The editor owns what it shows: a refetch on focus must not replace the form with the stored draft.
    refetchOnWindowFocus: false,
  });
}

/** The published versions of one tenant, newest first, page by page; the first one is the published theme. */
export function useThemeVersions(tenantId: string | undefined, enabled: boolean) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useInfiniteQuery<VersionPage, Error, { pages: VersionPage[] }, ReturnType<typeof versionsKey>, string | undefined>({
    queryKey: versionsKey(tenant?.id, tenantId ?? ''),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const page = await client.read('listSystemTenantThemeVersions', {
        path: { tenantId: tenantId ?? '' },
        query: { limit: VERSIONS_PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
      });
      return { items: page.items, nextCursor: page.nextCursor ?? undefined };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && tenant !== undefined && tenantId !== undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * The published theme of the own tenant, for a person who may read it but not change it. It is the cache entry the application
 * wrapper reads (`publishedThemeKey`), so what this screen finds is what the application applies.
 */
export function useMyPublishedTheme(enabled: boolean) {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<ThemeVersion>({
    queryKey: publishedThemeKey(tenant?.id, tenant?.membershipId),
    queryFn: () => client.read('getMyPublishedTheme'),
    enabled: enabled && tenant !== undefined,
    retry: false,
  });
}

export interface SaveDraftInput {
  tenantId: string;
  /** The revision the editor started from (`If-Match`). */
  revision: number;
  config: ThemeConfig;
}

/** Saves the draft; a stale revision is 409 VERSION_CONFLICT. One idempotency attempt per intention. */
export function useSaveDraft() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: SaveDraftInput) =>
      client.command('putSystemTenantThemeDraft', {
        path: { tenantId: input.tenantId },
        body: input.config,
        ifMatchVersion: input.revision,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: (draft, input) => {
      attempts.current.done();
      queryClient.setQueryData(draftKey(tenant?.id, input.tenantId), draft);
    },
    onError: (error) => attempts.current.ended(error),
  });
}

/** What a review is asked for: the saved draft, or an old version to restore with the reason. */
export type ReviewIntent = { kind: 'draft'; draftRevision: number } | { kind: 'restore'; sourceVersion: number; reason: string };

export interface ReviewInput {
  tenantId: string;
  baseVersion: number;
  intent: ReviewIntent;
}

/** Asks for the review of a candidate; the answer holds the token that publishes it, once, within 15 minutes. */
export function useRequestReview() {
  const client = useApiClient();
  const attempts = useRef(new AttemptRegistry());
  return useMutation<ThemeReview, Error, ReviewInput>({
    mutationFn: (input) =>
      client.command('reviewSystemTenantTheme', {
        path: { tenantId: input.tenantId },
        body:
          input.intent.kind === 'draft'
            ? { draftRevision: input.intent.draftRevision, baseVersion: input.baseVersion }
            : { sourceVersion: input.intent.sourceVersion, baseVersion: input.baseVersion, reason: input.intent.reason },
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: () => attempts.current.done(),
    onError: (error) => attempts.current.ended(error),
  });
}

export interface PublishInput {
  tenantId: string;
  token: string;
  baseVersion: number;
}

/** Publishes a reviewed candidate as the next version, then drops everything this screen read about the tenant. */
export function usePublishTheme() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation<ThemeVersion, Error, PublishInput>({
    mutationFn: (input) =>
      client.command('publishSystemTenantTheme', {
        path: { tenantId: input.tenantId },
        body: { reviewToken: input.token, baseVersion: input.baseVersion },
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async (_version, input) => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: draftKey(tenant?.id, input.tenantId) });
      await queryClient.invalidateQueries({ queryKey: versionsKey(tenant?.id, input.tenantId) });
    },
    onError: (error) => attempts.current.ended(error),
  });
}

export interface UploadLogoInput {
  tenantId: string;
  file: File;
}

/** Uploads a logo as multipart; the answer names the asset the draft may then use once it is clean. */
export function useUploadLogo() {
  const client = useApiClient();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: UploadLogoInput) =>
      uploadFile(client, 'uploadSystemTenantThemeAsset', {
        path: { tenantId: input.tenantId },
        file: input.file,
        // The same file again is the same intention: the server stores it once.
        attempt: attempts.current.forPayload({ tenantId: input.tenantId, name: input.file.name, size: input.file.size, type: input.file.type, modified: input.file.lastModified }),
      }),
    onSuccess: () => attempts.current.done(),
    onError: (error) => attempts.current.ended(error),
  });
}
