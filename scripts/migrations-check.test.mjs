import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMigrations, main } from './migrations-check.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKS = {
  platform: { from: 3, to: 99, retired: [5] },
  slices: [
    { slice: 'MDM-1', from: 1000, to: 1019 },
    { slice: 'ISS-1', from: 1020, to: 1039 },
  ],
};

function layout(files, blocks = BLOCKS) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-migrations-'));
  const directory = join(root, 'db', 'migrations');
  mkdirSync(directory, { recursive: true });
  const all = ['V001__roles_and_grants.sql', 'V002__schema.sql', ...files];
  for (const name of all) writeFileSync(join(directory, name), '-- sql\n');
  if (blocks !== null) writeFileSync(join(directory, 'blocks.json'), JSON.stringify(blocks));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const codes = (findings) => findings.map((finding) => finding.code).sort();

test('a tree with platform migrations and slice migrations inside their blocks is clean', () => {
  const { root, cleanup } = layout(['V003__platform_services.sql', 'V004__authorization_core.sql', 'V006__other.sql', 'V1000__mdm1_units.sql', 'V1001__mdm1_codes.sql', 'V1020__iss1_issues.sql']);
  try {
    assert.deepEqual(checkMigrations(root), []);
  } finally {
    cleanup();
  }
});

test('the two generated migrations must be exactly V001 and V002 under their generated names', () => {
  const { root, cleanup } = layout(['V003__x.sql']);
  try {
    rmSync(join(root, 'db', 'migrations', 'V002__schema.sql'));
    writeFileSync(join(root, 'db', 'migrations', 'V002__other_schema.sql'), '-- sql\n');
    // The renamed file is missing as V002__schema.sql and, being no generated name, lies outside every block.
    assert.deepEqual(codes(checkMigrations(root)), ['GENERATED_NAME', 'OUTSIDE_BLOCKS']);
  } finally {
    cleanup();
  }
});

test('a file name that does not follow V<number>__<name>.sql is reported', () => {
  const { root, cleanup } = layout(['V3_bad.sql', 'v004__lower.sql', 'V005__Upper_Case.sql']);
  try {
    assert.deepEqual(codes(checkMigrations(root)), ['BAD_NAME', 'BAD_NAME', 'BAD_NAME']);
  } finally {
    cleanup();
  }
});

test('the same version twice is reported, also when the padding differs', () => {
  const { root, cleanup } = layout(['V003__a.sql', 'V003__b.sql', 'V0004__c.sql', 'V004__d.sql']);
  try {
    const findings = checkMigrations(root).filter((finding) => finding.code === 'DUPLICATE_VERSION');
    assert.equal(findings.length >= 2, true);
  } finally {
    cleanup();
  }
});

test('a platform gap is reported unless the number is retired, and platform numbers keep three digits', () => {
  const { root, cleanup } = layout(['V003__a.sql', 'V007__b.sql']);
  try {
    // 4 is missing and not retired; 5 is retired; 6 is missing and not retired.
    assert.deepEqual(codes(checkMigrations(root)), ['GAP', 'GAP']);
  } finally {
    cleanup();
  }
  const padded = layout(['V03__a.sql']);
  try {
    assert.equal(codes(checkMigrations(padded.root)).includes('PADDING'), true);
  } finally {
    padded.cleanup();
  }
});

test('a number outside every block is reported, and a number in another slice block names its owner', () => {
  const { root, cleanup } = layout(['V100__nobody.sql', 'V1020__mdm1_wrong_block.sql']);
  try {
    const findings = checkMigrations(root);
    assert.equal(findings.some((finding) => finding.code === 'OUTSIDE_BLOCKS' && finding.file === 'V100__nobody.sql'), true);
    assert.equal(findings.some((finding) => finding.code === 'WRONG_OWNER' && finding.file === 'V1020__mdm1_wrong_block.sql'), true);
  } finally {
    cleanup();
  }
});

