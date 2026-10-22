import type { KeyValueStore } from '../../src/tenant-keys.ts';

export function read(client: KeyValueStore): Promise<string | null> {
  return client.get('session');
}
