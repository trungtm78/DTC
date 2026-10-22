import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkModuleSpecs, REQUIRED_SECTIONS } from '../src/checks/module-specs.mjs';
import { loadModuleSpecs } from '../src/model.mjs';
import { validModel, codes } from './fixtures.mjs';

function specWith(sectionNumbers) {
  return sectionNumbers.map((n) => `## ${n}. Section ${n}\nContent for section ${n}.`).join('\n\n');
}

const ALL_SECTIONS = Array.from({ length: REQUIRED_SECTIONS }, (_, i) => i + 1);

test('every catalogued module needs a spec with all template sections', () => {
  const model = validModel();
  model.moduleSpecs = { IAM: specWith(ALL_SECTIONS), DIS: specWith(ALL_SECTIONS) };
  assert.deepEqual(checkModuleSpecs(model), []);
});

test('a missing spec file is reported per module', () => {
  const model = validModel();
  model.moduleSpecs = { IAM: specWith(ALL_SECTIONS) };
  assert.deepEqual(codes(checkModuleSpecs(model)), ['MODULE_SPEC_MISSING']);
});

test('missing or empty template sections are reported', () => {
  const model = validModel();
  const withoutTen = ALL_SECTIONS.filter((n) => n !== 10);
  model.moduleSpecs = {
    IAM: specWith(withoutTen),
    DIS: `${specWith(ALL_SECTIONS.filter((n) => n !== 4))}\n\n## 4. State machine\n`,
  };
  const findings = checkModuleSpecs(model);
  assert.deepEqual(codes(findings), ['MODULE_SPEC_SECTION_EMPTY', 'MODULE_SPEC_SECTION_MISSING']);
  assert.deepEqual(findings.find((f) => f.code === 'MODULE_SPEC_SECTION_MISSING').params, { module: 'IAM', section: 10 });
});

test('the check is skipped when spec files were not loaded', () => {
  assert.deepEqual(checkModuleSpecs(validModel()), []);
});

test('loadModuleSpecs reads module files keyed by code and ignores template files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-specs-'));
  writeFileSync(join(dir, 'IAM.md'), '## 1. A\nx');
  writeFileSync(join(dir, '_KHUNG_DAC_TA.md'), 'template');
  writeFileSync(join(dir, 'notes.txt'), 'ignored');
  assert.deepEqual(loadModuleSpecs(dir), { IAM: '## 1. A\nx' });
});

test('loadModuleSpecs returns undefined when the directory does not exist', () => {
  assert.equal(loadModuleSpecs(join(tmpdir(), 'machvon-no-such-dir')), undefined);
});
