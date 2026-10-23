import { createHash } from 'node:crypto';
import { CertificateStore, DocumentStore } from '@machvon/db';
import { ACTOR, ADMIN, DocApp, NOBODY, NOW, TENANT_A, TENANT_B, UNIT_TWO_CLERK, memberId, unitId } from './doc-app';
import { revisionZero, signField } from './support/pdf-fixture';
import { SIGNED_AT, createWorld } from './support/pki-world';
import type { World } from './support/pki-world';
import { fingerprintOf } from '../../src/modules/doc/cms-verification';
import { X509Certificate } from 'node:crypto';

jest.setTimeout(60_000);

const harnessApp = new DocApp();
const store = new DocumentStore();
const ctx = (tenantId: string, member = ADMIN) => ({ tenantId, membershipId: memberId(member), scopeVersion: 1 });
let world: World;

async function insertVersion(
  bytes: Uint8Array,
  options: { tenantId?: string; issuerUnitId?: string; scan?: 'PENDING' | 'CLEAN' | 'INFECTED'; mime?: string; store?: boolean } = {},
): Promise<string> {
  const tenantId = options.tenantId ?? TENANT_A;
  const key = `tenants/${tenantId}/documents/signed-${Math.random().toString(16).slice(2)}.pdf`;
  if (options.store !== false) await harnessApp.files.put(key, bytes, options.mime ?? 'application/pdf');
  return harnessApp.harness.tenants.withTenant(ctx(tenantId), async (tx) => {
    const document = await store.insertDocument(tx, { docKind: 'OUTGOING', docTypeCode: 'QD', title: 'Signed', classification: 'INTERNAL', createdBy: ACTOR, issuerUnitId: options.issuerUnitId });
    const version = await store.appendVersion(tx, {
      documentId: document.id,
      objectKey: key,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      mime: options.mime ?? 'application/pdf',
      pageCount: 1,
      classification: 'INTERNAL',
      stage: 'LEADER_SIGNED',
      byteLength: bytes.length,
      createdBy: ACTOR,
    });
    const scan = options.scan ?? 'CLEAN';
    if (scan !== 'PENDING') await store.setScanResult(tx, version.id, scan);
    return version.id;
  });
}

const leaderPdf = (timestamps = true): Promise<Buffer> =>
  signField(revisionZero(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, ...(timestamps ? { timestamps: world.tsa } : {}) });

const verify = (versionId: string, body: Record<string, unknown> = {}, member = ADMIN, key?: string) =>
  harnessApp.call('POST', `/document-versions/${versionId}/signature-verifications`, { member, body, ...(key === undefined ? {} : { key }) });
const report = (versionId: string, member = ADMIN, tenantId?: string) =>
  harnessApp.call('GET', `/document-versions/${versionId}/signature-report`, { member, ...(tenantId === undefined ? {} : { tenantId }) });

