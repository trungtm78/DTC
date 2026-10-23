import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import { useSession } from '../../../session/SessionContext';
import { toCertificate, toPolicy } from './model';
import type { CertificateView, PolicyView } from './model';

export const certificatesKey = (tenantId: string | undefined) => ['adm', 'certificates', tenantId] as const;
export const policiesKey = (tenantId: string | undefined) => ['adm', 'security-policies', tenantId] as const;
const optionsKey = (kind: string, tenantId: string | undefined) => ['adm', 'security-options', kind, tenantId] as const;

/** Every certificate of the tenant, the soonest end of validity first (the order of the read). */
export function useCertificates() {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<CertificateView[]>({
    queryKey: certificatesKey(tenant?.id),
    queryFn: async () => (await client.readAll('get_resources_signing_certificate')).flatMap((raw) => toCertificate(raw) ?? []),
    enabled: tenant !== undefined,
    retry: false,
  });
}

/** Every policy version of the tenant, the newest revision first. */
export function usePolicies() {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<PolicyView[]>({
    queryKey: policiesKey(tenant?.id),
    queryFn: async () => (await client.readAll('get_resources_security_policy_version')).flatMap((raw) => toPolicy(raw) ?? []),
    enabled: tenant !== undefined,
    retry: false,
  });
}

export interface Option {
  id: string;
  label: string;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The members a personal certificate can belong to. */
export function useMemberOptions() {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<Option[]>({
    queryKey: optionsKey('members', tenant?.id),
    queryFn: async () =>
      (await client.readAll('get_resources_membership')).flatMap((raw) => {
        const row = raw as Record<string, unknown>;
        return typeof row.id === 'string' ? [{ id: row.id, label: str(row.display_name) || str(row.email) || row.id }] : [];
      }),
    enabled: tenant !== undefined,
    retry: false,
  });
}

/** The units an organisation certificate can belong to. */
export function useUnitOptions() {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<Option[]>({
    queryKey: optionsKey('units', tenant?.id),
    queryFn: async () =>
      (await client.readAll('get_resources_organization_unit')).flatMap((raw) => {
        const row = raw as Record<string, unknown>;
        return typeof row.id === 'string' ? [{ id: row.id, label: `${str(row.code)} · ${str(row.name)}` }] : [];
      }),
    enabled: tenant !== undefined,
    retry: false,
  });
}

/** The roles a policy can name (the codes the server checks against). */
export function useRoleCodes() {
  const client = useApiClient();
  const { tenant } = useSession();
  return useQuery<string[]>({
    queryKey: optionsKey('roles', tenant?.id),
    queryFn: async () =>
      (await client.readAll('get_resources_role_definition')).flatMap((raw) => {
        const code = (raw as Record<string, unknown>).code;
        return typeof code === 'string' ? [code] : [];
      }),
    enabled: tenant !== undefined,
    retry: false,
  });
}

export interface RegisterCertificateBody {
  kind: 'PERSONAL' | 'ORGANIZATION';
  holder_membership_id?: string;
  organization_unit_id?: string;
  certificate_pem: string;
  provider_code: string;
}

export function useRegisterCertificate() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (body: RegisterCertificateBody) => client.command('registerSigningCertificate', { body, attempt: attempts.current.forPayload(body) }),
    onSuccess: async () => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: certificatesKey(tenant?.id) });
    },
    onError: (error) => attempts.current.ended(error),
  });
}

export interface ReasonInput {
  id: string;
  version: number;
  reason: string;
}

/** Revokes a certificate (versioned: a stale version is a 409); one idempotency attempt per intention. */
export function useRevokeCertificate() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: ReasonInput) =>
      client.command('revokeSigningCertificate', {
        path: { certificateId: input.id },
        body: { reason: input.reason },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: certificatesKey(tenant?.id) });
    },
    onError: (error) => attempts.current.ended(error),
  });
}

export interface PolicyDraftBody {
  mfa_required_roles: string[];
  session_idle_minutes: number;
  session_max_hours: number;
  ip_allowlist?: string[];
  download_ttl_minutes?: number;
  export_watermark?: boolean;
}

export function useCreatePolicyDraft() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (body: PolicyDraftBody) => client.command('createSecurityPolicyVersion', { body, attempt: attempts.current.forPayload(body) }),
    onSuccess: async () => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: policiesKey(tenant?.id) });
    },
    onError: (error) => attempts.current.ended(error),
  });
}

/** Publishes a draft (versioned; the server refuses the author with SELF_APPROVAL_DENIED). */
export function usePublishPolicy() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const attempts = useRef(new AttemptRegistry());
  return useMutation({
    mutationFn: (input: ReasonInput) =>
      client.command('publishSecurityPolicy', {
        path: { policyId: input.id },
        body: { reason: input.reason },
        ifMatchVersion: input.version,
        attempt: attempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      attempts.current.done();
      await queryClient.invalidateQueries({ queryKey: policiesKey(tenant?.id) });
    },
    onError: (error) => attempts.current.ended(error),
  });
}
