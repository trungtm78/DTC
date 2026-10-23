import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orphanPids } from './orphans.ts';

const PREFIX = 'machvon-e2e-pg-';
const ROOT = 'C:/PIS';
const entry = (pid: number, name: string, commandLine: string) => ({ pid, name, commandLine });
const OWN_BIN = '"C:/PIS/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe"';

test('lists the database servers of this workspace whose directory has the stack prefix, and nothing else', () => {
  const processes = [
    entry(1, 'postgres.exe', `${OWN_BIN} -D C:/Temp/${PREFIX}abc/data -p 5432`),
    entry(2, 'postgres.exe', `${OWN_BIN} -D C:/Temp/machvon-pg-xyz/data -p 5433`),
    entry(3, 'node.exe', `node something ${PREFIX}abc ${ROOT}/x`),
    entry(4, 'postgres', `${ROOT}/node_modules/@embedded-postgres/linux/bin/postgres -D /tmp/${PREFIX}def/data`),
    entry(5, 'postgres.exe', `${OWN_BIN} --forkchild="io_worker" ${PREFIX}`),
  ];
  assert.deepEqual(orphanPids(processes, PREFIX, ROOT), [1, 4, 5]);
});

test('a server that belongs to another checkout is never listed, even with the prefix', () => {
  const other = entry(7, 'postgres.exe', `"C:/OTHER/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe" -D C:/Temp/${PREFIX}abc/data`);
  const lookalike = entry(8, 'postgres.exe', `"C:/PIS-copy/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe" -D C:/Temp/${PREFIX}abc/data`);
  assert.deepEqual(orphanPids([other, lookalike], PREFIX, ROOT), []);
});

test('the workspace path is compared without regard to case and separators', () => {
  const backslashes = entry(9, 'postgres.exe', `"c:\\pis\\node_modules\\@embedded-postgres\\bin\\postgres.exe" -D C:\\Temp\\${PREFIX}abc\\data`);
  assert.deepEqual(orphanPids([backslashes], PREFIX, 'C:\\PIS\\'), [9]);
});

test('finds nothing when no server names the prefix', () => {
  assert.deepEqual(orphanPids([entry(2, 'postgres.exe', `${OWN_BIN} -D C:/Temp/other`)], PREFIX, ROOT), []);
  assert.deepEqual(orphanPids([], PREFIX, ROOT), []);
});
