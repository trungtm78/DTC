import { MockCertificateAuthority, MockTimestampAuthority, OID } from '../../../src/modules/doc/mock-pki';
import type { Identity } from '../../../src/modules/doc/mock-pki';
import type { TrustStore } from '../../../src/modules/doc/cms-verification';
import type { RevocationAnswer, RevocationPort } from '../../../src/modules/doc/pades-verifier';

export const SIGNED_AT = new Date('2026-10-23T08:00:00Z');
export const NOW = new Date('2026-10-23T09:00:00Z');
const VALID_FROM = new Date('2026-01-01T00:00:00Z');
const VALID_UNTIL = new Date('2030-01-01T00:00:00Z');

export interface World {
  root: MockCertificateAuthority;
  trust: TrustStore;
  leader: Identity;
  organization: Identity;
  /** Stamps the time given to `setTime`, so a test chooses when the timestamp says it was made. */
  tsa: MockTimestampAuthority;
  /** The certificate of the timestamp authority above, DER. */
  tsaCertificate: Buffer;
  setTime(at: Date): void;
}

export function trustStoreOf(root: MockCertificateAuthority, regime: 'PUBLIC_CA' | 'GOV_SPECIALIZED' = 'PUBLIC_CA'): TrustStore {
  return { anchors: () => [{ regime, certificate: root.certificate }] };
}

/** A test certification authority with a leader, an organisation seal and a timestamp authority, all trusted. */
export async function createWorld(): Promise<World> {
  const root = await MockCertificateAuthority.createRoot({ commonName: 'Test Root CA', notBefore: VALID_FROM, notAfter: new Date('2040-01-01T00:00:00Z') });
  const leader = await root.issue({ commonName: 'Nguyen Van A', organization: 'Test Agency', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
  const organization = await root.issue({ commonName: 'Test Agency Seal', notBefore: VALID_FROM, notAfter: VALID_UNTIL });
  const authority = await root.issue({ commonName: 'Test TSA', notBefore: VALID_FROM, notAfter: VALID_UNTIL, extendedKeyUsage: [OID.timeStamping] });
  let time = SIGNED_AT;
  return {
    root,
    trust: trustStoreOf(root),
    leader,
    organization,
    tsa: new MockTimestampAuthority(authority, () => time),
    tsaCertificate: authority.certificate,
    setTime: (at) => {
      time = at;
    },
  };
}

export function revocationReturning(answer: RevocationAnswer): RevocationPort & { calls: number } {
  const port = {
    calls: 0,
    check: async (): Promise<RevocationAnswer> => {
      port.calls += 1;
      return answer;
    },
  };
  return port;
}

export { VALID_FROM, VALID_UNTIL };

/** A revocation port that answers per certificate and remembers which certificates were asked about, in order. */
export function revocationByCertificate(answers: ReadonlyMap<string, RevocationAnswer>): RevocationPort & { asked: string[] } {
  const port = {
    asked: [] as string[],
    check: async (query: { certificate: Buffer }): Promise<RevocationAnswer> => {
      const key = query.certificate.toString('hex');
      port.asked.push(key);
      return answers.get(key) ?? { status: 'GOOD' };
    },
  };
  return port;
}
