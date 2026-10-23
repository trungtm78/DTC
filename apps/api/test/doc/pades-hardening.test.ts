import type { SignatureReport } from '@machvon/kernel';
import { MockCertificateAuthority, MockTimestampAuthority, OID } from '../../src/modules/doc/mock-pki';
import type { Identity } from '../../src/modules/doc/mock-pki';
import { verifyPdfSignatures } from '../../src/modules/doc/pades-verifier';
import { appendRevision } from '../../src/modules/doc/pdf-incremental';
import { revisionZero, signField, stampDocument, withNumbering, withValidationData } from './support/pdf-fixture';
import { NOW, SIGNED_AT, VALID_FROM, VALID_UNTIL, createWorld, revocationByCertificate, trustStoreOf } from './support/pki-world';
import type { World } from './support/pki-world';

// Verifier hardening: what makes a signature trustworthy beyond a matching digest (timestamp authority authorisation,
// certification path constraints, revocation of every certificate on the path, DocMDP bounds).

const NUMBERING = { doc_number: '123', doc_symbol: 'QD-UBND', doc_date: '23/10/2026' };
const SEAL_TIME = new Date('2026-10-23T08:30:00Z');
const CODE_SIGNING = '1.3.6.1.5.5.7.3.3';

let world: World;

beforeAll(async () => {
  world = await createWorld();
}, 60_000);

function leaderSigned(): Promise<Buffer> {
  return signField(revisionZero(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa });
}

describe('timestamp authorities must hold the timeStamping key purpose alone and critical (RFC 3161 section 2.3)', () => {
  const issueTsa = (options: { extendedKeyUsage?: string[]; critical?: boolean }): Promise<Identity> =>
    world.root.issue({
      commonName: 'Candidate TSA',
      notBefore: VALID_FROM,
      notAfter: VALID_UNTIL,
      ...(options.extendedKeyUsage === undefined ? {} : { extendedKeyUsage: options.extendedKeyUsage }),
      ...(options.critical === undefined ? {} : { extendedKeyUsageCritical: options.critical }),
    });
  const signedWith = (identity: Identity): Promise<Buffer> =>
    signField(revisionZero(), {
      field: 'sig_leader',
      identity: world.leader,
      signingTime: SIGNED_AT,
      timestamps: new MockTimestampAuthority(identity, () => SIGNED_AT),
    });

  it.each<[string, { extendedKeyUsage?: string[]; critical?: boolean }]>([
    ['an ordinary signing certificate without the extension', {}],
    ['a certificate that lists another purpose too', { extendedKeyUsage: [OID.timeStamping, CODE_SIGNING] }],
    ['a certificate with another purpose only', { extendedKeyUsage: [CODE_SIGNING] }],
    ['a certificate whose extension is not critical', { extendedKeyUsage: [OID.timeStamping], critical: false }],
  ])('refuses a signature timestamp from %s', async (_label, options) => {
    const report = await verifyPdfSignatures(await signedWith(await issueTsa(options)), world.trust, NOW);
    expect(report.overall).toBe('INVALID');
    expect(report.signatures[0]?.findings).toContain('TIMESTAMP_INVALID');
    expect(report.signatures[0]?.timestampAt).toBeNull();
  });

  it('refuses a document timestamp from a signing certificate: the signer cannot choose the time', async () => {
    const base = await signField(revisionZero({ timestampField: true }), {
      field: 'sig_leader',
      identity: world.leader,
      signingTime: SIGNED_AT,
      timestamps: world.tsa,
    });
    const forged = new MockTimestampAuthority(world.leader, () => NOW);
    const report = await verifyPdfSignatures(await stampDocument(base, forged, NOW), world.trust, NOW);
    expect(report.signatures[1]).toMatchObject({ role: 'DOCUMENT_TIMESTAMP', status: 'INVALID' });
    expect(report.signatures[1]?.findings).toEqual(['TIMESTAMP_INVALID']);
  });

  it('accepts an authority that holds the purpose alone and critical', async () => {
    const report = await verifyPdfSignatures(await signedWith(await issueTsa({ extendedKeyUsage: [OID.timeStamping] })), world.trust, NOW);
    expect(report.overall).toBe('VALID');
  });
});

