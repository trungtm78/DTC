import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSbom, main, runNpm, validateSbom } from './sbom.mjs';

const HASH = { alg: 'SHA-512', content: 'a'.repeat(128) };

const component = (name, extra = {}) => ({
  'bom-ref': `${name}@1.0.0`,
  type: 'library',
  name,
  version: '1.0.0',
  purl: `pkg:npm/${name}@1.0.0`,
  hashes: [HASH],
  ...extra,
});

const WORKSPACE = { 'bom-ref': '@machvon/api@0.0.0', type: 'library', name: 'api', version: '0.0.0', purl: 'pkg:npm/%40machvon/api@0.0.0', properties: [{ name: 'cdx:npm:package:private', value: 'true' }] };

const document = (components = [component('left-pad'), WORKSPACE]) => ({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79',
  version: 1,
  metadata: { timestamp: '2026-10-23T00:00:00.000Z', component: { name: 'machvon' } },
  components,
});

const problems = (doc) => validateSbom(doc).map((problem) => problem.code);

test('a CycloneDX document with purl and hashes on every third-party component is valid; private workspace packages carry no hash', () => {
  assert.deepEqual(validateSbom(document()), []);
});

test('the document must be CycloneDX of a supported spec version with a serial number, a timestamp and components', () => {
  assert.deepEqual(problems({ ...document(), bomFormat: 'SPDX' }), ['SBOM_FORMAT']);
  assert.deepEqual(problems({ ...document(), specVersion: '1.1' }), ['SBOM_SPEC_VERSION']);
  assert.deepEqual(problems({ ...document(), serialNumber: undefined }), ['SBOM_SERIAL']);
  assert.deepEqual(problems({ ...document(), metadata: {} }), ['SBOM_TIMESTAMP']);
  assert.deepEqual(problems(document([])), ['SBOM_EMPTY']);
  assert.deepEqual(problems(null), ['SBOM_FORMAT']);
  assert.deepEqual(problems({ ...document(), components: 'none' }), ['SBOM_EMPTY']);
});

test('a component without a purl, with a purl of another ecosystem or without a hash is reported by name', () => {
  assert.deepEqual(validateSbom(document([component('a', { purl: undefined })])), [{ code: 'SBOM_COMPONENT_PURL', detail: 'a@1.0.0' }]);
  assert.deepEqual(validateSbom(document([component('b', { purl: 'pkg:maven/b@1.0.0' })])), [{ code: 'SBOM_COMPONENT_PURL', detail: 'b@1.0.0' }]);
  assert.deepEqual(validateSbom(document([component('c', { hashes: undefined })])), [{ code: 'SBOM_COMPONENT_HASH', detail: 'c@1.0.0' }]);
  assert.deepEqual(validateSbom(document([component('d', { hashes: [{ alg: 'SHA-512', content: 'short' }] })])), [{ code: 'SBOM_COMPONENT_HASH', detail: 'd@1.0.0' }]);
  assert.deepEqual(validateSbom(document([component('e', { hashes: [{ content: HASH.content }] })])), [{ code: 'SBOM_COMPONENT_HASH', detail: 'e@1.0.0' }]);
});

test('a component without a bom-ref is reported by its name', () => {
  assert.deepEqual(validateSbom(document([component('f', { 'bom-ref': undefined, hashes: undefined })])), [{ code: 'SBOM_COMPONENT_HASH', detail: 'f' }]);
});

function io(responses) {
  const calls = [];
  return {
    calls,
    run: (command, args) => {
      calls.push([command, ...args].join(' '));
      return responses;
    },
  };
}

test('generateSbom asks npm for a CycloneDX document of the lockfile and writes it (AC-ST-KERNEL-013-2)', () => {
  const root = mkdtempSync(join(tmpdir(), 'machvon-sbom-'));
  try {
    const fake = io({ status: 0, stdout: JSON.stringify(document()), stderr: '' });
    const out = join(root, 'dist', 'sbom.cdx.json');
    const result = generateSbom({ root, out, run: fake.run });
    assert.deepEqual(result, { ok: true, components: 2, problems: [] });
    assert.deepEqual(fake.calls, ['npm sbom --sbom-format cyclonedx --package-lock-only']);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).bomFormat, 'CycloneDX');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generateSbom writes nothing when npm fails, prints something else than JSON or produces a document that is not valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'machvon-sbom-'));
  try {
    const out = join(root, 'sbom.cdx.json');
    const failed = generateSbom({ root, out, run: io({ status: 1, stdout: '', stderr: 'ELSPROBLEMS' }).run });
    assert.deepEqual(failed, { ok: false, components: 0, problems: [{ code: 'SBOM_NPM_FAILED', detail: 'ELSPROBLEMS' }] });
    const notJson = generateSbom({ root, out, run: io({ status: 0, stdout: 'not json', stderr: '' }).run });
    assert.deepEqual(notJson.problems.map((problem) => problem.code), ['SBOM_NPM_FAILED']);
    const invalid = generateSbom({ root, out, run: io({ status: 0, stdout: JSON.stringify(document([component('x', { purl: undefined })])), stderr: '' }).run });
    assert.deepEqual(invalid.problems, [{ code: 'SBOM_COMPONENT_PURL', detail: 'x@1.0.0' }]);
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main exits 0 with the component count when the document is written and 1 with the findings otherwise', () => {
  const root = mkdtempSync(join(tmpdir(), 'machvon-sbom-'));
  try {
    const lines = [];
    const good = main(['--root', root, '--out', 'dist/sbom.cdx.json', '--locale', 'en'], { log: (line) => lines.push(line), run: io({ status: 0, stdout: JSON.stringify(document()), stderr: '' }).run });
    assert.equal(good, 0);
    assert.match(lines.join('\n'), /SBOM written .*2 components/);
    assert.equal(existsSync(join(root, 'dist', 'sbom.cdx.json')), true);

    const bad = [];
    const failed = main(['--root', root, '--out', 'other.json', '--locale', 'en'], { log: (line) => bad.push(line), run: io({ status: 1, stdout: '', stderr: 'no lockfile' }).run });
    assert.equal(failed, 1);
    assert.match(bad.join('\n'), /npm could not produce the SBOM: no lockfile/);
    assert.match(bad.join('\n'), /SBOM was not written/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main reports in Vietnamese by default', () => {
  const root = mkdtempSync(join(tmpdir(), 'machvon-sbom-'));
  try {
    const lines = [];
    main(['--root', root], { log: (line) => lines.push(line), run: io({ status: 0, stdout: JSON.stringify(document()), stderr: '' }).run });
    assert.match(lines.join('\n'), /SBOM/);
    assert.doesNotMatch(lines.join('\n'), /written/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runNpm runs other commands directly and npm through the CLI script that started the process', () => {
  const root = mkdtempSync(join(tmpdir(), 'machvon-sbom-'));
  const previous = process.env.npm_execpath;
  try {
    const cli = join(root, 'fake-npm-cli.js');
    writeFileSync(cli, 'process.stdout.write(process.argv.slice(2).join(" "));');
    assert.equal(runNpm('node', [cli, 'direct', 'call']).stdout, 'direct call');
    process.env.npm_execpath = cli;
    assert.equal(runNpm('npm', ['sbom', '--x']).stdout, 'sbom --x');
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
