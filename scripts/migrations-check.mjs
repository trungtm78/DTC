import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCALE = 'vi';
const MIGRATIONS_DIR = join('db', 'migrations');
const BLOCKS_FILE = 'blocks.json';
const SLICE_BLOCK_SIZE = 20;
const PLATFORM_DIGITS = 3;
const NAME_PATTERN = /^V(\d+)__([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
/** The generator owns these two files (packages/db generate-migrations.ts); they must keep exactly these names. */
const GENERATED = ['V001__roles_and_grants.sql', 'V002__schema.sql'];

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const isInteger = (value) => Number.isInteger(value) && value >= 0;

/** The key a slice migration carries in its name: `MDM-1` gives `mdm1`. */
export function sliceKeyOf(slice) {
  return slice.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readBlocks(directory) {
  const path = join(directory, BLOCKS_FILE);
  if (!existsSync(path)) return { error: 'missing' };
  let blocks;
  try {
    blocks = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { error: 'not JSON' };
  }
  const { platform, slices } = blocks ?? {};
  const retired = platform?.retired ?? [];
  const platformOk = platform !== undefined && isInteger(platform.from) && isInteger(platform.to) && platform.from <= platform.to && Array.isArray(retired) && retired.every(isInteger);
  const slicesOk =
    Array.isArray(slices) &&
    slices.every(
      (entry) =>
        typeof entry?.slice === 'string' &&
        isInteger(entry.from) &&
        isInteger(entry.to) &&
        entry.from <= entry.to &&
        (entry.retired === undefined || (Array.isArray(entry.retired) && entry.retired.every(isInteger))),
    ) &&
    new Set(slices.map((entry) => entry.slice)).size === slices.length;
  if (!platformOk || !slicesOk) return { error: 'shape' };
  return {
    platform: { from: platform.from, to: platform.to, retired: new Set(retired) },
    slices: slices.map((entry) => ({ ...entry, retired: new Set(entry.retired ?? []) })),
  };
}

function blockFindings(blocks) {
  const findings = [];
  const ranges = [{ name: 'platform', from: blocks.platform.from, to: blocks.platform.to }, ...blocks.slices.map((entry) => ({ name: entry.slice, from: entry.from, to: entry.to }))];
  for (const entry of blocks.slices) {
    if (entry.to - entry.from + 1 !== SLICE_BLOCK_SIZE) findings.push({ code: 'BLOCK_SIZE', detail: entry.slice });
  }
  for (let first = 0; first < ranges.length; first += 1) {
    for (let second = first + 1; second < ranges.length; second += 1) {
      const a = ranges[first];
      const b = ranges[second];
      if (a.from <= b.to && b.from <= a.to) findings.push({ code: 'BLOCK_OVERLAP', detail: `${a.name} / ${b.name}` });
    }
  }
  return findings;
}

function ownerOf(version, blocks) {
  if (version >= blocks.platform.from && version <= blocks.platform.to) return { kind: 'platform' };
  const slice = blocks.slices.find((entry) => version >= entry.from && version <= entry.to);
  return slice === undefined ? undefined : { kind: 'slice', slice };
}

/**
 * Checks db/migrations: names, duplicates, number padding, gaps, and that every number lies in the block of one owner
 * (the platform block V003 to V099, or the reserved block of a slice) with the owner's key in the file name. V001 and
 * V002 stay generated. Returns findings; an empty list is a clean tree.
 */
export function checkMigrations(root = REPO_ROOT) {
  const directory = join(root, MIGRATIONS_DIR);
  const loaded = readBlocks(directory);
  if (loaded.error !== undefined) return [{ code: 'BLOCKS_FILE', detail: loaded.error }];
  const blocks = loaded;
  const findings = blockFindings(blocks);

  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  for (const name of GENERATED) {
    if (!files.includes(name)) findings.push({ code: 'GENERATED_NAME', file: name });
  }

  const parsed = [];
  for (const file of files) {
    const match = NAME_PATTERN.exec(file);
    if (match === null) {
      findings.push({ code: 'BAD_NAME', file });
      continue;
    }
    // Only the two generated files are exempt: any other low number (V000, V001__extra) is outside every block.
    if (GENERATED.includes(file)) continue;
    const version = Number(match[1]);
    parsed.push({ file, digits: match[1], version, name: match[2] });
  }

  const byVersion = new Map();
  for (const entry of parsed) byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry]);
  for (const entries of byVersion.values()) {
    for (const extra of entries.slice(1)) findings.push({ code: 'DUPLICATE_VERSION', file: extra.file, detail: String(extra.version) });
  }

  const usedBySlice = new Map();
  let highestPlatform = 0;
  for (const entry of parsed) {
    const owner = ownerOf(entry.version, blocks);
    if (owner === undefined) {
      findings.push({ code: 'OUTSIDE_BLOCKS', file: entry.file });
      continue;
    }
    if (owner.kind === 'platform') {
      highestPlatform = Math.max(highestPlatform, entry.version);
      if (entry.digits.length !== PLATFORM_DIGITS) findings.push({ code: 'PADDING', file: entry.file });
      continue;
    }
    if (entry.digits.length !== String(entry.version).length) findings.push({ code: 'PADDING', file: entry.file });
    if (!entry.name.startsWith(`${sliceKeyOf(owner.slice.slice)}_`)) {
      findings.push({ code: 'WRONG_OWNER', file: entry.file, detail: owner.slice.slice });
    }
    usedBySlice.set(owner.slice.slice, Math.max(usedBySlice.get(owner.slice.slice) ?? 0, entry.version));
  }

  for (let version = blocks.platform.from; version <= highestPlatform; version += 1) {
    if (!byVersion.has(version) && !blocks.platform.retired.has(version)) findings.push({ code: 'GAP', detail: `V${String(version).padStart(PLATFORM_DIGITS, '0')}` });
  }
  for (const entry of blocks.slices) {
    const highest = usedBySlice.get(entry.slice);
    if (highest === undefined) continue;
    for (let version = entry.from; version <= highest; version += 1) {
      if (!byVersion.has(version) && !entry.retired.has(version)) findings.push({ code: 'GAP', detail: `V${version}` });
    }
  }
  return findings;
}

export function main(argv, { log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: { root: { type: 'string', default: REPO_ROOT }, locale: { type: 'string', default: DEFAULT_LOCALE } },
  });
  const messages = loadMessages(values.locale);
  const findings = checkMigrations(resolve(values.root));
  for (const finding of findings) {
    log(
      format(messages['migrations.finding'], {
        file: finding.file ?? '-',
        message: format(messages[`migrations.code.${finding.code}`], { detail: finding.detail ?? '' }),
      }),
    );
  }
  log(findings.length === 0 ? messages['migrations.summary.pass'] : format(messages['migrations.summary.fail'], { count: findings.length }));
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