describe('certification path constraints', () => {
  const leafBelow = (authority: MockCertificateAuthority, commonName: string): Promise<Identity> =>
    authority.issue({ commonName, notBefore: VALID_FROM, notAfter: VALID_UNTIL });
  const verifySignedBy = async (identity: Identity): Promise<SignatureReport> =>
    verifyPdfSignatures(
      await signField(revisionZero(), { field: 'sig_leader', identity, signingTime: SIGNED_AT, timestamps: world.tsa }),
      world.trust,
      NOW,
    );

  it('refuses an intermediate that follows an authority with pathLenConstraint 0', async () => {
    const limited = await world.root.createIntermediate({ commonName: 'Limited CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, pathLength: 0 });
    const second = await limited.createIntermediate({ commonName: 'Second CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    const report = await verifySignedBy(await leafBelow(second, 'Below the limit'));
    expect(report.signatures[0]).toMatchObject({ chainStatus: 'UNTRUSTED', trustRegime: null, status: 'INVALID' });
    expect(report.signatures[0]?.findings).toContain('CHAIN_UNTRUSTED');
    expect(report.overall).toBe('INVALID');
  });

  it('accepts a leaf directly below the authority with pathLenConstraint 0, and a longer path where the limit allows it', async () => {
    const limited = await world.root.createIntermediate({ commonName: 'Limited CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, pathLength: 0 });
    expect((await verifySignedBy(await leafBelow(limited, 'Directly below'))).overall).toBe('VALID');
    const roomy = await world.root.createIntermediate({ commonName: 'Roomy CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, pathLength: 1 });
    const inner = await roomy.createIntermediate({ commonName: 'Inner CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    expect((await verifySignedBy(await leafBelow(inner, 'Two levels'))).overall).toBe('VALID');
  });

  it('does not count a self-issued intermediate (a key rollover) against the pathLenConstraint', async () => {
    const limited = await world.root.createIntermediate({ commonName: 'Rollover CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, pathLength: 0 });
    const rollover = await limited.createIntermediate({ commonName: 'Rollover CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    expect((await verifySignedBy(await leafBelow(rollover, 'Below the rollover'))).overall).toBe('VALID');
    const other = await rollover.createIntermediate({ commonName: 'Not a rollover', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    expect((await verifySignedBy(await leafBelow(other, 'Below another CA'))).overall).toBe('INVALID');
  });

  it('refuses a path that is longer than the pathLenConstraint of the trust anchor', async () => {
    const narrow = await MockCertificateAuthority.createRoot({
      commonName: 'Narrow Root',
      notBefore: VALID_FROM,
      notAfter: new Date('2040-01-01T00:00:00Z'),
      pathLength: 0,
    });
    const middle = await narrow.createIntermediate({ commonName: 'Middle CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    const authority = await narrow.issue({ commonName: 'Narrow TSA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, extendedKeyUsage: [OID.timeStamping] });
    const identity = await leafBelow(middle, 'Too deep for the root');
    const signed = await signField(revisionZero(), {
      field: 'sig_leader',
      identity,
      signingTime: SIGNED_AT,
      timestamps: new MockTimestampAuthority(authority, () => SIGNED_AT),
    });
    const report = await verifyPdfSignatures(signed, trustStoreOf(narrow), NOW);
    expect(report.signatures[0]?.chainStatus).toBe('UNTRUSTED');
    expect(report.signatures[0]?.findings).toContain('CHAIN_UNTRUSTED');
  });

  it('applies the same limits to the chain of a timestamp authority', async () => {
    const limited = await world.root.createIntermediate({ commonName: 'Limited TSA CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, pathLength: 0 });
    const second = await limited.createIntermediate({ commonName: 'Second TSA CA', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    const authority = await second.issue({ commonName: 'Deep TSA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, extendedKeyUsage: [OID.timeStamping] });
    const signed = await signField(revisionZero(), {
      field: 'sig_leader',
      identity: world.leader,
      signingTime: SIGNED_AT,
      timestamps: new MockTimestampAuthority(authority, () => SIGNED_AT),
    });
    const report = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(report.signatures[0]?.findings).toContain('TIMESTAMP_INVALID');
  });
});

describe('revocation covers every certificate that vouches for a signature', () => {
  const intermediateWithLeaf = async (commonName: string): Promise<{ authority: MockCertificateAuthority; identity: Identity }> => {
    const authority = await world.root.createIntermediate({ commonName, notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    return { authority, identity: await authority.issue({ commonName: 'Good Leaf', notBefore: VALID_FROM, notAfter: VALID_UNTIL }) };
  };
  const signedBy = (identity: Identity): Promise<Buffer> =>
    signField(revisionZero(), { field: 'sig_leader', identity, signingTime: SIGNED_AT, timestamps: world.tsa });
  const hex = (certificate: Buffer): string => certificate.toString('hex');

  it('asks about the intermediate authority too and reports it revoked: CERTIFICATE_REVOKED', async () => {
    const { authority, identity } = await intermediateWithLeaf('Revoked Intermediate');
    const port = revocationByCertificate(new Map([[hex(authority.certificate), { status: 'REVOKED' as const, revokedAt: new Date('2026-10-01T00:00:00Z') }]]));
    const report = await verifyPdfSignatures(await signedBy(identity), world.trust, NOW, { revocation: port });
    expect(port.asked).toContain(hex(authority.certificate));
    expect(port.asked).not.toContain(hex(world.root.certificate));
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'REVOKED', status: 'INVALID' });
    expect(report.signatures[0]?.findings).toContain('CERTIFICATE_REVOKED');
    expect(report.overall).toBe('INVALID');
  });

  it('leaves the outcome open when the status of the intermediate is unknown', async () => {
    const { authority, identity } = await intermediateWithLeaf('Unknown Intermediate');
    const port = revocationByCertificate(new Map([[hex(authority.certificate), { status: 'UNKNOWN' as const }]]));
    const report = await verifyPdfSignatures(await signedBy(identity), world.trust, NOW, { revocation: port });
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'UNKNOWN', status: 'INDETERMINATE' });
    expect(report.signatures[0]?.findings).toEqual(['REVOCATION_UNKNOWN']);
  });

  it('does not count an intermediate that was revoked after the signature', async () => {
    const { authority, identity } = await intermediateWithLeaf('Late Revoked');
    const port = revocationByCertificate(new Map([[hex(authority.certificate), { status: 'REVOKED' as const, revokedAt: SEAL_TIME }]]));
    const report = await verifyPdfSignatures(await signedBy(identity), world.trust, NOW, { revocation: port });
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'GOOD', status: 'VALID' });
  });

  it('asks about the timestamp authority of a signature timestamp and refuses a revoked one', async () => {
    const port = revocationByCertificate(new Map([[hex(world.tsaCertificate), { status: 'REVOKED' as const, revokedAt: new Date('2026-10-01T00:00:00Z') }]]));
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW, { revocation: port });
    expect([...port.asked].sort()).toEqual([hex(world.leader.certificate), hex(world.tsaCertificate)].sort());
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'REVOKED', status: 'INVALID', timestampAt: null });
    expect(report.signatures[0]?.findings).toContain('TIMESTAMP_INVALID');
  });

  it('leaves the outcome open when the status of the timestamp authority is unknown', async () => {
    const port = revocationByCertificate(new Map([[hex(world.tsaCertificate), { status: 'UNKNOWN' as const }]]));
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW, { revocation: port });
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'UNKNOWN', status: 'INDETERMINATE' });
    expect(report.signatures[0]?.findings).toEqual(['REVOCATION_UNKNOWN']);
  });

  it('asks about the authority of a document timestamp and reports it revoked or unknown', async () => {
    const base = await signField(revisionZero({ timestampField: true }), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa });
    world.setTime(NOW);
    const stamped = await stampDocument(base, world.tsa, NOW);
    world.setTime(SIGNED_AT);
    const revoked = revocationByCertificate(new Map([[hex(world.tsaCertificate), { status: 'REVOKED' as const }]]));
    const first = await verifyPdfSignatures(stamped, world.trust, NOW, { revocation: revoked });
    expect(first.signatures[1]).toMatchObject({ role: 'DOCUMENT_TIMESTAMP', revocationStatus: 'REVOKED', status: 'INVALID' });
    expect(first.signatures[1]?.findings).toContain('CERTIFICATE_REVOKED');
    expect(first.overall).toBe('INVALID');
    const unknown = revocationByCertificate(new Map([[hex(world.tsaCertificate), { status: 'UNKNOWN' as const }]]));
    const second = await verifyPdfSignatures(stamped, world.trust, NOW, { revocation: unknown });
    expect(second.signatures[1]).toMatchObject({ revocationStatus: 'UNKNOWN', status: 'INDETERMINATE' });
    expect(second.overall).toBe('INDETERMINATE');
  });
});

describe('the DocMDP level of the certifying signature bounds every later revision', () => {
  const certified = (level: 1 | 2 | 3, options: { timestampField?: boolean } = {}): Promise<Buffer> =>
    signField(revisionZero(options), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa, docMdpLevel: level });
  const seal = (pdf: Buffer): Promise<Buffer> =>
    signField(pdf, { field: 'sig_org', identity: world.organization, signingTime: SEAL_TIME, timestamps: world.tsa });

  it('refuses the numbering revision after a level 1 certification: INCREMENTAL_CHANGES_NOT_ALLOWED', async () => {
    const report = await verifyPdfSignatures(withNumbering(await certified(1), NUMBERING), world.trust, NOW);
    expect(report.overall).toBe('INVALID');
    expect(report.signatures[0]).toMatchObject({ docmdpLevel: 1, incrementalChangesAllowed: false, status: 'INVALID' });
    expect(report.signatures[0]?.findings).toEqual(['INCREMENTAL_CHANGES_NOT_ALLOWED']);
  });

  it.each([2, 3] as const)('accepts the numbering revision and the organisation seal after a level %i certification', async (level) => {
    const sealed = await seal(withNumbering(await certified(level), NUMBERING));
    const report = await verifyPdfSignatures(sealed, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures.map((signature) => signature.incrementalChangesAllowed)).toEqual([true, true]);
  });

  it('refuses a further signature after a level 1 certification', async () => {
    const report = await verifyPdfSignatures(await seal(await certified(1)), world.trust, NOW);
    expect(report.signatures[0]).toMatchObject({ role: 'LEADER', incrementalChangesAllowed: false, status: 'INVALID' });
    expect(report.overall).toBe('INVALID');
  });

  it('applies the level to the revisions after a later signature too', async () => {
    const sealed = await seal(withNumbering(await certified(2), NUMBERING));
    const tampered = appendRevision(sealed, [{ num: 4, body: '<< /Length 36 >>\nstream\nBT /F1 12 Tf 72 780 Td (Fraud) Tj ET\nendstream' }]).pdf;
    const report = await verifyPdfSignatures(tampered, world.trust, NOW);
    expect(report.signatures.map((signature) => signature.incrementalChangesAllowed)).toEqual([false, false]);
  });

  it('still allows validation data and a document timestamp after a level 1 certification', async () => {
    const withDss = withValidationData(await certified(1, { timestampField: true }), [world.root.certificate]);
    world.setTime(NOW);
    const archived = await stampDocument(withDss, world.tsa, NOW);
    world.setTime(SIGNED_AT);
    const report = await verifyPdfSignatures(archived, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures[0]).toMatchObject({ docmdpLevel: 1, incrementalChangesAllowed: true });
  });

  it('ignores a DocMDP level written on a signature that is not the first', async () => {
    const first = await signField(revisionZero(), { field: 'sig_org', identity: world.organization, signingTime: SIGNED_AT, timestamps: world.tsa });
    const second = await signField(first, { field: 'sig_leader', identity: world.leader, signingTime: SEAL_TIME, timestamps: world.tsa, docMdpLevel: 1 });
    const report = await verifyPdfSignatures(withNumbering(second, NUMBERING), world.trust, NOW);
    const leader = report.signatures.find((signature) => signature.role === 'LEADER');
    expect(leader).toMatchObject({ docmdpLevel: 1, incrementalChangesAllowed: true });
  });
});
