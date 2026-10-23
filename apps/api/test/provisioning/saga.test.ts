import { DomainError } from '@machvon/kernel';
import type { MetricsSink } from '@machvon/kernel';
import { RETRY_DELAYS_SECONDS, ProvisioningSaga, errorCodeOf } from '../../src/provisioning/saga';
import { INFRASTRUCTURE_STEP_DEFINITIONS } from '../../src/provisioning/steps';
import { Crash, FaultyPorts, ProvisioningHarness } from './provisioning-fixtures';
import { PLATFORM_TENANT_ID } from '@machvon/db';

class RecordingMetrics implements MetricsSink {
  readonly counters = new Map<string, number>();

  increment(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  gauge(): void {
    // not used by the saga
  }
}

describe('errorCodeOf', () => {
  it('keeps the registered code of a DomainError, an uppercase error code, and nothing else of an error', () => {
    expect(errorCodeOf(new DomainError('DOMAIN_TAKEN', 409))).toBe('DOMAIN_TAKEN');
    expect(errorCodeOf(Object.assign(new Error('secret connection string'), { code: 'RLS_PROBE_FAILED' }))).toBe('RLS_PROBE_FAILED');
    expect(errorCodeOf(new Error('boom'))).toBe('STEP_FAILED');
    expect(errorCodeOf(Object.assign(new Error('x'), { code: 'lower case with spaces' }))).toBe('STEP_FAILED');
    expect(errorCodeOf('text')).toBe('STEP_FAILED');
    expect(errorCodeOf(undefined)).toBe('STEP_FAILED');
  });
});

describe('ProvisioningSaga, steps 1 to 5', () => {
  const harness = new ProvisioningHarness();

  let delays: number[];
  let ports: FaultyPorts;
  let metrics: RecordingMetrics;

  const saga = (overridePorts: FaultyPorts = ports, delay: (seconds: number) => Promise<void> = (seconds) => {
    delays.push(seconds);
    return Promise.resolve();
  }): ProvisioningSaga => new ProvisioningSaga(harness.registry, overridePorts, { delay, metrics });

  beforeAll(() => harness.start(), 180_000);
  afterAll(() => harness.stop(), 60_000);

  beforeEach(() => {
    delays = [];
    ports = new FaultyPorts();
    metrics = new RecordingMetrics();
  });

  it('retries a step after 10 s, 1 min and 5 min (four tries), then fails the step, the run and the tenant, keeping finished steps', async () => {
    const { tenantId } = await harness.request();
    ports.failAlways('dns.ensureRecord');
    expect(await saga().run(tenantId, 1)).toBe('Failed');
    expect(delays).toEqual([10, 60, 300]);
    expect([...RETRY_DELAYS_SECONDS]).toEqual([10, 60, 300]);

    const detail = await harness.registry.getDetail(tenantId);
    expect(detail?.tenant.status).toBe('Failed');
    expect(detail?.run).toMatchObject({ status: 'Failed', errorCode: 'PORT_UNAVAILABLE', currentStep: 'DNS_SUBDOMAIN' });
    expect(detail?.run?.steps.IDP_ORG).toMatchObject({ status: 'DONE', attempts: 1 });
    expect(detail?.run?.steps.DNS_SUBDOMAIN).toMatchObject({ status: 'FAILED', attempts: 4, error_code: 'PORT_UNAVAILABLE' });
    expect(detail?.run?.steps.STORAGE_PREFIX.status).toBe('PENDING');
    expect(detail?.run?.steps.DB_PLACEMENT.status).toBe('PENDING');
    expect(ports.callsTo('storage.ensurePrefix')).toBe(0);
    expect(metrics.counters.get('tenant_provisioning_failed_total')).toBe(1);
  });

  it('runs all five steps once on the way through and leaves the tenant Provisioning for the later steps', async () => {
    const { tenantId } = await harness.request({ platformSubdomain: 'happy-path' });
    expect(await saga().run(tenantId, 1)).toBe('Completed');

    const detail = await harness.registry.getDetail(tenantId);
    expect(detail?.tenant.status).toBe('Provisioning');
    expect(detail?.run).toMatchObject({ status: 'Running', currentStep: 'ENTITLEMENT_V1' });
    for (const definition of INFRASTRUCTURE_STEP_DEFINITIONS) expect(detail?.run?.steps[definition.step]).toMatchObject({ status: 'DONE', attempts: 1 });
    expect(detail?.run?.steps.ENTITLEMENT_V1.status).toBe('PENDING');
    expect([...ports.organizations]).toEqual([detail?.tenant.code]);
    expect([...ports.records]).toEqual(['happy-path.machvon.vn']);
    expect([...ports.certificates]).toEqual(['happy-path.machvon.vn']);
    expect([...ports.prefixes]).toEqual([`${tenantId}/`]);
    expect(ports.placements.get(tenantId)).toBe(detail?.tenant.placementId);
    expect(await harness.count("select count(*) as n from machvon.tenant_domain where tenant_id = $1 and status = 'Active'", [tenantId])).toBe(1);
    expect(delays).toEqual([]);
  });

  it('repeats nothing that is DONE when the failed step is retried as attempt 2', async () => {
    const { tenantId } = await harness.request();
    ports.failAlways('storage.ensurePrefix');
    expect(await saga().run(tenantId, 1)).toBe('Failed');
    ports.heal('storage.ensurePrefix');

    const retry = await harness.control.withTenantOf(PLATFORM_TENANT_ID, async (tx) => {
      const tenant = await harness.registry.getTenant(tenantId);
      return harness.registry.startRetryRun(tx, tenantId, tenant?.version ?? 0, 'a0000000-0000-4000-8000-0000000000a1', PLATFORM_TENANT_ID, () => Promise.resolve());
    });
    const idpBefore = ports.callsTo('idp.ensureOrganization');
    const dnsBefore = ports.callsTo('dns.ensureRecord');
    expect(await saga().run(tenantId, retry.attempt)).toBe('Completed');

    expect(ports.callsTo('idp.ensureOrganization')).toBe(idpBefore);
    expect(ports.callsTo('dns.ensureRecord')).toBe(dnsBefore);
    expect(ports.callsTo('storage.ensurePrefix')).toBe(5);
    expect(ports.organizations.size).toBe(1);
    const second = await harness.registry.loadRun(tenantId, 2);
    expect(second?.steps.STORAGE_PREFIX).toMatchObject({ status: 'DONE', attempts: 1 });
    expect(second?.steps.IDP_ORG).toMatchObject({ status: 'DONE', attempts: 1 });
    expect((await harness.registry.getTenant(tenantId))?.status).toBe('Provisioning');
    expect((await harness.registry.loadRun(tenantId, 1))?.status).toBe('Failed');
  });

  it('does not create a second organisation when the runner dies between two tries and starts again', async () => {
    const { tenantId } = await harness.request({ platformSubdomain: 'crashy' });
    ports.failNext('dns.ensureRecord', 1);
    const dying = new ProvisioningSaga(harness.registry, ports, { delay: () => Promise.reject(new Crash('runner killed')) });
    await expect(dying.run(tenantId, 1)).rejects.toBeInstanceOf(Crash);

    const half = await harness.registry.loadRun(tenantId, 1);
    expect(half).toMatchObject({ status: 'Running', currentStep: 'DNS_SUBDOMAIN' });
    expect(half?.steps.IDP_ORG.status).toBe('DONE');
    expect(half?.steps.DNS_SUBDOMAIN).toMatchObject({ status: 'RUNNING', attempts: 1 });

    expect(await saga().run(tenantId, 1)).toBe('Completed');
    expect(ports.callsTo('idp.ensureOrganization')).toBe(1);
    expect(ports.organizations.size).toBe(1);
    expect((await harness.registry.loadRun(tenantId, 1))?.steps.DNS_SUBDOMAIN).toMatchObject({ status: 'DONE', attempts: 1 });
  });

  it('fails a step for good at once when the system itself refuses (DOMAIN_TAKEN), without waiting', async () => {
    const first = await harness.request({ platformSubdomain: 'contested' });
    expect(await saga().run(first.tenantId, 1)).toBe('Completed');
    const second = await harness.request({ platformSubdomain: 'contested' });
    expect(await saga().run(second.tenantId, 1)).toBe('Failed');
    expect(delays).toEqual([]);
    const run = await harness.registry.loadRun(second.tenantId, 1);
    expect(run).toMatchObject({ status: 'Failed', errorCode: 'DOMAIN_TAKEN' });
    expect(run?.steps.DNS_SUBDOMAIN).toMatchObject({ status: 'FAILED', attempts: 1, error_code: 'DOMAIN_TAKEN' });
  });

  it('never touches the DNS record or the certificate of a hostname another tenant owns, not even while undoing the failed step', async () => {
    const owner = await harness.request({ platformSubdomain: 'owned-elsewhere' });
    expect(await saga().run(owner.tenantId, 1)).toBe('Completed');
    const hostname = harness.registry.hostnameOf('owned-elsewhere');
    expect(ports.records.has(hostname)).toBe(true);
    const dnsCalls = ports.callsTo('dns.ensureRecord');
    const acmeCalls = ports.callsTo('acme.ensureCertificate');

    const intruder = await harness.request({ platformSubdomain: 'owned-elsewhere' });
    expect(await saga().run(intruder.tenantId, 1)).toBe('Failed');
    // The hostname is reserved before any infrastructure is created: the refused tenant created nothing.
    expect(ports.callsTo('dns.ensureRecord')).toBe(dnsCalls);
    expect(ports.callsTo('acme.ensureCertificate')).toBe(acmeCalls);

    await saga().compensate(intruder.tenantId, 1);
    expect(ports.records.has(hostname)).toBe(true);
    expect(ports.certificates.has(hostname)).toBe(true);
    expect(ports.callsTo('dns.removeRecord')).toBe(0);
  });

  it('runs the real isolation probe in step RLS_SEED and fails the step when row-level security is off', async () => {
    const { tenantId } = await harness.request();
    await harness.admin(async (client) => {
      await client.query('alter table machvon.tenant_provisioning_run no force row level security');
      await client.query('alter table machvon.tenant_provisioning_run disable row level security');
    });
    try {
      expect(await saga().run(tenantId, 1)).toBe('Failed');
    } finally {
      await harness.admin(async (client) => {
        await client.query('alter table machvon.tenant_provisioning_run enable row level security');
        await client.query('alter table machvon.tenant_provisioning_run force row level security');
      });
    }
    const run = await harness.registry.loadRun(tenantId, 1);
    expect(run).toMatchObject({ status: 'Failed', errorCode: 'RLS_PROBE_FAILED', currentStep: 'RLS_SEED' });
    expect(run?.steps.RLS_SEED).toMatchObject({ status: 'FAILED', attempts: 4 });
    expect(run?.steps.DB_PLACEMENT.status).toBe('DONE');
  });

  it('does not run a finished run again', async () => {
    const { tenantId } = await harness.request();
    ports.failAlways('idp.ensureOrganization');
    expect(await saga().run(tenantId, 1)).toBe('Failed');
    ports.heal('idp.ensureOrganization');
    const calls = ports.callsTo('idp.ensureOrganization');
    expect(await saga().run(tenantId, 1)).toBe('Failed');
    expect(ports.callsTo('idp.ensureOrganization')).toBe(calls);
    expect(await saga().run(tenantId, 1)).toBe('Failed');
  });

  it('refuses a tenant that is not Requested or Provisioning and a run or tenant that does not exist', async () => {
    const { tenantId } = await harness.request();
    await harness.registry.transition(tenantId, 'Requested', 'Provisioning');
    await harness.registry.transition(tenantId, 'Provisioning', 'Active');
    await expect(saga().run(tenantId, 1)).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID' });
    await expect(saga().run(tenantId, 9)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(saga().run('00000000-0000-4000-8000-0000000000ee', 1)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('undoes the steps in reverse order, a half-done step included, and leaves the tenant status to the archive command', async () => {
    const { tenantId } = await harness.request({ platformSubdomain: 'undo-me' });
    expect(await saga().run(tenantId, 1)).toBe('Completed');
    const order: string[] = [];
    for (const [group, method] of [['placement', 'release'], ['storage', 'removeEmptyPrefix'], ['dns', 'removeRecord'], ['idp', 'removeOrganization']] as const) {
      const target = ports[group] as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
      const original = target[method] as (...args: unknown[]) => Promise<void>;
      target[method] = (...args: unknown[]) => {
        order.push(`${group}.${method}`);
        return original.apply(target, args);
      };
    }
    await saga().compensate(tenantId, 1);

    expect(order).toEqual(['placement.release', 'storage.removeEmptyPrefix', 'dns.removeRecord', 'idp.removeOrganization']);
    expect(ports.organizations.size + ports.records.size + ports.prefixes.size + ports.placements.size).toBe(0);
    const run = await harness.registry.loadRun(tenantId, 1);
    for (const definition of INFRASTRUCTURE_STEP_DEFINITIONS) expect(run?.steps[definition.step].status).toBe('COMPENSATED');
    expect(await harness.count("select count(*) as n from machvon.tenant_domain where tenant_id = $1 and status = 'Revoked'", [tenantId])).toBe(1);
    expect((await harness.registry.getTenant(tenantId))?.status).toBe('Provisioning');
    await expect(harness.registry.transition(tenantId, 'Provisioning', 'Archived')).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID' });
  });

  it('compensates a step that failed after its port call took effect, and skips steps that never started', async () => {
    const { tenantId } = await harness.request({ platformSubdomain: 'half-done' });
    ports.failAlways('acme.ensureCertificate');
    expect(await saga().run(tenantId, 1)).toBe('Failed');
    expect(ports.records.has('half-done.machvon.vn')).toBe(true);
    await saga().compensate(tenantId, 1);
    expect(ports.records.size).toBe(0);
    expect(ports.callsTo('storage.removeEmptyPrefix')).toBe(0);
    const run = await harness.registry.loadRun(tenantId, 1);
    expect(run?.steps.DNS_SUBDOMAIN.status).toBe('COMPENSATED');
    expect(run?.steps.STORAGE_PREFIX.status).toBe('PENDING');
    // The tenant is Failed, so archiving it (the only way out) is a transition the table allows.
    await harness.registry.transition(tenantId, 'Failed', 'Archived');
    await expect(harness.registry.transition(tenantId, 'Archived', 'Provisioning')).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID' });
  });
});
