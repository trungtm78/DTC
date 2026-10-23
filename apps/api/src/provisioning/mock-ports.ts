import type { AcmePort, DnsPort, KeycloakAdminPort, ObjectStoragePort, PlacementPort, ProvisioningPorts } from './ports';

/**
 * In-memory infrastructure for development and tests (adapter MOCK). It keeps the state a real adapter would keep in
 * the outside world, so a test can ask whether an organisation exists and how many calls reached it.
 */
export class MockProvisioningPorts implements ProvisioningPorts {
  readonly organizations = new Set<string>();
  readonly records = new Set<string>();
  readonly certificates = new Set<string>();
  readonly prefixes = new Set<string>();
  readonly placements = new Map<string, string>();
  /** Objects that make a prefix non-empty, by prefix. */
  readonly objects = new Map<string, number>();
  /** Calls per operation name, for example `idp.ensureOrganization`. */
  readonly calls = new Map<string, number>();

  private count(name: string): void {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
  }

  readonly idp: KeycloakAdminPort = {
    ensureOrganization: (alias) => {
      this.count('idp.ensureOrganization');
      this.organizations.add(alias);
      return Promise.resolve();
    },
    removeOrganization: (alias) => {
      this.count('idp.removeOrganization');
      this.organizations.delete(alias);
      return Promise.resolve();
    },
  };

  readonly dns: DnsPort = {
    ensureRecord: (hostname) => {
      this.count('dns.ensureRecord');
      this.records.add(hostname.toLowerCase());
      return Promise.resolve();
    },
    removeRecord: (hostname) => {
      this.count('dns.removeRecord');
      this.records.delete(hostname.toLowerCase());
      return Promise.resolve();
    },
  };

  readonly acme: AcmePort = {
    ensureCertificate: (hostname) => {
      this.count('acme.ensureCertificate');
      this.certificates.add(hostname.toLowerCase());
      return Promise.resolve();
    },
  };

  readonly storage: ObjectStoragePort = {
    ensurePrefix: (prefix) => {
      this.count('storage.ensurePrefix');
      this.prefixes.add(prefix);
      return Promise.resolve();
    },
    removeEmptyPrefix: (prefix) => {
      this.count('storage.removeEmptyPrefix');
      if ((this.objects.get(prefix) ?? 0) === 0) this.prefixes.delete(prefix);
      return Promise.resolve();
    },
  };

  readonly placement: PlacementPort = {
    assign: (tenantId, placementId) => {
      this.count('placement.assign');
      this.placements.set(tenantId, placementId);
      return Promise.resolve();
    },
    release: (tenantId) => {
      this.count('placement.release');
      this.placements.delete(tenantId);
      return Promise.resolve();
    },
  };

  callsTo(name: string): number {
    return this.calls.get(name) ?? 0;
  }
}

export type ProvisioningAdapter = 'MOCK';

/** The ports chosen by configuration (`PROVISIONING_ADAPTER`); only the MOCK adapter exists until the infrastructure story lands. */
export function createProvisioningPorts(adapter: string | undefined): ProvisioningPorts {
  if (adapter === 'MOCK') return new MockProvisioningPorts();
  throw new Error(`PROVISIONING_ADAPTER must be MOCK: no infrastructure adapter is configured (got ${adapter ?? 'nothing'})`);
}
