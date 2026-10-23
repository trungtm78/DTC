import { MockCertificateAuthority, MockTimestampAuthority } from '../../src/modules/doc/mock-pki';
import { verifyPdfSignatures } from '../../src/modules/doc/pades-verifier';
import { appendRevision } from '../../src/modules/doc/pdf-incremental';
import { revisionZero, signField, stampDocument, withNumbering, withValidationData } from './support/pdf-fixture';
import { NOW, SIGNED_AT, VALID_FROM, VALID_UNTIL, createWorld, revocationReturning, trustStoreOf } from './support/pki-world';
import type { World } from './support/pki-world';

const NUMBERING = { doc_number: '123', doc_symbol: 'QD-UBND', doc_date: '23/10/2026' };

let world: World;

beforeAll(async () => {
  world = await createWorld();
}, 60_000);

function leaderSigned(): Promise<Buffer> {
  return signField(revisionZero(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa });
}

describe('a PDF signed once', () => {
  it('verifies: coverage, digest, chain and a proven signing time', async () => {
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures).toHaveLength(1);
    const [signature] = report.signatures;
    expect(signature).toMatchObject({
      role: 'LEADER',
      status: 'VALID',
      chainStatus: 'TRUSTED',
      trustRegime: 'PUBLIC_CA',
      profile: 'PADES_B_T',
      incrementalChangesAllowed: true,
      revocationStatus: 'NOT_CHECKED',
      findings: [],
    });
    expect(signature?.signedAt).toEqual(SIGNED_AT);
    expect(signature?.timestampAt).toEqual(SIGNED_AT);
    expect(signature?.subjectDn).toContain('Nguyen Van A');
    expect(signature?.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(signature?.byteRange?.[0]).toBe(0);
    expect(signature?.coversEndOffset).toBeGreaterThan(0);
  });

  it('is INVALID with DIGEST_MISMATCH when one byte of the signed range changes', async () => {
    const signed = await leaderSigned();
    const at = signed.indexOf('(Hello)') + 5;
    const tampered = Buffer.from(signed);
    tampered[at] = 'p'.charCodeAt(0);
    const report = await verifyPdfSignatures(tampered, world.trust, NOW);
    expect(report.overall).toBe('INVALID');
    expect(report.signatures[0]?.findings).toContain('DIGEST_MISMATCH');
  });

  it('is INDETERMINATE with SIGNING_TIME_UNPROVEN when no timestamp proves the time, and VALID under LENIENT_TIME', async () => {
    const signed = await signField(revisionZero(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT });
    const strict = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(strict.overall).toBe('INDETERMINATE');
    expect(strict.signatures[0]).toMatchObject({ status: 'INDETERMINATE', profile: 'PADES_B_B', findings: ['SIGNING_TIME_UNPROVEN'] });
    expect(strict.signatures[0]?.signedAt).toEqual(SIGNED_AT);
    expect(strict.signatures[0]?.timestampAt).toBeNull();
    const lenient = await verifyPdfSignatures(signed, world.trust, NOW, { policy: 'LENIENT_TIME' });
    expect(lenient.overall).toBe('VALID');
  });

  it('records DocMDP level 2 for a certifying signature', async () => {
    const signed = await signField(revisionZero(), {
      field: 'sig_leader',
      identity: world.leader,
      signingTime: SIGNED_AT,
      timestamps: world.tsa,
      docMdpLevel: 2,
    });
    const report = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures[0]?.docmdpLevel).toBe(2);
  });

  it('keeps no private material in the report', async () => {
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/PRIVATE KEY|privateKey|BEGIN/);
    expect(Object.keys(report.signatures[0] ?? {}).sort()).toEqual(
      [
        'byteRange', 'chainStatus', 'coversEndOffset', 'docmdpLevel', 'findings', 'fingerprintSha256', 'incrementalChangesAllowed',
        'index', 'issuerDn', 'profile', 'revocationStatus', 'role', 'serial', 'signedAt', 'status', 'subjectDn', 'timestampAt', 'trustRegime',
      ].sort(),
    );
  });
});

