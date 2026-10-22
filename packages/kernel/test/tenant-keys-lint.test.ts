import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface LintMessage {
  ruleId: string | null;
  message: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(__dirname, 'lint-fixtures');
const HELPER = path.join(__dirname, 'support', 'run-eslint.mjs');

function run(mode: 'file' | 'text', target: string, input?: string): LintMessage[] {
  const output = execFileSync(process.execPath, [HELPER, REPO_ROOT, mode, target], {
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  const results = JSON.parse(output) as LintMessage[][];
  const first = results[0];
  if (first === undefined) throw new Error('ESLint returned no result');
  return first;
}

describe('tenant key lint rule', () => {
  it('fails on raw .get/.set through store, redis and kv receivers', () => {
    const messages = run('file', path.join(FIXTURES, 'raw-store-access.ts')).filter((m) => m.ruleId === 'no-restricted-syntax');

    expect(messages).toHaveLength(6);
    expect(messages[0]?.message).toContain('tenant-keys');
  });

  it('passes on access through TenantCache', () => {
    expect(run('file', path.join(FIXTURES, 'prefixed-store-access.ts'))).toEqual([]);
  });

  it('flags this.store receivers outside tenant-keys.ts but not inside it', () => {
    const code =
      'export class X { store: { get(k: string): unknown } = { get: () => 1 }; run() { return this.store.get("k"); } }\n';

    const outside = run('text', path.join(REPO_ROOT, 'packages/kernel/src/other.ts'), code);
    const inside = run('text', path.join(REPO_ROOT, 'packages/kernel/src/tenant-keys.ts'), code);

    expect(outside.map((m) => m.ruleId)).toEqual(['no-restricted-syntax']);
    expect(inside).toEqual([]);
  });
});
