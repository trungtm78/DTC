import { X509Certificate, createHash, randomUUID } from 'node:crypto';
import { DocumentStore, NumberRegisterStore } from '@machvon/db';
import type { TenantDatabase } from '@machvon/db';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { Client } from 'pg';
import { fingerprintOf } from '../../src/modules/doc/cms-verification';
import type { TrustStoreProvider } from '../../src/modules/doc/trust-anchors';
import { MockDocumentFilePort } from '../../src/modules/doc/file-port';
import { MockCertificateAuthority, MockTimestampAuthority, OID } from '../../src/modules/doc/mock-pki';
import { PdfLibRenderer } from '../../src/modules/doc/pdf-renderer';
import { MockSigningDirectory } from '../../src/modules/doc/signing-adapters';
import { MockSigningPort } from '../../src/modules/doc/signing-port';
import type { SessionRef, SigningRequest } from '../../src/modules/doc/signing-port';
import { sampleRequest } from '../doc/render-fixture';
import { signField } from '../doc/support/pdf-fixture';

const DAY_MS = 86_400_000;
const ACTOR = '00000000-0000-4000-8000-0000000000f0';

/** The signer approves the moment a session opens: nobody holds a phone in a browser run. */
class ApprovingDirectory extends MockSigningDirectory {
  override async startSession(request: SigningRequest): Promise<SessionRef> {
    const ref = await super.startSession(request);
    this.approve(ref);
    return ref;
  }
}

export interface OutgoingSeedInput {
  database: TestDatabase;
  tenants: TenantDatabase;
  tenantId: string;
  /** The leader signer and certificate holder, and the drafter. */
  signerMembershipId: string;
  drafterMembershipId: string;
  /** The drafting unit of the documents, and the unit above it that holds the organisation certificate. */
  draftingUnitId: string;
  organizationUnitId: string;
}

export interface OutgoingSeed {
  files: MockDocumentFilePort;
  signing: MockSigningDirectory;
  trust: TrustStoreProvider;
  /** Ids the browser checks name: documents the visual cases read, and ones the flows change. */
  documents: { visualSubmitted: string; flowSubmitted: string; visualSigned: string };
}

/**
 * What the signing and numbering screens need to show real data: the document type, an open outgoing register, a leader and
 * an organisation certificate of a test authority (the API signs with it through the MOCK adapter, which approves by itself),
 * and outgoing documents in SUBMITTED and SIGNED whose PDFs carry the signature form (revision 0) and, for SIGNED, a real signature.
 */
