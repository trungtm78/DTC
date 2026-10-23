import { allowedDigestName, isAllowedAlgorithm, overallOf, statusOfFindings } from '../src/pades.ts';
import type { SignatureFinding, SignatureResult, SignatureStatus } from '../src/pades.ts';

function signature(status: SignatureStatus, findings: SignatureFinding[] = []): SignatureResult {
  return {
    index: 0,
    role: 'LEADER',
    subjectDn: null,
    issuerDn: null,
    serial: null,
    fingerprintSha256: null,
    trustRegime: null,
    profile: 'PADES_B_B',
    docmdpLevel: null,
    byteRange: null,
    coversEndOffset: null,
    signedAt: null,
    timestampAt: null,
    status,
    chainStatus: 'NOT_CHECKED',
    revocationStatus: 'NOT_CHECKED',
    incrementalChangesAllowed: null,
    findings,
  };
}

describe('statusOfFindings', () => {
  it('is VALID without findings', () => {
    expect(statusOfFindings([])).toBe('VALID');
  });

  it('is INDETERMINATE when something could not be established', () => {
    expect(statusOfFindings(['SIGNING_TIME_UNPROVEN'])).toBe('INDETERMINATE');
    expect(statusOfFindings(['CHAIN_INCOMPLETE'])).toBe('INDETERMINATE');
    expect(statusOfFindings(['REVOCATION_UNKNOWN'])).toBe('INDETERMINATE');
  });

  it('lets a hard finding win over an open one', () => {
    expect(statusOfFindings(['SIGNING_TIME_UNPROVEN', 'DIGEST_MISMATCH'])).toBe('INVALID');
    expect(statusOfFindings(['INCREMENTAL_CHANGES_NOT_ALLOWED'])).toBe('INVALID');
  });
});

describe('overallOf', () => {
  it('is INDETERMINATE for a file nobody signed', () => {
    expect(overallOf([], 'STRICT')).toBe('INDETERMINATE');
  });

  it('is VALID only when every signature is VALID', () => {
    expect(overallOf([signature('VALID'), signature('VALID')], 'STRICT')).toBe('VALID');
    expect(overallOf([signature('VALID'), signature('INDETERMINATE', ['CHAIN_INCOMPLETE'])], 'STRICT')).toBe('INDETERMINATE');
  });

  it('is INVALID as soon as one signature is INVALID, whatever the policy', () => {
    const invalid = signature('INVALID', ['DIGEST_MISMATCH']);
    expect(overallOf([signature('VALID'), invalid], 'STRICT')).toBe('INVALID');
    expect(overallOf([signature('VALID'), invalid], 'LENIENT_TIME')).toBe('INVALID');
  });

  it('accepts a signing time nobody proved only under LENIENT_TIME', () => {
    const unproven = signature('INDETERMINATE', ['SIGNING_TIME_UNPROVEN']);
    expect(overallOf([unproven], 'STRICT')).toBe('INDETERMINATE');
    expect(overallOf([unproven], 'LENIENT_TIME')).toBe('VALID');
  });

  it('does not let LENIENT_TIME forgive anything but the signing time', () => {
    const mixed = signature('INDETERMINATE', ['SIGNING_TIME_UNPROVEN', 'REVOCATION_UNKNOWN']);
    expect(overallOf([mixed], 'LENIENT_TIME')).toBe('INDETERMINATE');
  });
});

describe('isAllowedAlgorithm', () => {
  const SHA256 = '2.16.840.1.101.3.4.2.1';
  const SHA1 = '1.3.14.3.2.26';

  it('names the allowed digests and refuses SHA-1', () => {
    expect(allowedDigestName(SHA256)).toBe('sha256');
    expect(allowedDigestName('2.16.840.1.101.3.4.2.2')).toBe('sha384');
    expect(allowedDigestName('2.16.840.1.101.3.4.2.3')).toBe('sha512');
    expect(allowedDigestName(SHA1)).toBeNull();
  });

  it('allows RSA from 2048 bits and refuses shorter keys', () => {
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.113549.1.1.11', oidDigest: SHA256, keyType: 'rsa', rsaBits: 2048 })).toBe(true);
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.113549.1.1.11', oidDigest: SHA256, keyType: 'rsa', rsaBits: 1024 })).toBe(false);
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.113549.1.1.11', oidDigest: SHA256, keyType: 'rsa' })).toBe(false);
  });

  it('allows ECDSA on P-256 and above and refuses other curves', () => {
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.10045.4.3.2', oidDigest: SHA256, keyType: 'ec', curve: 'prime256v1' })).toBe(true);
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.10045.4.3.2', oidDigest: SHA256, keyType: 'ec', curve: 'secp256k1' })).toBe(false);
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.10045.4.3.2', oidDigest: SHA256, keyType: 'ec' })).toBe(false);
  });

  it('refuses a digest that is too weak, a signature OID of the other family and an unknown key type', () => {
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.113549.1.1.11', oidDigest: SHA1, keyType: 'rsa', rsaBits: 3072 })).toBe(false);
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.10045.4.3.2', oidDigest: SHA256, keyType: 'rsa', rsaBits: 3072 })).toBe(false);
    expect(isAllowedAlgorithm({ oidSignature: '1.2.840.113549.1.1.11', oidDigest: SHA256, keyType: 'ed25519' })).toBe(false);
  });
});
