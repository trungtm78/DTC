import type { KeyValueStore } from '../../src/index.ts';

export function read(client: KeyValueStore): Promise<string | null> {
  return client.get('session');
}