test('a slice migration must carry its slice key in the name, and a gap inside a slice block is reported', () => {
  const { root, cleanup } = layout(['V1000__units.sql', 'V1002__mdm1_third.sql']);
  try {
    const found = codes(checkMigrations(root));
    assert.equal(found.includes('WRONG_OWNER'), true);
    assert.equal(found.includes('GAP'), true);
  } finally {
    cleanup();
  }
});

test('blocks that overlap, are not twenty numbers wide or collide with the platform block are reported', () => {
  const blocks = {
    platform: { from: 3, to: 99, retired: [] },
    slices: [
      { slice: 'MDM-1', from: 1000, to: 1019 },
      { slice: 'ISS-1', from: 1010, to: 1029 },
      { slice: 'DIS-1', from: 2000, to: 2005 },
      { slice: 'PRJ-1', from: 50, to: 69 },
    ],
  };
  const { root, cleanup } = layout([], blocks);
  try {
    const found = codes(checkMigrations(root));
    assert.equal(found.filter((code) => code === 'BLOCK_OVERLAP').length >= 2, true);
    assert.equal(found.includes('BLOCK_SIZE'), true);
  } finally {
    cleanup();
  }
});

test('a missing or malformed blocks.json is reported', () => {
  const missing = layout([], null);
  try {
    assert.deepEqual(codes(checkMigrations(missing.root)), ['BLOCKS_FILE']);
  } finally {
    missing.cleanup();
  }
  const broken = layout([], { platform: 3 });
  try {
    assert.deepEqual(codes(checkMigrations(broken.root)), ['BLOCKS_FILE']);
  } finally {
    broken.cleanup();
  }
});

test('main prints every finding and exits 1, or exits 0 for a clean tree', () => {
  const bad = layout(['V3_bad.sql']);
  const good = layout(['V003__ok.sql']);
  try {
    const lines = [];
    assert.equal(main(['--root', bad.root, '--locale', 'en'], { log: (line) => lines.push(line) }), 1);
    assert.equal(lines.some((line) => line.includes('V3_bad.sql')), true);
    assert.equal(main(['--root', good.root, '--locale', 'en'], { log: () => undefined }), 0);
  } finally {
    bad.cleanup();
    good.cleanup();
  }
});

test('the real repository migrations follow the blocks', () => {
  assert.deepEqual(checkMigrations(REPO_ROOT), []);
});

test('an extra file at version 1 or 2 and a version 0 file are reported: only the two exact generated names are exempt', () => {
  const { root, cleanup } = layout(['V001__extra.sql', 'V002__more.sql', 'V000__unexpected.sql', 'V003__platform.sql']);
  try {
    const found = checkMigrations(root).filter((finding) => finding.code === 'OUTSIDE_BLOCKS').map((finding) => finding.file).sort();
    assert.deepEqual(found, ['V000__unexpected.sql', 'V001__extra.sql', 'V002__more.sql']);
  } finally {
    cleanup();
  }
});

test('a number a slice retired is not a gap in that slice, and an unretired hole still is', () => {
  const blocks = {
    platform: { from: 3, to: 99, retired: [] },
    slices: [
      { slice: 'MDM-1', from: 1000, to: 1019, retired: [1001] },
      { slice: 'ISS-1', from: 1020, to: 1039 },
    ],
  };
  const { root, cleanup } = layout(['V1000__mdm1_a.sql', 'V1002__mdm1_b.sql', 'V1020__iss1_a.sql', 'V1022__iss1_b.sql'], blocks);
  try {
    const gaps = checkMigrations(root).filter((finding) => finding.code === 'GAP').map((finding) => finding.detail);
    assert.deepEqual(gaps, ['V1021']);
  } finally {
    cleanup();
  }
});

test('a slice block whose retired list is not a list of numbers is a malformed blocks file', () => {
  const { root, cleanup } = layout([], { platform: { from: 3, to: 99 }, slices: [{ slice: 'MDM-1', from: 1000, to: 1019, retired: ['x'] }] });
  try {
    assert.deepEqual(codes(checkMigrations(root)), ['BLOCKS_FILE']);
  } finally {
    cleanup();
  }
});
