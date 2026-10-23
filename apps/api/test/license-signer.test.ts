import { generateKeyPairSync, verify } from 'node:crypto';
import { signLicenseClaims, verifyLicenseToken } from '@machvon/kernel';
import type { LicenseClaims } from '@machvon/kernel';
import { Ed25519LicenseSigner, EnvironmentLicenseKeyStore } from '../src/modules/sas/license-signer';

const ed = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const retired = generateKeyPairSync('ed25519');
const pem = (key: { export(options: { format: 'pem'; type: 'pkcs8' | 'spki' }): string | Buffer }, type: 'pkcs8' | 'spki'): string => key.export({ format: 'pem', type }).toString();
const PRIVATE_PEM = pem(ed.privateKey, 'pkcs8');
const files: Record<string, string> = {
  '/keys/current.pem': PRIVATE_PEM,
  '/keys/rsa.pem': pem(rsa.privateKey, 'pkcs8'),
  '/keys/retired.pub': pem(retired.publicKey, 'spki'),
  '/keys/garbage.pem': 'not a key',
};
const readText = (path: string): string => {
  const text = files[path];
  if (text === undefined) throw new Error(`ENOENT ${path}`);
  return text;
};

const CLAIMS: LicenseClaims = {
  iss: 'machvon-platform',
  tenant_id: '00000000-0000-4000-8000-00000000000a',
  license_id: '00000000-0000-4000-8000-0000000000f1',
  serial: 'LIC-1',
  revision: 1,
  edition: 'STANDARD',
  valid_from: '2026-10-01T00:00:00.000Z',
  valid_until: '2027-10-01T00:00:00.000Z',
  grace_until: '2027-10-31T00:00:00.000Z',
  entitlements_hash: 'a'.repeat(64),
  seats: 5,
  quota: {},
  kid: 'x',
};

describe('Ed25519LicenseSigner', () => {
  it('signs with the key it holds and only an Ed25519 key is accepted', async () => {
    const signer = new Ed25519LicenseSigner('kid-1', ed.privateKey);
    const signature = await signer.sign(Buffer.from('payload'));
    expect(verify(null, Buffer.from('payload'), ed.publicKey, signature)).toBe(true);
    expect(() => new Ed25519LicenseSigner('kid-1', rsa.privateKey)).toThrow('Ed25519');
  });
});

describe('EnvironmentLicenseKeyStore', () => {
  const config = { keyId: 'kid-2026', keyPath: '/keys/current.pem', retiredKeyId: 'kid-2025', retiredPublicKeyPath: '/keys/retired.pub' };

  it('signs licenses that verify with the public keys it serves, the current key and the retired one', async () => {
    const store = new EnvironmentLicenseKeyStore(config, readText);
    const signer = await store.current();
    expect(signer.keyId).toBe('kid-2026');
    const keys = await store.publicKeys();
    expect([...keys.keys()].sort()).toEqual(['kid-2025', 'kid-2026']);
    expect(verifyLicenseToken(await signLicenseClaims(CLAIMS, signer), keys).valid).toBe(true);
    expect(await store.publicKeyPem()).toContain('BEGIN PUBLIC KEY');
  });

  it('reads the key file once', async () => {
    let reads = 0;
    const store = new EnvironmentLicenseKeyStore(config, (path) => {
      reads += 1;
      return readText(path);
    });
    await store.current();
    await store.current();
    expect(reads).toBe(1);
  });

  it.each([
    ['no key id', { ...config, keyId: undefined }],
    ['an empty key id', { ...config, keyId: '' }],
    ['no key path', { ...config, keyPath: undefined }],
    ['a file that does not exist', { ...config, keyPath: '/keys/missing.pem' }],
    ['a file that is not a key', { ...config, keyPath: '/keys/garbage.pem' }],
    ['a key that is not Ed25519', { ...config, keyPath: '/keys/rsa.pem' }],
  ])('answers 503 SIGNING_KEY_UNAVAILABLE for %s, without the path or the content in the message', async (_label, bad) => {
    const store = new EnvironmentLicenseKeyStore(bad, readText);
    const failure = await store.current().then(
      () => undefined,
      (error: unknown) => error as { code: string; status: number; message: string },
    );
    expect(failure).toMatchObject({ code: 'SIGNING_KEY_UNAVAILABLE', status: 503 });
    expect(JSON.stringify(failure)).not.toContain('/keys');
    expect(failure?.message).not.toContain('PRIVATE');
    await expect(store.publicKeys()).rejects.toMatchObject({ code: 'SIGNING_KEY_UNAVAILABLE' });
    await expect(store.publicKeyPem()).rejects.toMatchObject({ code: 'SIGNING_KEY_UNAVAILABLE' });
  });

  it('serves the current key alone when the retired key is not configured or cannot be read', async () => {
    for (const patch of [{ retiredKeyId: undefined }, { retiredPublicKeyPath: '/keys/missing.pub' }, { retiredPublicKeyPath: '/keys/garbage.pem' }, { retiredKeyId: '' }]) {
      const keys = await new EnvironmentLicenseKeyStore({ ...config, ...patch }, readText).publicKeys();
      expect([...keys.keys()]).toEqual(['kid-2026']);
    }
  });

  it('is built from the environment variables of .env.example', async () => {
    const store = EnvironmentLicenseKeyStore.fromEnvironment(
      { LICENSE_SIGNING_KEY_ID: 'kid-2026', LICENSE_SIGNING_KEY_PEM_PATH: '/keys/current.pem', LICENSE_RETIRED_KEY_ID: 'kid-2025', LICENSE_RETIRED_KEY_PUBLIC_PEM_PATH: '/keys/retired.pub' },
      readText,
    );
    expect((await store.current()).keyId).toBe('kid-2026');
    expect((await store.publicKeys()).has('kid-2025')).toBe(true);
    await expect(EnvironmentLicenseKeyStore.fromEnvironment({}, readText).current()).rejects.toMatchObject({ code: 'SIGNING_KEY_UNAVAILABLE' });
  });
});
