import { MockProvisioningPorts, createProvisioningPorts } from '../../src/provisioning/mock-ports';
import { runPortsContract } from './ports.contract';

runPortsContract('MOCK', () => new MockProvisioningPorts());

describe('MockProvisioningPorts', () => {
  it('keeps one of everything however often it is asked and counts the calls that reached it', async () => {
    const ports = new MockProvisioningPorts();
    await ports.idp.ensureOrganization('acme');
    await ports.idp.ensureOrganization('acme');
    await ports.dns.ensureRecord('Acme.Machvon.VN');
    await ports.acme.ensureCertificate('acme.machvon.vn');
    expect([...ports.organizations]).toEqual(['acme']);
    expect([...ports.records]).toEqual(['acme.machvon.vn']);
    expect(ports.callsTo('idp.ensureOrganization')).toBe(2);
    expect(ports.callsTo('storage.ensurePrefix')).toBe(0);
  });

  it('leaves a storage prefix that still holds objects alone', async () => {
    const ports = new MockProvisioningPorts();
    await ports.storage.ensurePrefix('t/');
    ports.objects.set('t/', 3);
    await ports.storage.removeEmptyPrefix('t/');
    expect([...ports.prefixes]).toEqual(['t/']);
    ports.objects.set('t/', 0);
    await ports.storage.removeEmptyPrefix('t/');
    expect(ports.prefixes.size).toBe(0);
  });

  it('forgets the placement of a released tenant', async () => {
    const ports = new MockProvisioningPorts();
    await ports.placement.assign('t1', 'p1');
    expect(ports.placements.get('t1')).toBe('p1');
    await ports.placement.release('t1');
    expect(ports.placements.has('t1')).toBe(false);
  });
});

describe('createProvisioningPorts', () => {
  it('builds the MOCK adapter and refuses every other configuration', () => {
    expect(createProvisioningPorts('MOCK')).toBeInstanceOf(MockProvisioningPorts);
    expect(() => createProvisioningPorts('KEYCLOAK')).toThrow('PROVISIONING_ADAPTER');
    expect(() => createProvisioningPorts(undefined)).toThrow('nothing');
  });
});
