import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DomainError } from '@machvon/kernel';
import type { LicenseSigner } from '@machvon/kernel';

/** Injection token of the key store the license commands sign with. */
export const LICENSE_KEYS = Symbol('LICENSE_KEYS');

/**
 * Where license signing keys live (SAS 3.8). The platform only ever asks a key to sign and reads public keys: a private key
 * is not exported by this port, so it can move behind a KMS or an HSM (KERNEL-012) without a change of the callers.
 */
export interface LicenseKeyStore {
  /** The key that signs now; 503 SIGNING_KEY_UNAVAILABLE when there is none. */
  current(): Promise<LicenseSigner>;
  /** `kid` to the SPKI DER bytes of every key that may have signed a license still valid: the current one and a retiring one. */
  publicKeys(): Promise<ReadonlyMap<string, Uint8Array>>;
}

const unavailable = (): DomainError => new DomainError('SIGNING_KEY_UNAVAILABLE', 503);

/** Signs with an Ed25519 private key held in memory (EdDSA, as the claims say). */
export class Ed25519LicenseSigner implements LicenseSigner {
  constructor(
    readonly keyId: string,
    private readonly privateKey: KeyObject,
  ) {
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('a license is signed with an Ed25519 key');
  }

  sign(payload: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(sign(null, payload, this.privateKey));
  }
}

const spkiOf = (key: KeyObject): Uint8Array => key.export({ format: 'der', type: 'spki' });

export interface EnvironmentKeyConfig {
  /** `LICENSE_SIGNING_KEY_ID` and `LICENSE_SIGNING_KEY_PEM_PATH`: the key that signs now (PKCS8 PEM file). */
  keyId: string | undefined;
  keyPath: string | undefined;
  /** `LICENSE_RETIRED_KEY_ID` and `LICENSE_RETIRED_KEY_PUBLIC_PEM_PATH`: the previous key, public half only, while licenses it signed are valid. */
  retiredKeyId: string | undefined;
  retiredPublicKeyPath: string | undefined;
}

/**
 * The development adapter: the private key comes from a PEM file named in the environment (a secret store mounts it in
 * deployment) and is read once, when it is first needed. It never reaches the database, an audit row or a log: a file that
 * cannot be read or is not an Ed25519 key is the same 503 as no key at all, and the message names neither the path nor the content.
 */
export class EnvironmentLicenseKeyStore implements LicenseKeyStore {
  private loaded: { signer: Ed25519LicenseSigner; publicKey: Uint8Array; publicKeyPem: string } | undefined;

  constructor(
    private readonly config: EnvironmentKeyConfig,
    private readonly readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  ) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env, readText?: (path: string) => string): EnvironmentLicenseKeyStore {
    const config: EnvironmentKeyConfig = {
      keyId: env.LICENSE_SIGNING_KEY_ID,
      keyPath: env.LICENSE_SIGNING_KEY_PEM_PATH,
      retiredKeyId: env.LICENSE_RETIRED_KEY_ID,
      retiredPublicKeyPath: env.LICENSE_RETIRED_KEY_PUBLIC_PEM_PATH,
    };
    return new EnvironmentLicenseKeyStore(config, readText);
  }

  private load(): { signer: Ed25519LicenseSigner; publicKey: Uint8Array; publicKeyPem: string } {
    if (this.loaded !== undefined) return this.loaded;
    const { keyId, keyPath } = this.config;
    if (keyId === undefined || keyId === '' || keyPath === undefined || keyPath === '') throw unavailable();
    try {
      const privateKey = createPrivateKey(this.readText(keyPath));
      const publicKey = createPublicKey(privateKey);
      this.loaded = {
        signer: new Ed25519LicenseSigner(keyId, privateKey),
        publicKey: spkiOf(publicKey),
        publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      };
    } catch {
      // Nothing of the error is kept: it could quote the file.
      throw unavailable();
    }
    return this.loaded;
  }

  current(): Promise<LicenseSigner> {
    try {
      return Promise.resolve(this.load().signer);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async publicKeys(): Promise<ReadonlyMap<string, Uint8Array>> {
    const keys = new Map<string, Uint8Array>();
    const { retiredKeyId, retiredPublicKeyPath } = this.config;
    if (retiredKeyId !== undefined && retiredKeyId !== '' && retiredPublicKeyPath !== undefined && retiredPublicKeyPath !== '') {
      try {
        keys.set(retiredKeyId, spkiOf(createPublicKey(this.readText(retiredPublicKeyPath))));
      } catch {
        // A retired key that cannot be read verifies nothing; the current key is still served.
      }
    }
    const { signer, publicKey } = this.load();
    keys.set(signer.keyId, publicKey);
    return keys;
  }

  /** The public half of the key that signs, as PEM, for `license_signing_key.public_key_pem`; taken from the key loaded for signing, never from a second read of the file. */
  publicKeyPem(): Promise<string> {
    try {
      return Promise.resolve(this.load().publicKeyPem);
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