describe('a PDF without a signature', () => {
  it('has no signatures and is INDETERMINATE', async () => {
    const report = await verifyPdfSignatures(revisionZero(), world.trust, NOW);
    expect(report).toMatchObject({ overall: 'INDETERMINATE', signatures: [] });
    expect(report.verifierVersion).toBe('machvon-pades/1');
  });
});

describe('the whole flow: leader, numbering, organisation seal', () => {
  it('verifies three signatures-worth of steps with the numbering revision allowed', async () => {
    const leader = await leaderSigned();
    const numbered = withNumbering(leader, NUMBERING);
    const sealed = await signField(numbered, { field: 'sig_org', identity: world.organization, signingTime: new Date('2026-10-23T08:30:00Z'), timestamps: world.tsa });
    world.setTime(SIGNED_AT);
    const report = await verifyPdfSignatures(sealed, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures.map((signature) => signature.role)).toEqual(['LEADER', 'ORGANIZATION']);
    expect(report.signatures.map((signature) => signature.incrementalChangesAllowed)).toEqual([true, true]);
    expect(report.signatures[1]?.coversEndOffset).toBe(sealed.length);
  });

  it('keeps the bytes of the earlier revisions unchanged', async () => {
    const leader = await leaderSigned();
    const numbered = withNumbering(leader, NUMBERING);
    expect(numbered.subarray(0, leader.length).equals(leader)).toBe(true);
  });

  it('flags the organisation seal when it was applied before the leader signed', async () => {
    const sealedFirst = await signField(revisionZero(), { field: 'sig_org', identity: world.organization, signingTime: SIGNED_AT, timestamps: world.tsa });
    const both = await signField(sealedFirst, { field: 'sig_leader', identity: world.leader, signingTime: new Date('2026-10-23T08:30:00Z'), timestamps: world.tsa });
    const report = await verifyPdfSignatures(both, world.trust, NOW);
    expect(report.overall).toBe('INVALID');
    expect(report.signatures.find((signature) => signature.role === 'ORGANIZATION')?.findings).toContain('SIGNING_ORDER_INVALID');
  });
});

describe('revisions appended after a signature', () => {
  it('flags a revision that changes the page content: INCREMENTAL_CHANGES_NOT_ALLOWED', async () => {
    const leader = await leaderSigned();
    const changed = appendRevision(leader, [{ num: 4, body: '<< /Length 36 >>\nstream\nBT /F1 12 Tf 72 780 Td (Fraud) Tj ET\nendstream' }]).pdf;
    const report = await verifyPdfSignatures(changed, world.trust, NOW);
    expect(report.overall).toBe('INVALID');
    expect(report.signatures[0]).toMatchObject({ incrementalChangesAllowed: false, status: 'INVALID' });
    expect(report.signatures[0]?.findings).toEqual(['INCREMENTAL_CHANGES_NOT_ALLOWED']);
  });

  it('flags bytes appended after the last revision', async () => {
    const report = await verifyPdfSignatures(Buffer.concat([await leaderSigned(), Buffer.from('trailing bytes')]), world.trust, NOW);
    expect(report.signatures[0]?.incrementalChangesAllowed).toBe(false);
  });

  it('allows validation data and a document timestamp after the signature, and reports the archival profile', async () => {
    const base = await signField(revisionZero({ timestampField: true }), {
      field: 'sig_leader',
      identity: world.leader,
      signingTime: SIGNED_AT,
      timestamps: world.tsa,
    });
    const withDss = withValidationData(base, [world.root.certificate]);
    world.setTime(NOW);
    const archived = await stampDocument(withDss, world.tsa, NOW);
    world.setTime(SIGNED_AT);
    const report = await verifyPdfSignatures(archived, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures.map((signature) => [signature.role, signature.profile, signature.status])).toEqual([
      ['LEADER', 'PADES_B_LTA', 'VALID'],
      ['DOCUMENT_TIMESTAMP', 'PADES_B_LTA', 'VALID'],
    ]);
    expect(report.signatures[1]?.timestampAt).toEqual(NOW);
  });

  it('reports a long-term profile for validation data without a document timestamp', async () => {
    const withDss = withValidationData(await leaderSigned(), [world.root.certificate]);
    const report = await verifyPdfSignatures(withDss, world.trust, NOW);
    expect(report.signatures[0]).toMatchObject({ profile: 'PADES_B_LT', status: 'VALID', incrementalChangesAllowed: true });
  });

  it('flags a document timestamp from an authority nobody trusts', async () => {
    const base = await signField(revisionZero({ timestampField: true }), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: world.tsa });
    const stranger = await createWorld();
    const stamped = await stampDocument(base, stranger.tsa, NOW);
    const report = await verifyPdfSignatures(stamped, world.trust, NOW);
    expect(report.overall).toBe('INVALID');
    expect(report.signatures[1]?.findings).toEqual(['TIMESTAMP_INVALID']);
  });
});