describe('signature verification API (ST-DOC-003)', () => {
  beforeAll(async () => {
    world = await createWorld();
    await harnessApp.start();
    harnessApp.anchors = [{ regime: 'PUBLIC_CA', certificate: world.root.certificate }];
  }, 240_000);
  afterAll(() => harnessApp.stop(), 60_000);

  describe('verifyDocumentSignatures', () => {
    it('verifies a signed version, stores the result, audits it and announces it', async () => {
      const versionId = await insertVersion(await leaderPdf());
      const reply = await verify(versionId);
      expect(reply.status).toBe(200);
      expect(reply.json).toMatchObject({ status: 'VALID', overall: 'VALID', verification_no: 1, signature_count: 1, resource_id: versionId });
      const [row] = await harnessApp.harness.owner<{ role: string; verification_status: string; chain_status: string; revocation_status: string; trust_regime: string; profile: string; failure_codes: unknown[] }>(TENANT_A, [
        ['select role, verification_status, chain_status, revocation_status, trust_regime, profile, failure_codes from machvon.document_signature where document_version_id = $1', [versionId]],
      ]);
      expect(row).toMatchObject({ role: 'LEADER', verification_status: 'VALID', chain_status: 'TRUSTED', revocation_status: 'NOT_CHECKED', trust_regime: 'PUBLIC_CA', profile: 'PADES_B_T', failure_codes: [] });
      const audit = await harnessApp.harness.owner<{ safe_diff: Record<string, unknown> }>(TENANT_A, [
        ["select safe_diff from machvon.audit_event where action = 'document.signature.verify' and resource_id = $1", [versionId]],
      ]);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.safe_diff).toMatchObject({ overall: 'VALID', policy: 'STRICT', signature_count: 1, verification_no: 1 });
      const events = await harnessApp.harness.owner<{ type: string; payload: Record<string, unknown> }>(TENANT_A, [
        ["select type, payload from machvon.outbox_event where aggregate_id = $1 and type = 'doc.signature_verified.v1'", [versionId]],
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({ version_id: versionId, overall: 'VALID', verification_no: 1 });
      expect(harnessApp.metrics).toContainEqual({ name: 'doc_signature_verification_total', labels: { result: 'valid' } });
    });

    it('adds a new verification each time and keeps the earlier one', async () => {
      const versionId = await insertVersion(await leaderPdf());
      expect((await verify(versionId)).json.verification_no).toBe(1);
      expect((await verify(versionId)).json.verification_no).toBe(2);
      expect(await harnessApp.count('select count(*) as n from machvon.document_signature where document_version_id = $1', [versionId])).toBe(2);
      const latest = await report(versionId);
      expect((latest.json.signatures as Array<{ verification_no: number }>).map((signature) => signature.verification_no)).toEqual([2]);
    });

    it('answers a repeated request with the same key from the first answer and stores nothing again', async () => {
      const versionId = await insertVersion(await leaderPdf());
      const first = await verify(versionId, {}, ADMIN, 'verify-once-1234');
      const second = await verify(versionId, {}, ADMIN, 'verify-once-1234');
      expect(second.json).toEqual(first.json);
      expect(second.headers.get('idempotency-replayed')).toBe('true');
      expect(await harnessApp.count('select count(*) as n from machvon.document_signature where document_version_id = $1', [versionId])).toBe(1);
    });

    it('flags a file that changed after it was signed (AC-ST-DOC-003-1)', async () => {
      const signed = await leaderPdf();
      const tampered = Buffer.from(signed);
      tampered[signed.indexOf('(Hello)') + 5] = 'p'.charCodeAt(0);
      const versionId = await insertVersion(tampered);
      const reply = await verify(versionId);
      expect(reply.json).toMatchObject({ status: 'INVALID', overall: 'INVALID' });
      const shown = await report(versionId);
      expect(shown.json.overall).toBe('INVALID');
      expect((shown.json.signatures as Array<{ findings: string[] }>)[0]?.findings).toEqual(['DIGEST_MISMATCH']);
    });

    it('accepts a signing time nobody proved only under LENIENT_TIME, and the report remembers the policy used', async () => {
      const versionId = await insertVersion(await leaderPdf(false));
      expect((await verify(versionId)).json.overall).toBe('INDETERMINATE');
      expect((await report(versionId)).json.overall).toBe('INDETERMINATE');
      expect((await verify(versionId, { policy: 'LENIENT_TIME' })).json.overall).toBe('VALID');
      const shown = await report(versionId);
      expect(shown.json.overall).toBe('VALID');
      expect((shown.json.signatures as Array<{ status: string; findings: string[] }>)[0]).toMatchObject({ status: 'INDETERMINATE', findings: ['SIGNING_TIME_UNPROVEN'] });
    });

    it('asks the revocation port only when asked to, and fails the signature of a revoked certificate', async () => {
      const versionId = await insertVersion(await leaderPdf());
      expect(((await verify(versionId)).json as { overall: string }).overall).toBe('VALID');
      expect(((await report(versionId)).json.signatures as Array<{ revocation_status: string }>)[0]?.revocation_status).toBe('NOT_CHECKED');
      harnessApp.revocationAnswer = { status: 'GOOD' };
      await verify(versionId, { revalidate_revocation: true });
      expect(((await report(versionId)).json.signatures as Array<{ revocation_status: string }>)[0]?.revocation_status).toBe('GOOD');
      harnessApp.revocationAnswer = { status: 'REVOKED', revokedAt: new Date('2026-09-01T00:00:00Z') };
      expect((await verify(versionId, { revalidate_revocation: true })).json.overall).toBe('INVALID');
      harnessApp.revocationAnswer = { status: 'GOOD' };
    });

    it('links the signer certificate to the certificate registered for the tenant', async () => {
      const versionId = await insertVersion(await leaderPdf());
      const fingerprint = fingerprintOf(new X509Certificate(world.leader.certificate));
      const registered = await harnessApp.harness.tenants.withTenant(ctx(TENANT_A), (tx) =>
        new CertificateStore().register(
          tx,
          { kind: 'PERSONAL', holderMembershipId: memberId(ADMIN), providerCode: 'TEST-CA', parsed: { serial: '01', issuerDn: 'CN=Test', subjectDn: 'CN=Leader', validFrom: new Date('2026-01-01T00:00:00Z'), validUntil: new Date('2030-01-01T00:00:00Z'), fingerprintSha256: fingerprint } },
          ACTOR,
        ),
      );
      await verify(versionId);
      expect(((await report(versionId)).json.signatures as Array<{ registered_certificate_id: string }>)[0]?.registered_certificate_id).toBe(registered.id);
    });

    it('stores nothing for a file without signatures and reports it as INDETERMINATE', async () => {
      const versionId = await insertVersion(revisionZero());
      expect((await verify(versionId)).json).toMatchObject({ status: 'INDETERMINATE', verification_no: null, signature_count: 0 });
      expect((await report(versionId)).json).toEqual({ version_id: versionId, overall: 'INDETERMINATE', signatures: [] });
    });

    it('never puts private material into what it stores or answers', async () => {
      const versionId = await insertVersion(await leaderPdf());
      const reply = await verify(versionId);
      const shown = await report(versionId);
      const rows = await harnessApp.harness.owner<{ row: string }>(TENANT_A, [['select row_to_json(s)::text as row from machvon.document_signature s where document_version_id = $1', [versionId]]]);
      for (const text of [JSON.stringify(reply.json), JSON.stringify(shown.json), rows.map((row) => row.row).join('')]) {
        expect(text).not.toMatch(/PRIVATE KEY|privateKey|BEGIN CERTIFICATE/);
      }
    });

    it.each([
      ['a version that is not a PDF', { mime: 'text/plain' }, 422, 'DOCUMENT_VERSION_NOT_PDF'],
      ['a version still being scanned', { scan: 'PENDING' as const }, 409, 'SCAN_PENDING'],
      ['an infected version', { scan: 'INFECTED' as const }, 403, 'SCOPE_DENIED'],
      ['a version whose file is missing', { store: false }, 404, 'RESOURCE_NOT_FOUND'],
    ])('refuses %s', async (_name, options, status, code) => {
      const versionId = await insertVersion(await leaderPdf(), options);
      const reply = await verify(versionId);
      expect(reply.status).toBe(status);
      expect(reply.json.code).toBe(code);
      expect(await harnessApp.count('select count(*) as n from machvon.document_signature where document_version_id = $1', [versionId])).toBe(0);
    });

    it('answers 404 for an unknown version and for a version of another tenant', async () => {
      expect((await verify('00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
      const foreign = await insertVersion(await leaderPdf(), { tenantId: TENANT_B });
      const reply = await verify(foreign);
      expect(reply.status).toBe(404);
      expect(reply.json.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('refuses a policy that does not exist and members without the permission', async () => {
      const versionId = await insertVersion(await leaderPdf());
      expect((await verify(versionId, { policy: 'WHATEVER' })).status).toBe(422);
      expect((await verify(versionId, {}, NOBODY)).status).toBe(403);
      expect((await verify(versionId, {}, UNIT_TWO_CLERK)).status).toBe(403);
    });

    it('lets a member verify only the versions inside their scope', async () => {
      // The clerk may read signature reports of unit 2 only; verification needs its own permission and is refused above.
      const own = await insertVersion(await leaderPdf(), { issuerUnitId: unitId(2) });
      const other = await insertVersion(await leaderPdf(), { issuerUnitId: unitId(1) });
      await verify(own);
      await verify(other);
      expect((await report(own, UNIT_TWO_CLERK)).status).toBe(200);
      expect((await report(other, UNIT_TWO_CLERK)).status).toBe(404);
    });
  });

  describe('getDocumentSignatureReport', () => {
    it('reports a version never verified as INDETERMINATE with no signatures', async () => {
      const versionId = await insertVersion(await leaderPdf());
      expect((await report(versionId)).json).toEqual({ version_id: versionId, overall: 'INDETERMINATE', signatures: [] });
    });

    it('falls back to the strict reading when the stored report is gone', async () => {
      const versionId = await insertVersion(await leaderPdf());
      await verify(versionId);
      await harnessApp.harness.owner(TENANT_A, [["update machvon.document_signature set report_object_key = 'gone' where document_version_id = $1", [versionId]]]);
      expect((await report(versionId)).json.overall).toBe('VALID');
    });

    it('answers 404 for an unknown version, a foreign tenant and a member without the permission', async () => {
      const versionId = await insertVersion(await leaderPdf());
      expect((await report('00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
      expect((await report(versionId, ADMIN, TENANT_B)).status).toBe(404);
      expect((await report(versionId, NOBODY)).status).toBe(403);
    });

    it('does not depend on the clock of the test: the signing time is the timestamp, not now', async () => {
      const versionId = await insertVersion(await leaderPdf());
      await verify(versionId);
      const signature = ((await report(versionId)).json.signatures as Array<{ signed_at: string; timestamp_at: string; verified_at: string }>)[0];
      expect(signature?.signed_at).toBe(SIGNED_AT.toISOString());
      expect(signature?.timestamp_at).toBe(SIGNED_AT.toISOString());
      expect(signature?.verified_at).toBe(NOW.toISOString());
    });
  });
});
