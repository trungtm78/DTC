import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listOperations } from './checks/openapi.mjs';
import { resolve } from 'node:path';

// What a module group must cover in the implementation plan: the screens, operations, tables and
// tests its staging fragment owns. Authors use it to see their scope and self-check coverage.

export function inventoryFromFragment(fragment) {
  const seen = new Set();
  const screens = (fragment.screens ?? [])
    .filter((screen) => !seen.has(screen.id) && seen.add(screen.id))
    .map(({ id, title, platform, phase, module }) => ({ id, title, platform, phase, module }));
  const operations = listOperations(fragment.openapi ?? { paths: {} }).map(({ path, method, operation }) => ({
    id: operation.operationId,
    method: method.toUpperCase(),
    path,
    permission: operation['x-permission'] ?? operation['x-required-role'] ?? null,
    exposure: operation['x-exposure'] ?? null,
  }));
  const tables = Object.keys(fragment.entities ?? {});
  const tests = (fragment.tests ?? []).map((test) => test.id);
  return {
    module: fragment.module,
    screens,
    operations,
    tables,
    tests,
    counts: { screens: screens.length, operations: operations.length, tables: tables.length, tests: tests.length },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [path] = process.argv.slice(2);
  console.log(JSON.stringify(inventoryFromFragment(JSON.parse(readFileSync(path, 'utf8'))), null, 1));
}