export async function seedOutgoingDocuments(input: OutgoingSeedInput): Promise<OutgoingSeed> {
  const now = new Date();
  const validFrom = new Date(now.getTime() - DAY_MS);
  const validUntil = new Date(now.getTime() + 400 * DAY_MS);
  const root = await MockCertificateAuthority.createRoot({ commonName: 'E2E Test Root CA', notBefore: validFrom, notAfter: new Date(now.getTime() + 3650 * DAY_MS) });
  const leader = await root.issue({ commonName: 'Nguyen An', organization: 'E2E Agency', notBefore: validFrom, notAfter: validUntil });
  const organization = await root.issue({ commonName: 'E2E Agency Seal', notBefore: validFrom, notAfter: validUntil });
  const stamper = await root.issue({ commonName: 'E2E TSA', notBefore: validFrom, notAfter: validUntil, extendedKeyUsage: [OID.timeStamping] });
  const clock = (): Date => new Date();
  const tsa = new MockTimestampAuthority(stamper, clock);
  const signing = new ApprovingDirectory();
  signing.register(fingerprintOf(new X509Certificate(leader.certificate)), new MockSigningPort({ identity: leader, clock, timestamps: tsa }));
  signing.register(fingerprintOf(new X509Certificate(organization.certificate)), new MockSigningPort({ identity: organization, clock, timestamps: tsa }));
  const trust: TrustStoreProvider = { forTenant: () => Promise.resolve({ anchors: () => [{ regime: 'PUBLIC_CA', certificate: root.certificate }] }) };

  const files = new MockDocumentFilePort();
  const documents = new DocumentStore();
  const registers = new NumberRegisterStore();
  const context = { tenantId: input.tenantId, membershipId: ACTOR, scopeVersion: 1 };
  const { layoutProfileId } = await input.tenants.withTenant(context, async (tx) => {
    const seeded = await documents.seedDefaults(tx, ACTOR);
    await documents.defineDocType(tx, {
      code: 'QD',
      name: 'Quyet dinh',
      abbreviation: 'QD',
      symbolKind: 'DECISION',
      symbolPattern: '{number}/{type}-{agency}',
      registerCode: 'REG-QD',
      legalBasis: 'ND 30/2020',
      effectiveFrom: '2026-01-01',
      actor: ACTOR,
    });
    await registers.openRegister(tx, {
      registerCode: 'UBND',
      name: 'So van ban di',
      direction: 'OUTGOING',
      organizationUnitId: input.draftingUnitId,
      year: now.getFullYear(),
      mode: 'MANAGED',
      scopeDocTypes: ['QD'],
      actor: ACTOR,
    });
    return seeded;
  });
  const owner = new Client({ connectionString: input.database.urlFor('machvon_owner') });
  await owner.connect();
  try {
    await owner.query("select set_config('app.tenant_id', $1, false)", [input.tenantId]);
    const certificate = (kind: string, holder: string | null, unit: string | null, subject: string, bytes: Buffer): Promise<unknown> =>
      owner.query(
        `insert into machvon.signing_certificate (tenant_id, id, kind, holder_membership_id, organization_unit_id, certificate_serial, issuer_dn, subject_dn, provider_code, valid_from, valid_until, fingerprint_sha256, status, registered_by)
         values ($1, gen_random_uuid(), $2, $3, $4, '01', 'CN=E2E Test Root CA', $5, 'MOCK', $6, $7, $8, 'Active', $9)`,
        [input.tenantId, kind, holder, unit, subject, validFrom, validUntil, fingerprintOf(new X509Certificate(bytes)), ACTOR],
      );
    await certificate('PERSONAL', input.signerMembershipId, null, 'CN=Nguyen An,O=E2E Agency', leader.certificate);
    await certificate('ORGANIZATION', null, input.organizationUnitId, 'CN=E2E Agency Seal', organization.certificate);
  } finally {
    await owner.end();
  }

  const rendered = Buffer.from((await new PdfLibRenderer().render({ ...sampleRequest(), signatureFields: true })).bytes);
  const leaderSigned = await signField(rendered, { field: 'sig_leader', identity: leader, signingTime: now, timestamps: tsa });

  const insert = async (title: string, signed: boolean): Promise<string> => {
    const outgoingId = randomUUID();
    await input.tenants.withTenant(context, async (tx) => {
      const document = await documents.insertDocument(tx, { docKind: 'OUTGOING', docTypeCode: 'QD', title, classification: 'INTERNAL', createdBy: ACTOR, issuerUnitId: input.draftingUnitId });
      const store = async (bytes: Buffer, stage: 'RENDERED_FINAL' | 'LEADER_SIGNED', name: string): Promise<void> => {
        const key = `tenants/${input.tenantId}/documents/${document.id}-${name}.pdf`;
        await files.put(key, bytes, 'application/pdf');
        const version = await documents.appendVersion(tx, {
          documentId: document.id,
          objectKey: key,
          checksum: createHash('sha256').update(bytes).digest('hex'),
          mime: 'application/pdf',
          pageCount: 1,
          classification: 'INTERNAL',
          stage,
          byteLength: bytes.length,
          createdBy: ACTOR,
        });
        await documents.setScanResult(tx, version.id, 'CLEAN');
      };
      await store(rendered, 'RENDERED_FINAL', 'rendered');
      if (signed) await store(leaderSigned, 'LEADER_SIGNED', 'leader');
      await tx.query(
        `insert into machvon.outgoing_document (tenant_id, id, document_id, layout_profile_id, status, drafting_unit_id, drafter_user_id, signer_user_id, signer_title, leader_signed_at, created_by, updated_by)
         values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7::uuid, 'Giam doc', $8::timestamptz, $6::uuid, $6::uuid)`,
        [outgoingId, document.id, layoutProfileId, signed ? 'SIGNED' : 'SUBMITTED', input.draftingUnitId, input.drafterMembershipId, input.signerMembershipId, signed ? now.toISOString() : null],
      );
    });
    return outgoingId;
  };
  const visualSigned = await insert('Quyet dinh giao von dot 2', true);
  const flowSubmitted = await insert('Quyet dinh phe duyet ke hoach giai ngan', false);
  const visualSubmitted = await insert('Quyet dinh giao von dot 1', false);
  return { files, signing, trust, documents: { visualSubmitted, flowSubmitted, visualSigned } };
}
