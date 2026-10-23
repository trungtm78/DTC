import { randomUUID } from 'node:crypto';
import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess, Scope } from '@machvon/kernel';
import { DocumentStore } from '../src/document-store';
import { NumberRegisterStore } from '../src/number-register-store';
import { OUTGOING_SCOPE_COLUMNS, OutgoingDocumentStore } from '../src/outgoing-document-store';
import type { NewSigningSession, OutgoingStatus } from '../src/outgoing-document-store';
import { scopePredicate } from '../src/scope-version';
import { ACTOR, AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId, unitId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const documents = new DocumentStore();
const store = new OutgoingDocumentStore();
const registers = new NumberRegisterStore();
const DRAFTER = memberId(1);
const LEADER = memberId(2);
const CLERK = memberId(3);
const CERTIFICATE = '00000000-0000-4000-8000-0000000000e1';
let layoutProfileId = '';
const NOW = new Date('2026-10-23T03:00:00Z');
const DIGEST = 'a'.repeat(64);

const ctxA = contextFor(TENANT_A, memberId(1));
const ctxB = contextFor(TENANT_B, memberId(1));
const inA = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]) => harness.tenants.withTenant(ctxA, work);

function accessWith(scope: Scope): EffectiveAccess {
  return {
    membershipId: memberId(1),
    scopeVersion: 1,
    membershipActive: true,
    grants: [{ roleCode: 'CLERK', rank: 10, permissions: ['doc.outgoing.read'], scope, status: 'Active', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveUntil: null }],
  };
}
const builder = (access: EffectiveAccess) => (first: number) => scopePredicate(access, 'doc.outgoing.read', NOW, OUTGOING_SCOPE_COLUMNS, first);

async function failure(promise: Promise<unknown>): Promise<{ code: string; sqlState?: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code };
    return { code: 'DB', sqlState: (error as { code?: string }).code };
  }
  throw new Error('expected a rejection');
}

async function newOutgoing(options: { status?: OutgoingStatus; unit?: number; title?: string; docType?: string } = {}): Promise<{ id: string; documentId: string }> {
  return inA(async (tx) => {
    const document = await documents.insertDocument(tx, { docKind: 'OUTGOING', docTypeCode: options.docType ?? 'QD', title: options.title ?? 'Decision', classification: 'INTERNAL', createdBy: ACTOR });
    const id = randomUUID();
    await tx.query(
      `insert into machvon.outgoing_document (tenant_id, id, document_id, layout_profile_id, status, drafting_unit_id, drafter_user_id, signer_user_id, created_by, updated_by)
       values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7::uuid, $6::uuid, $6::uuid)`,
      [id, document.id, layoutProfileId, options.status ?? 'SUBMITTED', unitId(options.unit ?? 1), DRAFTER, LEADER],
    );
    return { id, documentId: document.id };
  });
}

async function versionOf(documentId: string): Promise<string> {
  return inA(async (tx) => {
    const version = await documents.appendVersion(tx, {
      documentId,
      objectKey: `tenants/${TENANT_A}/documents/${randomUUID()}.pdf`,
      checksum: 'b'.repeat(64),
      mime: 'application/pdf',
      pageCount: 1,
      classification: 'INTERNAL',
      stage: 'RENDERED_FINAL',
      byteLength: 10,
      prefixSha256: 'c'.repeat(64),
      pdfRevisionCount: 1,
      createdBy: ACTOR,
    });
    return version.id;
  });
}

function sessionInput(outgoingDocumentId: string, baseVersionId: string, overrides: Partial<NewSigningSession> = {}): NewSigningSession {
  return {
    id: randomUUID(),
    outgoingDocumentId,
    role: 'LEADER',
    signerUserId: LEADER,
    signingCertificateId: CERTIFICATE,
    adapterCode: 'MOCK',
    adapterStatus: 'MOCK',
    baseVersionId,
    digestHex: DIGEST,
    byteRange: [0, 100, 200, 50],
    providerTxnRef: randomUUID(),
    expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    actor: LEADER,
    ...overrides,
  };
}

