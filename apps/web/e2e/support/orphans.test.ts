import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orphanPids } from './orphans.ts';

const PREFIX = 'machvon-e2e-pg-';
const entry = (pid: number, name: string, commandLine: string) => ({ pid, name, commandLine });

test('lists the database servers of the stack temporary directory and nothing else', () => {
  const processes = [
    entry(1, 'postgres.exe', `"C:/PIS/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe" -D C:/Temp/${PREFIX}abc/data -p 5432`),
    entry(2, 'postgres.exe', '"postgres.exe" -D C:/Temp/machvon-pg-xyz/data -p 5433'),
    entry(3, 'node.exe', `node something ${PREFIX}abc`),
    entry(4, 'postgres', `postgres -D /tmp/${PREFIX}def/data`),
    entry(5, 'postgres.exe', `"postgres.exe" --forkchild="io_worker" ${PREFIX}`),
  ];
  assert.deepEqual(orphanPids(processes, PREFIX), [1, 4, 5]);
});

test('finds nothing when no server names the prefix', () => {
  assert.deepEqual(orphanPids([entry(2, 'postgres.exe', 'postgres.exe -D C:/Temp/other')], PREFIX), []);
  assert.deepEqual(orphanPids([], PREFIX), []);
});
