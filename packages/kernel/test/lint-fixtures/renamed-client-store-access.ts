import type { KeyValueStore as Kv } from '../../src/index.ts';

export function read(client: Kv): Promise<string | null> {
  return client.get('session');
}
