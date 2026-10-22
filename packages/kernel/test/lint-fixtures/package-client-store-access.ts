import type { KeyValueStore } from '@machvon/kernel';

export function read(client: KeyValueStore): Promise<string | null> {
  return client.get('session');
}

export function inline(client: import('../../src/tenant-keys.ts').KeyValueStore): Promise<void> {
  return client.set('session', 'v');
}
