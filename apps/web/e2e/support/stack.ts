import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import fixtures from './e2e-fixtures.json' with { type: 'json' };
import { STACK_INFO_PATH } from './stack-paths.ts';

/** What the API stack writes about itself once it is ready (apps/api/test/e2e-stack/serve.stack.ts). */
export interface StackInfo {
  apiPort: number;
  /** A superuser connection: the tests use it to look at rows the screens changed (it bypasses row-level security). */
  adminUrl: string;
  tenants: { A: string; B: string };
  units: Record<'A' | 'B', Record<string, string>>;
}

export function stackInfo(): StackInfo {
  return JSON.parse(readFileSync(STACK_INFO_PATH, 'utf8')) as StackInfo;
}

export const RECIPIENT_MEMBERSHIP = fixtures.recipientMembershipId;

/** The membership of a fixture user by key (`owner`, `unitAdmin`, `auditor`, `nobody`). */
export function membershipOf(key: string): string {
  const user = fixtures.users.find((candidate) => candidate.key === key);
  if (user === undefined) throw new Error(`fixture user ${key} is missing`);
  return user.membershipId;
}

/** Reads rows straight from the database the API writes to. */
export async function sql<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: stackInfo().adminUrl });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}
