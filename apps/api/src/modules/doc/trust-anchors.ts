import { X509Certificate } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TRUST_REGIMES } from '@machvon/kernel';
import type { TrustRegime } from '@machvon/kernel';
import type { TrustAnchor, TrustStore } from './cms-verification';
import type { RevocationAnswer, RevocationPort } from './pades-verifier';

/** The trust anchors a tenant verifies against (BR-DOC-15: configuration data, changed only with legal approval). */
export interface TrustStoreProvider {
  forTenant(tenantId: string): Promise<TrustStore>;
}

const CERTIFICATE_FILE = /\.(pem|crt|cer|der)$/i;

function anchorsOf(directory: string, regime: TrustRegime): TrustAnchor[] {
  const folder = join(directory, regime);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch (error) {
    // A regime without a folder simply has no anchors; any other failure must stop the start.
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((name) => CERTIFICATE_FILE.test(name))
    .sort()
    .map((name) => {
      try {
        return { regime, certificate: new X509Certificate(readFileSync(join(folder, name))).raw };
      } catch {
        // The file name identifies the problem; the content is never echoed.
        throw new Error(`trust anchor ${regime}/${name} is not a certificate`);
      }
    });
}

/** Reads `<directory>/PUBLIC_CA/*` and `<directory>/GOV_SPECIALIZED/*` (PEM or DER); no directory means no anchors. */
export function loadTrustAnchors(directory: string | undefined): TrustAnchor[] {
  if (directory === undefined || directory === '') return [];
  return TRUST_REGIMES.flatMap((regime) => anchorsOf(directory, regime));
}

/** The same anchors for every tenant, until per-tenant trust lists have a table (recorded design gap). */
export class StaticTrustStoreProvider implements TrustStoreProvider {
  private readonly store: TrustStore;

  constructor(anchors: readonly TrustAnchor[]) {
    this.store = { anchors: () => anchors };
  }

  forTenant(): Promise<TrustStore> {
    return Promise.resolve(this.store);
  }
}

/** The revocation port used until an OCSP/CRL adapter exists: it cannot tell, and says so. */
export class UnavailableRevocationPort implements RevocationPort {
  check(): Promise<RevocationAnswer> {
    return Promise.resolve({ status: 'UNKNOWN' });
  }
}
