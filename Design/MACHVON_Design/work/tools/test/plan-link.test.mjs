import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkBacklog } from '../src/plan-link.mjs';
import { linkMain } from '../src/plan-link-cli.mjs';

const stories = [
  { id: 'ST-A-2', release: 'R2', screens: ['S-1', 'S-2'] },
  { id: 'ST-A-1', release: 'R0', screens: ['S-1'] },
  { id: 'ST-B-1', release: 'R1', screens: ['S-3'] },
];

test('each backlog row gets the earliest release and the ordered ids of the stories covering its screen', () => {
  const rows = [{ id: 'BL-1', screen: 'S-1' }, { id: 'BL-2', screen: 'S-2' }, { id: 'BL-3', screen: 'S-3', note: 'kept' }, { id: 'BL-4', screen: 'S-9' }];
  const linked = linkBacklog(rows, stories);
  assert.deepEqual(linked.rows.map((r) => [r.id, r.release, r.stories]), [
    ['BL-1', 'R0', ['ST-A-1', 'ST-A-2']],
    ['BL-2', 'R2', ['ST-A-2']],
    ['BL-3', 'R1', ['ST-B-1']],
    ['BL-4', null, []],
  ]);
  assert.equal(linked.rows[2].note, 'kept');
  assert.deepEqual(linked.unplanned, ['BL-4']);
});

test('linking twice gives the same result', () => {
  const rows = [{ id: 'BL-1', screen: 'S-1' }];
  const once = linkBacklog(rows, stories).rows;
  assert.deepEqual(linkBacklog(once, stories).rows, once);
});

test('the CLI rewrites the backlog and fails when a row has no story', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-link-'));
  writeFileSync(join(dir, 'implementation_backlog.json'), JSON.stringify([{ id: 'BL-1', screen: 'S-1' }]));
  writeFileSync(join(dir, 'implementation_plan.json'), JSON.stringify({ epics: [], features: [], stories }));
  const log = [];
  assert.equal(linkMain(['--dir', dir, '--locale', 'en'], (l) => log.push(l)), 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'implementation_backlog.json'), 'utf8'))[0].release, 'R0');

  writeFileSync(join(dir, 'implementation_backlog.json'), JSON.stringify([{ id: 'BL-9', screen: 'S-404' }]));
  assert.equal(linkMain(['--dir', dir, '--locale', 'en'], (l) => log.push(l)), 1);
  assert.ok(log.some((line) => /BL-9/.test(line)));
  assert.ok(mkdirSync);
});
