import { createHash, randomUUID } from 'node:crypto';
import type { SignatureResult } from '@machvon/kernel';
import { CertificateStore } from '../src/certificate-store';
import { DocumentStore } from '../src/document-store';
import { SignatureStore } from '../src/signature-store';
import { ACTOR, AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const documents = new DocumentStore();
const certificates = new CertificateStore();
const store = new SignatureStore();
const ctxA = contextFor(TENANT_A, memberId(1));
const ctxB = contextFor(TENANT_B, memberId(1));
const sha = (seed: string): string => createHash('sha256').update(seed).digest('hex');
const VERIFIED_AT = new Date('2026-10-23T09:00:00Z');

function signature(index: number, overrides: Partial<SignatureResult> = {}): SignatureResult {
  return {
    index,
    role: index === 0 ? 'LEADER' : 'ORGANIZATION',
    subjectDn: 'CN=Nguyen Van A',
    issuerDn: 'CN=Test CA',
    serial: '0A1B',
    fingerprintSha256: sha(`certificate-${index}`),
    trustRegime: 'PUBLIC_CA',
    profile: 'PADES_B_T',
    docmdpLevel: null,
    byteRange: [0, 100, 200, 300],
    coversEndOffset: 500,
    signedAt: new Date('2026-10-23T08:00:00Z'),
    timestampAt: new Date('2026-10-23T08:00:01Z'),
    status: 'VALID',
    chainStatus: 'TRUSTED',
    revocationStatus: 'NOT_CHECKED',
    incrementalChangesAllowed: true,
    findings: [],
    ...overrides,
  };
}

async function newVersion(): Promise<string> {
  return harness.tenants.withTenant(ctxA, async (tx) => {
    const { id } = await documents.insertDocument(tx, { docKind: 'OUTGOING', docTypeCode: 'QD', title: 'Signed', classification: 'INTERNAL', createdBy: ACTOR });
    const version = await documents.appendVersion(tx, {
      documentId: id,
      objectKey: `t/${TENANT_A}/doc/${randomUUID()}.pdf`,
      checksum: sha(randomUUID()),
      mime: 'application/pdf',
      pageCount: 1,
      classification: 'INTERNAL',
      stage: 'LEADER_SIGNED',
      byteLength: 1000,
      createdBy: ACTOR,
    });
    return version.id;
  });
}

const record = (versionId: string, signatures: SignatureResult[], reportObjectKey: string | null = null) =>
  harness.tenants.withTenant(ctxA, (tx) => store.record(tx, { versionId, signatures, verifiedAt: VERIFIED_AT, verifierVersion: 'machvon-pades/1', reportObjectKey }));

describe('SignatureStore (ST-DOC-003)', () => {
  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [{ n: 1, path: '/a/1/' }]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: '/b/1/' }]);
    await harness.seedMembership(TENANT_A, 1, 1);
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  it('stores every signature of a verification under verification number 1 and reads them back whole', async () => {
    const versionId = await newVersion();
    const stored = await record(versionId, [signature(0), signature(1, { status: 'INDETERMINATE', findings: ['SIGNING_TIME_UNPROVEN'], timestampAt: null, docmdpLevel: 2 })], 'report/key');
    expect(stored.map((row) => [row.verificationNo, row.index, row.role])).toEqual([[1, 0, 'LEADER'], [1, 1, 'ORGANIZATION']]);
    const latest = await harness.tenants.withTenant(ctxA, (tx) => store.latest(tx, versionId));
    expect(latest).toHaveLength(2);
    expect(latest[0]).toMatchObject({
      versionId,
      subjectDn: 'CN=Nguyen Van A',
      trustRegime: 'PUBLIC_CA',
      profile: 'PADES_B_T',
      byteRange: [0, 100, 200, 300],
      coversEndOffset: 500,
      status: 'VALID',
      chainStatus: 'TRUSTED',
      revocationStatus: 'NOT_CHECKED',
      incrementalChangesAllowed: true,
      findings: [],
      verifierVersion: 'machvon-pades/1',
      reportObjectKey: 'report/key',
      signingCertificateId: null,
    });
    expect(latest[0]?.signedAt).toEqual(new Date('2026-10-23T08:00:00Z'));
    expect(latest[0]?.verifiedAt).toEqual(VERIFIED_AT);
    expect(latest[1]).toMatchObject({ status: 'INDETERMINATE', findings: ['SIGNING_TIME_UNPROVEN'], timestampAt: null, docmdpLevel: 2 });
  });

  it('adds a new verification with the next number and keeps the earlier one', async () => {
    const versionId = await newVersion();
    await record(versionId, [signature(0)]);
    const second = await record(versionId, [signature(0, { status: 'INVALID', findings: ['DIGEST_MISMATCH'] })]);
    expect(second[0]?.verificationNo).toBe(2);
    const latest = await harness.tenants.withTenant(ctxA, (tx) => store.latest(tx, versionId));
    expect(latest.map((row) => [row.verificationNo, row.status])).toEqual([[2, 'INVALID']]);
    const history = await harness.tenants.withTenant(ctxA, (tx) => store.history(tx, versionId));
    expect(history.map((row) => [row.verificationNo, row.status])).toEqual([[1, 'VALID'], [2, 'INVALID']]);
  });

  it('gives two verifications at the same time different numbers', async () => {
    const versionId = await newVersion();
    const results = await Promise.all([record(versionId, [signature(0)]), record(versionId, [signature(0)]), record(versionId, [signature(0)])]);
    expect(results.map((rows) => rows[0]?.verificationNo).sort()).toEqual([1, 2, 3]);
  });

  it('stores nothing for a file without signatures and reads an empty list for a version never verified', async () => {
    const versionId = await newVersion();
    expect(await record(versionId, [])).toEqual([]);
    expect(await harness.tenants.withTenant(ctxA, (tx) => store.latest(tx, versionId))).toEqual([]);
    expect(await harness.tenants.withTenant(ctxA, (tx) => store.history(tx, versionId))).toEqual([]);
  });

  it('keeps signatures that could not be located with null fields', async () => {
    const versionId = await newVersion();
    const [row] = await record(versionId, [
      signature(0, { byteRange: null, coversEndOffset: null, signedAt: null, timestampAt: null, incrementalChangesAllowed: null, fingerprintSha256: null, subjectDn: null, issuerDn: null, serial: null, trustRegime: null, status: 'INVALID', chainStatus: 'NOT_CHECKED', findings: ['BYTE_RANGE_INVALID'] }),
    ]);
    expect(row).toMatchObject({ byteRange: null, coversEndOffset: null, fingerprintSha256: null, status: 'INVALID', findings: ['BYTE_RANGE_INVALID'] });
  });

  it('links a signer certificate to the registered signing certificate with the same fingerprint', async () => {
    const versionId = await newVersion();
    const fingerprint = sha('registered');
    const registered = await harness.tenants.withTenant(ctxA, (tx) =>
      certificates.register(
        tx,
        {
          kind: 'PERSONAL',
          holderMembershipId: memberId(1),
          providerCode: 'TEST-CA',
          parsed: { serial: '01', issuerDn: 'CN=Test CA', subjectDn: 'CN=Nguyen Van A', validFrom: new Date('2026-01-01T00:00:00Z'), validUntil: new Date('2030-01-01T00:00:00Z'), fingerprintSha256: fingerprint },
        },
        ACTOR,
      ),
    );
    const [linked, unlinked] = await record(versionId, [signature(0, { fingerprintSha256: fingerprint }), signature(1)]);
    expect(linked?.signingCertificateId).toBe(registered.id);
    expect(unlinked?.signingCertificateId).toBeNull();
  });

  it('does not show a tenant the signatures of another tenant', async () => {
    const versionId = await newVersion();
    await record(versionId, [signature(0)]);
    expect(await harness.tenants.withTenant(ctxB, (tx) => store.latest(tx, versionId))).toEqual([]);
    expect(await harness.tenants.withTenant(ctxB, (tx) => store.history(tx, versionId))).toEqual([]);
  });
});