describe('certificate chains', () => {
  it('flags a chain that ends at an authority outside the trust list: CHAIN_UNTRUSTED', async () => {
    const stranger = await createWorld();
    const signed = await signField(revisionZero(), {
      field: 'sig_leader',
      identity: { ...stranger.leader, chain: [stranger.root.certificate] },
      signingTime: SIGNED_AT,
      timestamps: world.tsa,
    });
    const report = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(report.signatures[0]?.chainStatus).toBe('UNTRUSTED');
    expect(report.signatures[0]?.findings).toContain('CHAIN_UNTRUSTED');
    expect(report.overall).toBe('INVALID');
  });

  it('accepts a chain through an intermediate authority and reports an unreachable one as incomplete', async () => {
    const intermediate = await world.root.createIntermediate({ commonName: 'Test Intermediate', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    const identity = await intermediate.issue({ commonName: 'Tran Thi B', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    const signed = await signField(revisionZero(), { field: 'sig_leader', identity, signingTime: SIGNED_AT, timestamps: world.tsa });
    expect((await verifyPdfSignatures(signed, world.trust, NOW)).overall).toBe('VALID');
    const withoutIntermediate = await signField(revisionZero(), { field: 'sig_leader', identity: { ...identity, chain: [] }, signingTime: SIGNED_AT, timestamps: world.tsa });
    const incomplete = await verifyPdfSignatures(withoutIntermediate, world.trust, NOW);
    expect(incomplete.signatures[0]).toMatchObject({ chainStatus: 'INCOMPLETE', status: 'INDETERMINATE' });
    expect(incomplete.signatures[0]?.findings).toEqual(['CHAIN_INCOMPLETE']);
  });

  it('keeps the two trust regimes apart: the regime of the anchor is reported', async () => {
    const signed = await leaderSigned();
    const report = await verifyPdfSignatures(signed, trustStoreOf(world.root, 'GOV_SPECIALIZED'), NOW);
    expect(report.signatures[0]?.trustRegime).toBe('GOV_SPECIALIZED');
  });
});

describe('other signatures', () => {
  it('reports a signature in a field of another name as EXTERNAL and reads an explicit SHA-384 certificate binding', async () => {
    const signed = await signField(revisionZero({ timestampField: true }), {
      field: 'doc_timestamp',
      identity: world.leader,
      signingTime: SIGNED_AT,
      timestamps: world.tsa,
      essHash: 'sha384',
    });
    const report = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(report.signatures[0]).toMatchObject({ role: 'EXTERNAL', status: 'VALID' });
  });

  it('refuses a chain deeper than the limit and a timestamp token that carries no TSTInfo', async () => {
    let authority = world.root;
    for (let depth = 0; depth < 9; depth += 1) {
      authority = await authority.createIntermediate({ commonName: `Level ${depth}`, notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    }
    const deep = await authority.issue({ commonName: 'Deep', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    const chainReport = await verifyPdfSignatures(
      await signField(revisionZero(), { field: 'sig_leader', identity: deep, signingTime: SIGNED_AT, timestamps: world.tsa }),
      world.trust,
      NOW,
    );
    expect(chainReport.signatures[0]?.chainStatus).toBe('INCOMPLETE');
    const broken = new MockTimestampAuthority(await world.root.issue({ commonName: 'Broken TSA', notBefore: VALID_FROM, notAfter: VALID_UNTIL }), () => SIGNED_AT, Buffer.from('3003020101', 'hex'));
    const stamped = await verifyPdfSignatures(
      await signField(revisionZero(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: broken }),
      world.trust,
      NOW,
    );
    expect(stamped.signatures[0]?.findings).toContain('TIMESTAMP_INVALID');
  });
});

describe('signing time and validity', () => {
  it('flags a certificate that had expired when the timestamp says it was used: CERTIFICATE_EXPIRED_AT_SIGNING', async () => {
    const shortLived = await world.root.issue({ commonName: 'Short Lived', notBefore: VALID_FROM, notAfter: new Date('2026-06-01T00:00:00Z') });
    const signed = await signField(revisionZero(), { field: 'sig_leader', identity: shortLived, signingTime: SIGNED_AT, timestamps: world.tsa });
    const report = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(report.signatures[0]?.findings).toContain('CERTIFICATE_EXPIRED_AT_SIGNING');
    expect(report.overall).toBe('INVALID');
  });

  it('accepts a certificate that has expired since, when a timestamp proves it was valid at the time', async () => {
    const shortLived = await world.root.issue({ commonName: 'Short Lived', notBefore: VALID_FROM, notAfter: new Date('2026-10-23T08:30:00Z') });
    const signed = await signField(revisionZero(), { field: 'sig_leader', identity: shortLived, signingTime: SIGNED_AT, timestamps: world.tsa });
    const report = await verifyPdfSignatures(signed, world.trust, new Date('2027-05-01T00:00:00Z'));
    expect(report.overall).toBe('VALID');
  });

  it('cannot tell for an expired certificate with only a declared time: SIGNING_TIME_UNPROVEN, not a verdict', async () => {
    const shortLived = await world.root.issue({ commonName: 'Short Lived', notBefore: VALID_FROM, notAfter: new Date('2026-10-23T08:30:00Z') });
    const signed = await signField(revisionZero(), { field: 'sig_leader', identity: shortLived, signingTime: SIGNED_AT });
    const report = await verifyPdfSignatures(signed, world.trust, new Date('2027-05-01T00:00:00Z'));
    expect(report.signatures[0]).toMatchObject({ status: 'INDETERMINATE', findings: ['SIGNING_TIME_UNPROVEN'] });
  });

  it('flags a timestamp that does not belong to this signature: TIMESTAMP_INVALID', async () => {
    const stranger = await createWorld();
    const signed = await signField(revisionZero(), { field: 'sig_leader', identity: world.leader, signingTime: SIGNED_AT, timestamps: stranger.tsa });
    const report = await verifyPdfSignatures(signed, world.trust, NOW);
    expect(report.signatures[0]?.findings).toContain('TIMESTAMP_INVALID');
    expect(report.overall).toBe('INVALID');
  });
});

describe('revocation', () => {
  it('is not asked when no port is given, and recorded as GOOD when the port says so', async () => {
    const signed = await leaderSigned();
    const port = revocationReturning({ status: 'GOOD' });
    const report = await verifyPdfSignatures(signed, world.trust, NOW, { revocation: port });
    expect(port.calls).toBe(1);
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'GOOD', status: 'VALID' });
  });

  it('flags a certificate revoked before the signature: CERTIFICATE_REVOKED', async () => {
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW, {
      revocation: revocationReturning({ status: 'REVOKED', revokedAt: new Date('2026-10-01T00:00:00Z') }),
    });
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'REVOKED', status: 'INVALID' });
    expect(report.signatures[0]?.findings).toContain('CERTIFICATE_REVOKED');
  });

  it('does not count a revocation that happened after the signature', async () => {
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW, {
      revocation: revocationReturning({ status: 'REVOKED', revokedAt: new Date('2026-10-23T08:30:00Z') }),
    });
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'GOOD', status: 'VALID' });
  });

  it('leaves the outcome open when the status is unknown: REVOCATION_UNKNOWN', async () => {
    const report = await verifyPdfSignatures(await leaderSigned(), world.trust, NOW, {
      revocation: revocationReturning({ status: 'UNKNOWN' }),
      policy: 'LENIENT_TIME',
    });
    expect(report.signatures[0]).toMatchObject({ revocationStatus: 'UNKNOWN', status: 'INDETERMINATE' });
    expect(report.overall).toBe('INDETERMINATE');
  });

  it('does not ask for the status of a signature that is already invalid', async () => {
    const port = revocationReturning({ status: 'GOOD' });
    const report = await verifyPdfSignatures(await leaderSigned(), trustStoreOf(await MockCertificateAuthority.createRoot({ commonName: 'Other', notBefore: VALID_FROM, notAfter: VALID_UNTIL })), NOW, { revocation: port });
    expect(port.calls).toBe(0);
    expect(report.signatures[0]?.revocationStatus).toBe('NOT_CHECKED');
  });
});

