import { X509Certificate } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockCertificateAuthority } from '../../src/modules/doc/mock-pki';
import { StaticTrustStoreProvider, UnavailableRevocationPort, loadTrustAnchors } from '../../src/modules/doc/trust-anchors';
import { VALID_FROM, VALID_UNTIL } from './support/pki-world';

function pem(der: Buffer): string {
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END CERTIFICATE-----\n`;
}

describe('trust anchors (BR-DOC-15)', () => {
  let directory = '';
  let publicRoot: MockCertificateAuthority;
  let governmentRoot: MockCertificateAuthority;

  beforeAll(async () => {
    publicRoot = await MockCertificateAuthority.createRoot({ commonName: 'Public Root', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
    governmentRoot = await MockCertificateAuthority.createRoot({ commonName: 'Government Root', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
  });

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'machvon-anchors-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads PEM and DER certificates of each regime folder and ignores other files', () => {
    mkdirSync(join(directory, 'PUBLIC_CA'));
    mkdirSync(join(directory, 'GOV_SPECIALIZED'));
    writeFileSync(join(directory, 'PUBLIC_CA', 'root.pem'), pem(publicRoot.certificate));
    writeFileSync(join(directory, 'PUBLIC_CA', 'readme.txt'), 'not a certificate');
    writeFileSync(join(directory, 'GOV_SPECIALIZED', 'root.der'), governmentRoot.certificate);
    const anchors = loadTrustAnchors(directory);
    expect(anchors.map((anchor) => [anchor.regime, new X509Certificate(anchor.certificate).subject])).toEqual([
      ['PUBLIC_CA', 'CN=Public Root'],
      ['GOV_SPECIALIZED', 'CN=Government Root'],
    ]);
  });

  it('has no anchors for a regime without a folder, for an unset directory and for an empty one', () => {
    mkdirSync(join(directory, 'PUBLIC_CA'));
    writeFileSync(join(directory, 'PUBLIC_CA', 'root.crt'), pem(publicRoot.certificate));
    expect(loadTrustAnchors(directory).map((anchor) => anchor.regime)).toEqual(['PUBLIC_CA']);
    expect(loadTrustAnchors(undefined)).toEqual([]);
    expect(loadTrustAnchors('')).toEqual([]);
  });

  it('refuses a file that is not a certificate, naming the file and not its content', () => {
    mkdirSync(join(directory, 'PUBLIC_CA'));
    writeFileSync(join(directory, 'PUBLIC_CA', 'broken.pem'), 'SECRET-CONTENT');
    expect(() => loadTrustAnchors(directory)).toThrow('trust anchor PUBLIC_CA/broken.pem is not a certificate');
    expect(() => loadTrustAnchors(directory)).not.toThrow(/SECRET-CONTENT/);
  });

  it('fails when a regime folder cannot be read for another reason than being absent', () => {
    writeFileSync(join(directory, 'PUBLIC_CA'), 'a file where a folder should be');
    expect(() => loadTrustAnchors(directory)).toThrow();
  });

  it('gives every tenant the same anchors, and revocation that says it cannot tell', async () => {
    const provider = new StaticTrustStoreProvider([{ regime: 'PUBLIC_CA', certificate: publicRoot.certificate }]);
    expect((await provider.forTenant()).anchors()).toHaveLength(1);
    expect(await new UnavailableRevocationPort().check()).toEqual({ status: 'UNKNOWN' });
  });
});
