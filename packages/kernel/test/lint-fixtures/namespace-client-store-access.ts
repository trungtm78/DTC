import type * as Kernel from '../../src/index.ts';

export function read(client: Kernel.KeyValueStore): Promise<string | null> {
  return client.get('session');
}
