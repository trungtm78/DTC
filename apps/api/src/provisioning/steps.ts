import type { ProvisioningStep, RunRow, TenantRegistry, TenantRow } from '@machvon/db';
import type { ProvisioningPorts } from './ports';

export interface StepContext {
  tenant: TenantRow;
  run: RunRow;
  ports: ProvisioningPorts;
  registry: TenantRegistry;
}

export interface StepDefinition {
  step: ProvisioningStep;
  /** Idempotent by the natural key of SAS 3.1: running it twice leaves one of everything. */
  execute(context: StepContext): Promise<void>;
  /** Undoes the step when provisioning is cancelled; it also copes with a step that stopped half way. */
  compensate(context: StepContext): Promise<void>;
}

const hostnameOf = ({ registry, run }: StepContext): string => registry.hostnameOf(run.request.platform_subdomain);
const prefixOf = ({ tenant }: StepContext): string => `${tenant.id}/`;

/** Steps 1 to 5 of the saga: the infrastructure of a tenant, in order. */
export const INFRASTRUCTURE_STEP_DEFINITIONS: readonly StepDefinition[] = [
  {
    step: 'IDP_ORG',
    execute: ({ ports, tenant }) => ports.idp.ensureOrganization(tenant.code),
    compensate: ({ ports, tenant }) => ports.idp.removeOrganization(tenant.code),
  },
  {
    step: 'DNS_SUBDOMAIN',
    async execute(context) {
      const hostname = hostnameOf(context);
      // Reserve the hostname first: when another tenant owns it the step is refused (DOMAIN_TAKEN) before any record or
      // certificate exists, so nothing of this tenant can overwrite or later remove what the other tenant relies on.
      await context.registry.ensureDomain(context.tenant.id, hostname);
      await context.ports.dns.ensureRecord(hostname);
      await context.ports.acme.ensureCertificate(hostname);
    },
    async compensate(context) {
      const hostname = hostnameOf(context);
      // Only a hostname of this tenant has a record that is ours to remove.
      if (await context.registry.revokeDomain(context.tenant.id, hostname)) await context.ports.dns.removeRecord(hostname);
    },
  },
  {
    step: 'STORAGE_PREFIX',
    execute: (context) => context.ports.storage.ensurePrefix(prefixOf(context)),
    compensate: (context) => context.ports.storage.removeEmptyPrefix(prefixOf(context)),
  },
  {
    step: 'DB_PLACEMENT',
    execute: ({ ports, tenant }) => ports.placement.assign(tenant.id, tenant.placementId),
    compensate: ({ ports, tenant }) => ports.placement.release(tenant.id),
  },
  {
    step: 'RLS_SEED',
    execute: ({ registry, tenant }) => registry.probeIsolation(tenant.id),
    // The probe changes nothing, so there is nothing to undo.
    compensate: () => Promise.resolve(),
  },
];
