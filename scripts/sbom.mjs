import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCALE = 'vi';
export const DEFAULT_SBOM_PATH = join('dist', 'sbom.cdx.json');
const SPEC_VERSIONS = new Set(['1.4', '1.5', '1.6']);
const NPM_PURL = /^pkg:npm\//;
/** The shortest digest in use (SHA-256) is 64 hexadecimal characters. */
const MIN_HASH_LENGTH = 64;
const PRIVATE_PROPERTY = 'cdx:npm:package:private';
const NPM_ARGS = ['sbom', '--sbom-format', 'cyclonedx', '--package-lock-only'];

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const hasHash = (component) =>
  Array.isArray(component.hashes) && component.hashes.some((hash) => typeof hash?.alg === 'string' && typeof hash.content === 'string' && hash.content.length >= MIN_HASH_LENGTH);

/** Workspace packages are private and are not downloaded, so npm gives them no integrity hash. */
const isPrivate = (component) => Array.isArray(component.properties) && component.properties.some((property) => property.name === PRIVATE_PROPERTY && property.value === 'true');

/**
 * The shape of the CycloneDX document that the supply chain gate relies on: the format and spec version, a serial
 * number and timestamp, and for every component a package URL of the npm ecosystem and, for each third-party component,
 * at least one hash. Returns the problems found, empty for a valid document.
 */
export function validateSbom(document) {
  if (document === null || typeof document !== 'object' || document.bomFormat !== 'CycloneDX') return [{ code: 'SBOM_FORMAT' }];
  const problems = [];
  if (!SPEC_VERSIONS.has(document.specVersion)) problems.push({ code: 'SBOM_SPEC_VERSION' });
  if (typeof document.serialNumber !== 'string' || document.serialNumber === '') problems.push({ code: 'SBOM_SERIAL' });
  if (typeof document.metadata?.timestamp !== 'string') problems.push({ code: 'SBOM_TIMESTAMP' });
  if (!Array.isArray(document.components) || document.components.length === 0) return [...problems, { code: 'SBOM_EMPTY' }];
  for (const component of document.components) {
    const label = component['bom-ref'] ?? component.name;
    if (typeof component.purl !== 'string' || !NPM_PURL.test(component.purl)) problems.push({ code: 'SBOM_COMPONENT_PURL', detail: label });
    if (!isPrivate(component) && !hasHash(component)) problems.push({ code: 'SBOM_COMPONENT_HASH', detail: label });
  }
  return problems;
}

const SPAWN_OPTIONS = { encoding: 'utf8', maxBuffer: 1 << 28 };

/**
 * Runs a command; `npm` goes through the npm CLI script that started this process (`npm run` sets npm_execpath), so no
 * shell is needed on Windows. Run directly with node, it falls back to the shell.
 */
export function runNpm(command, args, options = {}) {
  const cli = process.env.npm_execpath;
  if (command === 'npm' && typeof cli === 'string' && cli.endsWith('.js')) return spawnSync(process.execPath, [cli, ...args], { ...SPAWN_OPTIONS, ...options });
  return spawnSync(command, args, { ...SPAWN_OPTIONS, shell: process.platform === 'win32' && command === 'npm', ...options });
}

/** Writes the CycloneDX SBOM that `npm sbom` derives from the lockfile; writes nothing unless the document is valid. */
export function generateSbom({ root, out, run = runNpm }) {
  const result = run('npm', NPM_ARGS, { cwd: root });
  if (result.status !== 0) return { ok: false, components: 0, problems: [{ code: 'SBOM_NPM_FAILED', detail: String(result.stderr).trim() }] };
  let document;
  try {
    document = JSON.parse(result.stdout);
  } catch {
    return { ok: false, components: 0, problems: [{ code: 'SBOM_NPM_FAILED', detail: 'the output is not JSON' }] };
  }
  const problems = validateSbom(document);
  if (problems.length > 0) return { ok: false, components: 0, problems };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  return { ok: true, components: document.components.length, problems: [] };
}

export function main(argv, { log = console.log, run = runNpm } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', default: REPO_ROOT },
      out: { type: 'string', default: DEFAULT_SBOM_PATH },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const root = resolve(values.root);
  const out = resolve(root, values.out);
  const result = generateSbom({ root, out, run });
  for (const problem of result.problems) log(format(messages[`sbom.code.${problem.code}`], { detail: problem.detail ?? '' }));
  log(result.ok ? format(messages['sbom.summary.pass'], { path: values.out, count: result.components }) : messages['sbom.summary.fail']);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
