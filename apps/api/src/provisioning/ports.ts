/**
 * The infrastructure the provisioning saga talks to (SAS section 3.1, steps 1 to 5). Every operation is idempotent by
 * its natural key and removing something that is not there succeeds, so a step can be repeated or compensated safely.
 */
export interface KeycloakAdminPort {
  /** Creates the organisation of the tenant, keyed by its alias (the tenant code). */
  ensureOrganization(alias: string): Promise<void>;
  removeOrganization(alias: string): Promise<void>;
}

export interface DnsPort {
  ensureRecord(hostname: string): Promise<void>;
  removeRecord(hostname: string): Promise<void>;
}

export interface AcmePort {
  ensureCertificate(hostname: string): Promise<void>;
}

export interface ObjectStoragePort {
  ensurePrefix(prefix: string): Promise<void>;
  /** Removes the prefix only while it is empty; a prefix that holds objects is left alone. */
  removeEmptyPrefix(prefix: string): Promise<void>;
}

export interface PlacementPort {
  assign(tenantId: string, placementId: string): Promise<void>;
  release(tenantId: string): Promise<void>;
}

export interface ProvisioningPorts {
  idp: KeycloakAdminPort;
  dns: DnsPort;
  acme: AcmePort;
  storage: ObjectStoragePort;
  placement: PlacementPort;
}
