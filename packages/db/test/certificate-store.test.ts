import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { ParsedCertificate } from '@machvon/kernel';
import { CertificateStore } from '../src/certificate-store';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId, unitId } from './support/authz-fixtures';

const ADMIN = memberId(1);
const HOLDER = memberId(2);
const DAY = 86_400_000;
const path = (...ns: number[]): string => `/${ns.map(unitId).join('/')}/`;

function parsedCertificate(options: { validFrom?: Date; validUntil?: Date; fingerprint?: string } = {}): ParsedCertificate {
  const now = Date.now();
  return {
    serial: '0A1B',
    issuerDn: 'CN=Test CA',
    subjectDn: 'CN=Nguyen Van A',
    validFrom: options.validFrom ?? new Date(now - 30 * DAY),
    validUntil: options.validUntil ?? new Date(now + 365 * DAY),
    fingerprintSha256: options.fingerprint ?? createHash('sha256').update(randomUUID()).digest('hex'),
  };
}

describe('CertificateStore (ST-ADM-008)', () => {
  const harness = new AuthzHarness();
  const store = new CertificateStore();
  const ctxA = contextFor(TENANT_A, ADMIN);
  const ctxB = contextFor(TENANT_B, ADMIN);
  const asA = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]): Promise<T> => harness.tenants.withTenant(ctxA, work);
  const asB = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]): Promise<T> => harness.tenants.withTenant(ctxB, work);

  const registerPersonal = (parsed = parsedCertificate()): Promise<{ id: string; version: number }> =>
    asA((tx) => store.register(tx, { kind: 'PERSONAL', holderMembershipId: HOLDER, providerCode: 'VNPT-CA', parsed }, ADMIN));

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [{ n: 1, path: path(1) }]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: path(1) }]);
    await harness.seedMembership(TENANT_A, 1, 1);
    await harness.seedMembership(TENANT_A, 2, 1);
    await harness.seedMembership(TENANT_B, 1, 1);
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  afterEach(async () => {
    await harness.owner(TENANT_A, [['delete from machvon.signing_certificate', []]]);
    await harness.owner(TENANT_B, [['delete from machvon.signing_certificate', []]]);
  });

  describe('register', () => {
    it('registers a personal certificate as Active at version 1 and keeps only public facts', async () => {
      const parsed = parsedCertificate();
      const { id, version } = await registerPersonal(parsed);
      expect(version).toBe(1);
      const row = await asA((tx) => store.find(tx, id));
      expect(row).toMatchObject({
        kind: 'PERSONAL',
        holderMembershipId: HOLDER,
        organizationUnitId: null,
        serial: '0A1B',
        subjectDn: 'CN=Nguyen Van A',
        issuerDn: 'CN=Test CA',
        providerCode: 'VNPT-CA',
        fingerprintSha256: parsed.fingerprintSha256,
        status: 'Active',
        registeredBy: ADMIN,
        version: 1,
      });
      const columns = await harness.owner<{ column_name: string }>(TENANT_A, [
        ["select column_name from information_schema.columns where table_schema = 'machvon' and table_name = 'signing_certificate'", []],
      ]);
      expect(columns.map((column) => column.column_name).filter((name) => /pem|private|secret|key_material/.test(name))).toEqual([]);
    });

    it('registers an organisation certificate for an existing unit', async () => {
      const { id } = await asA((tx) => store.register(tx, { kind: 'ORGANIZATION', organizationUnitId: unitId(1), providerCode: 'VNPT-CA', parsed: parsedCertificate() }, ADMIN));
      expect(await asA((tx) => store.find(tx, id))).toMatchObject({ kind: 'ORGANIZATION', organizationUnitId: unitId(1), holderMembershipId: null });
    });

    it.each([
      ['a personal certificate without its holder', { kind: 'PERSONAL' as const }, 'holder_membership_id'],
      ['an organisation certificate without its unit', { kind: 'ORGANIZATION' as const }, 'organization_unit_id'],
      ['a personal certificate of a membership that does not exist', { kind: 'PERSONAL' as const, holderMembershipId: memberId(99) }, 'holder_membership_id'],
      ['an organisation certificate of a unit that does not exist', { kind: 'ORGANIZATION' as const, organizationUnitId: unitId(99) }, 'organization_unit_id'],
    ])('refuses %s with 422 naming the field', async (_label, partial, field) => {
      await expect(asA((tx) => store.register(tx, { ...partial, providerCode: 'VNPT-CA', parsed: parsedCertificate() }, ADMIN))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 422,
        detail: field,
      });
    });

    it('answers a second registration of the same fingerprint with 409 CERTIFICATE_DUPLICATE and keeps one row', async () => {
      const parsed = parsedCertificate();
      await registerPersonal(parsed);
      await expect(registerPersonal(parsed)).rejects.toMatchObject({ code: 'CERTIFICATE_DUPLICATE', status: 409 });
      expect((await harness.owner<{ n: string }>(TENANT_A, [['select count(*) as n from machvon.signing_certificate', []]]))[0]?.n).toBe('1');
    });

    it('lets exactly one of two parallel registrations of one fingerprint win', async () => {
      const parsed = parsedCertificate();
      const results = await Promise.allSettled([registerPersonal(parsed), registerPersonal(parsed)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ code: 'CERTIFICATE_DUPLICATE', status: 409 });
    });

    it('keeps tenants apart: the same fingerprint is free in another tenant and invisible there', async () => {
      const parsed = parsedCertificate();
      const { id } = await registerPersonal(parsed);
      const other = await asB((tx) => store.register(tx, { kind: 'PERSONAL', holderMembershipId: memberId(1), providerCode: 'VNPT-CA', parsed }, ADMIN));
      expect(other.id).not.toBe(id);
      expect(await asB((tx) => store.find(tx, id))).toBeUndefined();
      expect((await asB((tx) => store.list(tx, { limit: 10, after: undefined }))).map((row) => row.id)).toEqual([other.id]);
    });
  });

  describe('reads', () => {
    it('lists the certificates that end soonest first and pages with a keyset', async () => {
      const now = Date.now();
      const ids: string[] = [];
      for (const days of [90, 10, 50, 30]) {
        ids.push((await registerPersonal(parsedCertificate({ validUntil: new Date(now + days * DAY) }))).id);
      }
      const [d90, d10, d50, d30] = ids as [string, string, string, string];
      const first = await asA((tx) => store.list(tx, { limit: 3, after: undefined }));
      expect(first.map((row) => row.id)).toEqual([d10, d30, d50, d90].slice(0, 3));
      const last = first[2] as { validUntil: string; id: string };
      const rest = await asA((tx) => store.list(tx, { limit: 3, after: { code: last.validUntil, id: last.id } }));
      expect(rest.map((row) => row.id)).toEqual([d90]);
    });

    it.each(['not-a-date', '2026-13-45T00:00:00.000000Z', ''])('refuses the cursor %p without reaching the database cast', async (code) => {
      await expect(asA((tx) => store.list(tx, { limit: 10, after: { code, id: randomUUID() } }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', detail: 'cursor' });
    });

    it('reports an Active certificate whose validity has ended as Expired before the job has run', async () => {
      const { id } = await registerPersonal(parsedCertificate({ validFrom: new Date(Date.now() - 2 * DAY), validUntil: new Date(Date.now() - DAY) }));
      expect(await asA((tx) => store.find(tx, id))).toMatchObject({ status: 'Expired', version: 1 });
      const stored = await harness.owner<{ status: string }>(TENANT_A, [['select status from machvon.signing_certificate where id = $1', [id]]]);
      expect(stored[0]?.status).toBe('Active');
    });
  });

  describe('revoke', () => {
    it('revokes an Active certificate with its reason and a new version, and the revocation is final', async () => {
      const { id } = await registerPersonal();
      const { version } = await asA(async (tx) => store.revoke(tx, await store.lock(tx, id, 1), 'Key compromise reported'));
      expect(version).toBe(2);
      expect(await asA((tx) => store.find(tx, id))).toMatchObject({ status: 'Revoked', statusReason: 'Key compromise reported', version: 2 });
      await expect(asA((tx) => store.lock(tx, id, 2))).rejects.toMatchObject({ code: 'STAGE_TRANSITION_DENIED', status: 409 });
    });

    it('answers 404 for a certificate that is not there and 409 VERSION_CONFLICT for a stale version', async () => {
      await expect(asA((tx) => store.lock(tx, randomUUID(), 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      const { id } = await registerPersonal();
      await expect(asA((tx) => store.lock(tx, id, 7))).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    });

    it('never finds a certificate of another tenant to revoke', async () => {
      const { id } = await registerPersonal();
      await expect(asB((tx) => store.lock(tx, id, 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });
  });

  describe('expiry job and reminders', () => {
    it('makes the stored status of ended certificates Expired once, and leaves the others', async () => {
      const ended = await registerPersonal(parsedCertificate({ validFrom: new Date(Date.now() - 2 * DAY), validUntil: new Date(Date.now() - DAY) }));
      const live = await registerPersonal();
      expect(await asA((tx) => store.expireDue(tx))).toBe(1);
      expect(await asA((tx) => store.expireDue(tx))).toBe(0);
      const stored = await harness.owner<{ id: string; status: string; status_reason: string | null }>(TENANT_A, [['select id, status, status_reason from machvon.signing_certificate order by id', []]]);
      expect(Object.fromEntries(stored.map((row) => [row.id, row.status]))).toEqual({ [ended.id]: 'Expired', [live.id]: 'Active' });
      expect(stored.find((row) => row.id === ended.id)?.status_reason).toBe('VALIDITY_ENDED');
    });

    it('lists the certificates that end within 30 days and have not ended yet, nearest first', async () => {
      const now = Date.now();
      const in25 = await registerPersonal(parsedCertificate({ validUntil: new Date(now + 25 * DAY) }));
      const in5 = await registerPersonal(parsedCertificate({ validUntil: new Date(now + 5 * DAY) }));
      await registerPersonal(parsedCertificate({ validUntil: new Date(now + 40 * DAY) }));
      const revoked = await registerPersonal(parsedCertificate({ validUntil: new Date(now + 10 * DAY) }));
      await asA(async (tx) => store.revoke(tx, await store.lock(tx, revoked.id, 1), 'Revoked by the holder'));
      expect((await asA((tx) => store.expiringWithin(tx, 30))).map((row) => row.id)).toEqual([in5.id, in25.id]);
    });
  });

  describe('database guards', () => {
    it('refuses to change the identity of a registered certificate, even for the owner role', async () => {
      const { id } = await registerPersonal();
      for (const column of ['fingerprint_sha256', 'certificate_serial', 'subject_dn', 'issuer_dn', 'provider_code', 'registered_by']) {
        const value = column === 'registered_by' ? memberId(2) : 'changed';
        await expect(harness.owner(TENANT_A, [[`update machvon.signing_certificate set ${column} = $2 where id = $1`, [id, column === 'fingerprint_sha256' ? 'f'.repeat(64) : value]]])).rejects.toMatchObject({ code: '23514' });
      }
      await expect(harness.owner(TENANT_A, [["update machvon.signing_certificate set valid_until = valid_until + interval '1 year' where id = $1", [id]]])).rejects.toMatchObject({ code: '23514' });
    });

    it('never lets a revoked certificate become Active again', async () => {
      const { id } = await registerPersonal();
      await asA(async (tx) => store.revoke(tx, await store.lock(tx, id, 1), 'Key compromise reported'));
      await expect(harness.owner(TENANT_A, [["update machvon.signing_certificate set status = 'Active' where id = $1", [id]]])).rejects.toMatchObject({ code: '23514' });
    });

    it('gives the application role no way to delete or truncate certificates', async () => {
      const { id } = await registerPersonal();
      const app = new Client({ connectionString: harness.database.urlFor('machvon_app') });
      await app.connect();
      try {
        await app.query("select set_config('app.tenant_id', $1, false)", [TENANT_A]);
        await expect(app.query('delete from machvon.signing_certificate where id = $1', [id])).rejects.toMatchObject({ code: '42501' });
        await expect(app.query('truncate machvon.signing_certificate')).rejects.toMatchObject({ code: '42501' });
      } finally {
        await app.end();
      }
    });
  });
});