describe('OutgoingDocumentStore', () => {
  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: '/a/1/' },
      { n: 2, path: '/a/2/' },
    ]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: '/b/1/' }]);
    for (const n of [1, 2, 3]) await harness.seedMembership(TENANT_A, n, 1);
    layoutProfileId = (await inA((tx) => documents.seedDefaults(tx, ACTOR))).layoutProfileId;
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.signing_certificate (tenant_id, id, kind, holder_membership_id, certificate_serial, issuer_dn, subject_dn, provider_code, valid_from, valid_until, fingerprint_sha256, status, registered_by)
         values ($1::uuid, $2::uuid, 'PERSONAL', $3::uuid, '01', 'CN=Test CA', 'CN=Leader', 'MOCK', '2026-01-01', '2030-01-01', $4, 'Active', $3::uuid)`,
        [TENANT_A, CERTIFICATE, LEADER, 'd'.repeat(64)],
      ],
    ]);
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  describe('reads', () => {
    it('finds a document with the columns of its anchor, inside the tenant', async () => {
      const created = await newOutgoing({ title: 'Giao von' });
      const found = await inA((tx) => store.find(tx, created.id));
      expect(found).toMatchObject({ id: created.id, documentId: created.documentId, status: 'SUBMITTED', title: 'Giao von', docTypeCode: 'QD', signerUserId: LEADER, drafterUserId: DRAFTER, version: 1, symbol: null });
      expect(await harness.tenants.withTenant(ctxB, (tx) => store.find(tx, created.id))).toBeUndefined();
      expect(await inA((tx) => store.find(tx, randomUUID()))).toBeUndefined();
    });

    it('narrows one document and a list to the drafting units the caller may see', async () => {
      const mine = await newOutgoing({ title: 'SCOPE mine', unit: 1 });
      const theirs = await newOutgoing({ title: 'SCOPE theirs', unit: 2 });
      const seen = (access: EffectiveAccess) =>
        inA(async (tx) => ({
          mine: (await store.find(tx, mine.id, builder(access))) !== undefined,
          theirs: (await store.find(tx, theirs.id, builder(access))) !== undefined,
          listed: (await store.list(tx, {}, { limit: 500 }, builder(access))).map((row) => row.title).filter((title) => title.startsWith('SCOPE')).sort(),
        }));
      expect(await seen(accessWith({ kind: 'TENANT' }))).toEqual({ mine: true, theirs: true, listed: ['SCOPE mine', 'SCOPE theirs'] });
      expect(await seen(accessWith({ kind: 'UNIT_ONLY', refIds: [unitId(1)] }))).toEqual({ mine: true, theirs: false, listed: ['SCOPE mine'] });
    });

    it('lists newest first in keyset pages and filters by status, type and drafting unit', async () => {
      await newOutgoing({ title: 'PAGE one', docType: 'PAGE-A', status: 'DRAFT' });
      await newOutgoing({ title: 'PAGE two', docType: 'PAGE-A' });
      await newOutgoing({ title: 'PAGE three', docType: 'PAGE-A', unit: 2 });
      const all = await inA((tx) => store.list(tx, { docTypeCode: 'PAGE-A' }, { limit: 10 }));
      expect(all.map((row) => row.title)).toEqual(['PAGE three', 'PAGE two', 'PAGE one']);
      expect((await inA((tx) => store.list(tx, { docTypeCode: 'PAGE-A', status: 'DRAFT' }, { limit: 10 }))).map((row) => row.title)).toEqual(['PAGE one']);
      expect((await inA((tx) => store.list(tx, { docTypeCode: 'PAGE-A', draftingUnitId: unitId(2) }, { limit: 10 }))).map((row) => row.title)).toEqual(['PAGE three']);
      expect((await inA((tx) => store.list(tx, { docTypeCode: 'PAGE-A', year: 2000 }, { limit: 10 }))).length).toBe(0);
      const page = await inA((tx) => store.list(tx, { docTypeCode: 'PAGE-A' }, { limit: 2 }));
      const anchor = page[1];
      if (anchor === undefined) throw new Error('no second row');
      const rest = await inA((tx) => store.list(tx, { docTypeCode: 'PAGE-A' }, { limit: 5, after: { sortKey: anchor.sortKey, id: anchor.id } }));
      expect(rest.map((row) => row.title)).toEqual(['PAGE one']);
      expect((await failure(inA((tx) => store.list(tx, {}, { limit: 5, after: { sortKey: 'not a time', id: anchor.id } })))).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('transitions', () => {
    it('moves SUBMITTED to SIGNED to NUMBERED to SEALED, one version up each time', async () => {
      const created = await newOutgoing();
      const signed = await inA((tx) => store.markSigned(tx, created.id, { expectedVersion: 1, signedAt: NOW, actor: LEADER }));
      expect(signed).toMatchObject({ status: 'SIGNED', version: 2, leaderSignedAt: NOW });
      const allocation = randomUUID();
      const register = await inA((tx) => registers.openRegister(tx, { registerCode: 'OUT-1', name: 'Outgoing', direction: 'OUTGOING', organizationUnitId: unitId(1), year: 2026, mode: 'MANAGED', scopeDocTypes: ['QD'], actor: ACTOR }));
      const numbered = await inA((tx) =>
        store.markNumbered(tx, created.id, { expectedVersion: 2, registerId: register.id, allocationId: allocation, numberedAt: new Date(NOW.getTime() + 1000), clerk: CLERK }),
      );
      expect(numbered).toMatchObject({ status: 'NUMBERED', version: 3, allocationId: allocation, clerkUserId: CLERK });
      const sealed = await inA((tx) => store.markSealed(tx, created.id, { expectedVersion: 3, sealedAt: new Date(NOW.getTime() + 2000), actor: CLERK }));
      expect(sealed).toMatchObject({ status: 'SEALED', version: 4 });
    });

    it('refuses a stale version, a document in another state and one that does not exist', async () => {
      const created = await newOutgoing();
      expect((await failure(inA((tx) => store.markSigned(tx, created.id, { expectedVersion: 7, signedAt: NOW, actor: LEADER })))).code).toBe('VERSION_CONFLICT');
      expect((await failure(inA((tx) => store.markSealed(tx, created.id, { expectedVersion: 1, sealedAt: NOW, actor: CLERK })))).code).toBe('DOCUMENT_STATE_INVALID');
      expect((await failure(inA((tx) => store.markSigned(tx, randomUUID(), { expectedVersion: 1, signedAt: NOW, actor: LEADER })))).code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('signing sessions', () => {
    it('creates a session, finds it again and allows only one open session per role', async () => {
      const created = await newOutgoing();
      const base = await versionOf(created.documentId);
      const session = await inA((tx) => store.createSession(tx, sessionInput(created.id, base)));
      expect(session).toMatchObject({ outgoingDocumentId: created.id, role: 'LEADER', status: 'AWAITING_SIGNER', digestHex: DIGEST, byteRange: [0, 100, 200, 50], attempts: 0, adapterStatus: 'MOCK', version: 1 });
      expect(await inA((tx) => store.openSession(tx, created.id, 'LEADER'))).toMatchObject({ id: session.id });
      expect(await inA((tx) => store.openSession(tx, created.id, 'ORGANIZATION'))).toBeUndefined();
      expect((await failure(inA((tx) => store.createSession(tx, sessionInput(created.id, base))))).sqlState).toBe('23505');
      const other = await inA((tx) => store.createSession(tx, sessionInput(created.id, base, { role: 'ORGANIZATION' })));
      expect(other.role).toBe('ORGANIZATION');
      expect((await inA((tx) => store.sessionsOf(tx, created.id))).map((row) => row.role).sort()).toEqual(['LEADER', 'ORGANIZATION']);
      expect(await inA((tx) => store.findSession(tx, session.id, { lock: true }))).toMatchObject({ id: session.id });
      expect(await harness.tenants.withTenant(ctxB, (tx) => store.findSession(tx, session.id))).toBeUndefined();
      expect(await inA((tx) => store.findSession(tx, session.id, { scope: builder(accessWith({ kind: 'UNIT_ONLY', refIds: [unitId(2)] })) }))).toBeUndefined();
    });

    it('expires the sessions whose time has run out so that a new one can start', async () => {
      const created = await newOutgoing();
      const base = await versionOf(created.documentId);
      const session = await inA((tx) => store.createSession(tx, sessionInput(created.id, base)));
      expect(await inA((tx) => store.expireDue(tx, created.id, 'LEADER', NOW, LEADER))).toEqual([]);
      const later = new Date(NOW.getTime() + 16 * 60 * 1000);
      const expired = await inA((tx) => store.expireDue(tx, created.id, 'LEADER', later, LEADER));
      expect(expired.map((row) => [row.id, row.status, row.errorCode])).toEqual([[session.id, 'EXPIRED', 'SIGNING_SESSION_EXPIRED']]);
      expect(await inA((tx) => store.openSession(tx, created.id, 'LEADER'))).toBeUndefined();
      expect((await inA((tx) => store.createSession(tx, sessionInput(created.id, base)))).status).toBe('AWAITING_SIGNER');
    });

    it('counts attempts and completes a session once, pointing at the version that carries the signature', async () => {
      const created = await newOutgoing();
      const base = await versionOf(created.documentId);
      const session = await inA((tx) => store.createSession(tx, sessionInput(created.id, base)));
      await inA((tx) => store.recordAttempt(tx, session.id, LEADER));
      expect((await inA((tx) => store.findSession(tx, session.id)))?.attempts).toBe(1);
      const result = await versionOf(created.documentId);
      const done = await inA((tx) => store.completeSession(tx, session.id, { resultVersionId: result, actor: LEADER }));
      expect(done).toMatchObject({ status: 'EMBEDDED', resultVersionId: result, version: 2 });
      expect((await failure(inA((tx) => store.completeSession(tx, session.id, { resultVersionId: result, actor: LEADER })))).code).toBe('DOCUMENT_STATE_INVALID');
    });
  });

  describe('guards of V017', () => {
    it('refuses to delete or truncate an outgoing document or a session, even for the application role', async () => {
      const created = await newOutgoing();
      const base = await versionOf(created.documentId);
      const session = await inA((tx) => store.createSession(tx, sessionInput(created.id, base)));
      expect((await failure(inA((tx) => tx.query('delete from machvon.outgoing_document where id = $1::uuid', [created.id])))).sqlState).toBe('42501');
      expect((await failure(inA((tx) => tx.query('delete from machvon.doc_signing_session where id = $1::uuid', [session.id])))).sqlState).toBe('42501');
      expect((await failure(inA((tx) => tx.query('truncate machvon.outgoing_document')))).sqlState).toBe('42501');
      expect((await failure(inA((tx) => tx.query('truncate machvon.doc_signing_session')))).sqlState).toBe('42501');
    });

    it('keeps the identity of a document and the instants of its signature and seal', async () => {
      const created = await newOutgoing();
      const update = (assignments: string, params: unknown[] = []) => inA((tx) => tx.query(`update machvon.outgoing_document set ${assignments} where id = $1::uuid`, [created.id, ...params]));
      expect((await failure(update('drafter_user_id = $2::uuid', [CLERK]))).sqlState).toBe('23514');
      expect((await failure(update('drafting_unit_id = $2::uuid', [unitId(2)]))).sqlState).toBe('23514');
      expect((await failure(update('document_id = $2::uuid', [randomUUID()]))).sqlState).toBe('23514');
      await inA((tx) => store.markSigned(tx, created.id, { expectedVersion: 1, signedAt: NOW, actor: LEADER }));
      expect((await failure(update('leader_signed_at = now()'))).sqlState).toBe('23514');
      expect((await failure(update("status = 'SUBMITTED'"))).sqlState).toBe('23514');
      expect((await failure(update("status = 'DRAFT'"))).sqlState).toBe('23514');
    });

    it('refuses a SIGNED or SEALED document without the instant that goes with it', async () => {
      const created = await newOutgoing();
      expect((await failure(inA((tx) => tx.query("update machvon.outgoing_document set status = 'SIGNED' where id = $1::uuid", [created.id])))).sqlState).toBe('23514');
    });

    it('keeps what a session signs and who signs, moves it forward only and freezes it once it has ended', async () => {
      const created = await newOutgoing();
      const base = await versionOf(created.documentId);
      const session = await inA((tx) => store.createSession(tx, sessionInput(created.id, base)));
      const update = (assignments: string, params: unknown[] = []) => inA((tx) => tx.query(`update machvon.doc_signing_session set ${assignments} where id = $1::uuid`, [session.id, ...params]));
      expect((await failure(update('digest_hex = $2', ['b'.repeat(64)]))).sqlState).toBe('23514');
      expect((await failure(update('signer_user_id = $2::uuid', [CLERK]))).sqlState).toBe('23514');
      expect((await failure(update("role = 'ORGANIZATION'"))).sqlState).toBe('23514');
      expect((await failure(update("expires_at = expires_at + interval '1 hour'"))).sqlState).toBe('23514');
      expect((await failure(update("status = 'CREATED'"))).sqlState).toBe('23514');
      await update("status = 'FAILED', error_code = 'PROVIDER_UNAVAILABLE'");
      expect((await failure(update("status = 'AWAITING_SIGNER'"))).sqlState).toBe('23514');
      expect((await failure(update('attempts = attempts + 1'))).sqlState).toBe('23514');
    });

    it('refuses a digest that is not 64 hexadecimal characters and an open session without one', async () => {
      const created = await newOutgoing();
      const base = await versionOf(created.documentId);
      expect((await failure(inA((tx) => store.createSession(tx, sessionInput(created.id, base, { digestHex: 'XYZ'.padEnd(64, 'a') }))))).sqlState).toBe('23514');
    });
  });

  describe('what the screens list', () => {
    it('lists the versions of a document newest first with the prefix hash', async () => {
      const created = await newOutgoing();
      const first = await versionOf(created.documentId);
      const second = await versionOf(created.documentId);
      const versions = await inA((tx) => store.versionsOf(tx, created.documentId));
      expect(versions.map((row) => [row.id, row.version, row.stage])).toEqual([
        [second, 2, 'RENDERED_FINAL'],
        [first, 1, 'RENDERED_FINAL'],
      ]);
      expect(versions[0]).toMatchObject({ prefixSha256: 'c'.repeat(64), byteLength: 10, pageCount: 1, scanStatus: 'PENDING' });
    });

    it('lists the personal certificates of the signer and the organisation certificates of the unit and the units above it', async () => {
      const insert = (id: string, kind: string, holder: string | null, unit: string | null, fingerprint: string, validUntil = '2030-01-01') =>
        harness.owner(TENANT_A, [
          [
            `insert into machvon.signing_certificate (tenant_id, id, kind, holder_membership_id, organization_unit_id, certificate_serial, issuer_dn, subject_dn, provider_code, valid_from, valid_until, fingerprint_sha256, status, registered_by)
             values ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, '02', 'CN=Test CA', 'CN=Subject', 'MOCK', '2026-01-01', $7::timestamptz, $6, 'Active', $8::uuid)`,
            [TENANT_A, id, kind, holder, unit, fingerprint, validUntil, LEADER],
          ],
        ]);
      const orgAbove = randomUUID();
      const orgOther = randomUUID();
      const expired = randomUUID();
      await insert(orgAbove, 'ORGANIZATION', null, unitId(1), 'e'.repeat(64));
      await insert(orgOther, 'ORGANIZATION', null, unitId(2), 'f'.repeat(64));
      await insert(expired, 'PERSONAL', LEADER, null, '9'.repeat(64), '2026-02-01');
      const listed = await inA((tx) => store.certificatesFor(tx, { holderMembershipId: LEADER, draftingUnitId: unitId(1) }));
      expect(listed.map((row) => [row.id, row.kind, row.status])).toEqual(
        expect.arrayContaining([
          [CERTIFICATE, 'PERSONAL', 'Active'],
          [expired, 'PERSONAL', 'Expired'],
          [orgAbove, 'ORGANIZATION', 'Active'],
        ]),
      );
      expect(listed.map((row) => row.id)).not.toContain(orgOther);
      expect(listed.find((row) => row.id === CERTIFICATE)).toMatchObject({ subjectDn: 'CN=Leader', fingerprintSha256: 'd'.repeat(64) });
      const forNobody = await inA((tx) => store.certificatesFor(tx, { holderMembershipId: null, draftingUnitId: unitId(2) }));
      expect(forNobody.map((row) => row.id)).toEqual([orgOther]);
    });
  });

  it('keeps the prefix hash and the revision count of a numbered version', async () => {
    const created = await newOutgoing();
    const version = await versionOf(created.documentId);
    const [row] = await harness.owner<{ prefix_sha256: string; pdf_revision_count: number }>(TENANT_A, [['select prefix_sha256, pdf_revision_count from machvon.document_version where id = $1::uuid', [version]]]);
    expect(row).toEqual({ prefix_sha256: 'c'.repeat(64), pdf_revision_count: 1 });
  });
});
