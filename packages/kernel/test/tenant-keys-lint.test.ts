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

  it('fails on a differently named client typed as KeyValueStore (type-level boundary)', () => {
    const messages = run('file', path.join(FIXTURES, 'client-store-access.ts'));

    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-imports']);
    expect(messages[0]?.message).toContain('TenantCache');
  });

  it('fails on KeyValueStore imported from the package or through an inline import type', () => {
    const messages = run('file', path.join(FIXTURES, 'package-client-store-access.ts')).filter((m) =>
      ['no-restricted-imports', 'no-restricted-syntax'].includes(m.ruleId ?? ''),
    );

    expect(messages.map((m) => m.ruleId).sort()).toEqual(['no-restricted-imports', 'no-restricted-syntax']);
  });

  it('allows KeyValueStore in the adapters folder, tenant-keys.ts, index.ts and tests only', () => {
    const code = "import type { KeyValueStore } from './tenant-keys.ts';\nexport type Alias = KeyValueStore;\n";
    const src = (file: string): string => path.join(REPO_ROOT, 'packages/kernel', file);

    expect(run('text', src('src/adapters/redis.ts'), code)).toEqual([]);
    expect(run('text', src('src/index.ts'), code)).toEqual([]);
    expect(run('text', src('src/tenant-keys.ts'), code)).toEqual([]);
    expect(run('text', src('test/memory-store.test.ts'), code)).toEqual([]);
    expect(run('text', src('src/other.ts'), code).map((m) => m.ruleId)).toEqual(['no-restricted-imports']);
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
