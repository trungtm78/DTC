interface RawStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

declare const store: RawStore;
declare const redis: RawStore;
declare const kv: RawStore;

export async function readWithoutTenantPrefix(): Promise<string | null> {
  await store.set('session', 'v');
  await redis.set('session', 'v');
  await kv.set('session', 'v');
  return (await store.get('session')) ?? (await redis.get('session')) ?? kv.get('session');
}
