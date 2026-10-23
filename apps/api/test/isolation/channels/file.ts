import { DomainError, objectKey, parseObjectKey } from '@machvon/kernel';
import type { ObjectStoragePort, PresignedGrant } from '@machvon/kernel';
import type { FileService } from '../../../src/modules/files/file.service';
import { TENANT_IDS, UNIT_FIXTURES } from '../suite';
import type { ForeignAttempt, IsolationChannel, TenantName } from '../suite';
import { contextOf } from './database';

const KIND = 'document';

/**
 * A key of the user's own prefix that climbs out of it and back down into the prefix of the foreign object. Normalised, it
 * names `foreignKey` itself, so a storage that resolves the climb would really reach the foreign file.
 */
export function climbingKeyTo(foreignKey: string, ownTenant: string): string {
  const foreign = parseObjectKey(foreignKey);
  if (foreign === undefined) throw new Error(`not an object key: ${foreignKey}`);
  return `tenants/${ownTenant}/${foreign.kind}/../../${foreign.tenantId}/${foreign.kind}/${foreign.id}`;
}

async function answer(work: Promise<{ bytes: Uint8Array } | unknown>): Promise<{ status: number; body: string }> {
  try {
    const result = await work;
    const bytes = (result as { bytes?: Uint8Array }).bytes;
    return { status: 200, body: bytes === undefined ? JSON.stringify(result) : Buffer.from(bytes).toString('utf8') };
  } catch (error) {
    if (error instanceof DomainError) return { status: error.status, body: JSON.stringify({ code: error.code }) };
    throw error;
  }
}

/**
 * The shared upload pipeline as a way to read another tenant's data: each tenant uploads one text file per unit (the file
 * holds the name and code of the unit). A TNT-A user that asks for the key of a TNT-B file, by download, link, scan or a
 * key that climbs into the TNT-B prefix, must get 404, and a forged link 401; a listing holds the user's own files only.
 */
export function createFileChannel(options: { service: FileService; storage: ObjectStoragePort }): IsolationChannel {
  const keys: Record<TenantName, string[]> = { 'TNT-A': [], 'TNT-B': [] };
  const { service, storage } = options;
  return {
    name: 'file',
    async seed(tenant) {
      if (keys[tenant].length > 0) return;
      for (const unit of UNIT_FIXTURES[tenant]) {
        const bytes = Uint8Array.from(Buffer.from(`${unit.name} (${unit.code})`, 'utf8'));
        const uploaded = await service.upload(contextOf(tenant), { purpose: KIND, declaredType: 'text/plain', bytes });
        keys[tenant].push(uploaded.key);
      }
    },
    readAs(user, target) {
      return answer(service.download(contextOf(user), keys[target][0] ?? ''));
    },
    async listAs(user) {
      const ctx = contextOf(user);
      const texts: string[] = [];
      for (const object of await storage.list(ctx, KIND)) {
        const stored = await service.download(ctx, object.key);
        texts.push(Buffer.from(stored.bytes).toString('utf8'));
      }
      return { status: 200, body: JSON.stringify(texts) };
    },
    async foreignAttempts(user): Promise<ForeignAttempt[]> {
      const ctx = contextOf(user);
      const foreignKey = keys['TNT-B'][0] ?? '';
      const ownTenant = TENANT_IDS[user];
      const climbing = climbingKeyTo(foreignKey, ownTenant);
      const forgedLink: PresignedGrant = { method: 'GET', key: foreignKey, expires: Math.floor(Date.now() / 1000) + 300, signature: 'ab'.repeat(32) };
      return [
        { operation: 'file:open', ...(await answer(service.open(ctx, foreignKey))) },
        { operation: 'file:presign', ...(await answer(service.presignDownload(ctx, foreignKey))) },
        { operation: 'file:scan', ...(await answer(service.scan(ctx, foreignKey))) },
        { operation: 'file:climbing-key', ...(await answer(service.download(ctx, climbing))) },
        { operation: 'file:other-kind', ...(await answer(service.download(ctx, objectKey(ownTenant, 'logo', 'x')))) },
        { operation: 'file:forged-link', ...(await answer(service.redeemDownload(forgedLink))), expectedStatuses: [401] },
      ];
    },
  };
}
