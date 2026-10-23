import type { ProvisioningPorts } from '../../src/provisioning/ports';

/**
 * The contract every infrastructure adapter of the provisioning saga must meet (SAS BR-SAS-02): each operation is
 * idempotent by its natural key and removing something that is not there succeeds. The MOCK adapter runs it here; a
 * Keycloak, DNS, ACME, object storage or placement adapter runs the same function against its sandbox.
 */
export function runPortsContract(name: string, create: () => ProvisioningPorts): void {
  describe(`provisioning ports contract: ${name}`, () => {
    it('creates an organisation once however often it is asked, and removing a missing one succeeds', async () => {
      const ports = create();
      await ports.idp.ensureOrganization('acme');
      await ports.idp.ensureOrganization('acme');
      await ports.idp.removeOrganization('acme');
      await expect(ports.idp.removeOrganization('acme')).resolves.toBeUndefined();
    });

    it('handles a DNS record and its certificate repeatably, and removes a record that is gone', async () => {
      const ports = create();
      await ports.dns.ensureRecord('acme.machvon.vn');
      await ports.dns.ensureRecord('acme.machvon.vn');
      await ports.acme.ensureCertificate('acme.machvon.vn');
      await ports.acme.ensureCertificate('acme.machvon.vn');
      await ports.dns.removeRecord('acme.machvon.vn');
      await expect(ports.dns.removeRecord('acme.machvon.vn')).resolves.toBeUndefined();
    });

    it('creates a storage prefix repeatably and removes a prefix that is missing', async () => {
      const ports = create();
      await ports.storage.ensurePrefix('tenant-1/');
      await ports.storage.ensurePrefix('tenant-1/');
      await ports.storage.removeEmptyPrefix('tenant-1/');
      await expect(ports.storage.removeEmptyPrefix('tenant-1/')).resolves.toBeUndefined();
    });

    it('assigns a placement repeatably and releases a tenant that has none', async () => {
      const ports = create();
      await ports.placement.assign('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1');
      await ports.placement.assign('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1');
      await ports.placement.release('00000000-0000-4000-8000-000000000001');
      await expect(ports.placement.release('00000000-0000-4000-8000-000000000001')).resolves.toBeUndefined();
    });
  });
}