describe('algorithms', () => {
  it('refuses an RSA key shorter than 2048 bits and accepts RSA 2048', async () => {
    const weak = await world.root.issue({ commonName: 'Weak', notBefore: VALID_FROM, notAfter: VALID_UNTIL, keyType: 'rsa-1024' });
    const weakReport = await verifyPdfSignatures(
      await signField(revisionZero(), { field: 'sig_leader', identity: weak, signingTime: SIGNED_AT, timestamps: world.tsa }),
      world.trust,
      NOW,
    );
    expect(weakReport.signatures[0]?.findings).toEqual(['ALGORITHM_NOT_ALLOWED']);
    const strong = await world.root.issue({ commonName: 'Strong', notBefore: VALID_FROM, notAfter: VALID_UNTIL, keyType: 'rsa' });
    const strongReport = await verifyPdfSignatures(
      await signField(revisionZero(), { field: 'sig_leader', identity: strong, signingTime: SIGNED_AT, timestamps: world.tsa }),
      world.trust,
      NOW,
    );
    expect(strongReport.overall).toBe('VALID');
  }, 60_000);
});

describe('damaged signatures', () => {
  it('flags a ByteRange that does not end at a revision: BYTE_RANGE_INVALID', async () => {
    const signed = await leaderSigned();
    const text = signed.toString('latin1');
    const at = text.indexOf('/ByteRange [');
    const damaged = Buffer.from(text.slice(0, at) + text.slice(at).replace(/(\d{10})\]/, (match) => `${String(Number(match.slice(0, 10)) - 1).padStart(10, '0')}]`), 'latin1');
    const report = await verifyPdfSignatures(damaged, world.trust, NOW);
    expect(report.signatures[0]?.findings).toEqual(['BYTE_RANGE_INVALID']);
    expect(report.signatures[0]?.status).toBe('INVALID');
  });

  it('flags a Contents value that is not a CMS: SIGNATURE_MALFORMED', async () => {
    const signed = await leaderSigned();
    const text = signed.toString('latin1');
    const at = text.indexOf('/Contents <') + '/Contents <'.length;
    const damaged = Buffer.from(`${text.slice(0, at)}3003020101${text.slice(at + 10)}`, 'latin1');
    const report = await verifyPdfSignatures(damaged, world.trust, NOW);
    expect(report.signatures[0]?.findings).toEqual(['SIGNATURE_MALFORMED']);
  });

  it('flags a signature value that does not match the signed attributes: SIGNATURE_INVALID', async () => {
    const signed = await leaderSigned();
    const text = signed.toString('latin1');
    const at = text.indexOf('/Contents <') + '/Contents <'.length;
    const hex = /^[0-9A-F]+/.exec(text.slice(at))?.[0] ?? '';
    const used = hex.replace(/0+$/, '');
    // Flip a hex digit inside the signature value, which sits near the end of the signer info (before the timestamp).
    const position = at + Math.floor(used.length * 0.45);
    const flipped = text[position] === 'A' ? 'B' : 'A';
    const damaged = Buffer.from(text.slice(0, position) + flipped + text.slice(position + 1), 'latin1');
    const report = await verifyPdfSignatures(damaged, world.trust, NOW);
    expect(report.overall).toBe('INVALID');
  });
});
