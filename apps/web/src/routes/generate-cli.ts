import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRoutes, renderRoutesData } from './generate.ts';
import type { NavigationArchitecture, ScreenCatalogue } from './generate.ts';

export interface Io {
  log: (line: string) => void;
}

const USAGE = 'Usage: generate-routes.mjs <generate|check> [--root <repository root>]';
const ENGINEERING_DIR = join('Design', 'MACHVON_Design', '03_Engineering');
const OUTPUT_PATH = join('apps', 'web', 'src', 'routes', 'routes.generated.json');
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const stdoutIo: Io = { log: (line) => process.stdout.write(`${line}\n`) };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const normaliseEol = (text: string): string => text.replace(/\r\n/g, '\n');

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function generated(root: string): Promise<string> {
  const architecture = await readJson<NavigationArchitecture>(join(root, ENGINEERING_DIR, 'navigation_architecture.json'));
  const catalogue = await readJson<ScreenCatalogue>(join(root, ENGINEERING_DIR, 'screen_catalog.json'));
  return renderRoutesData(buildRoutes(architecture, catalogue));
}

async function committed(path: string): Promise<string | undefined> {
  try {
    return normaliseEol(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Exit codes: 0 ok, 1 the committed table is stale or the design files are inconsistent, 2 usage error. */
export async function main(argv: string[], io: Io = stdoutIo): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { root: { type: 'string', default: DEFAULT_ROOT } }, allowPositionals: true });
  const root = resolve(values.root);
  const output = join(root, OUTPUT_PATH);
  const command = positionals[0];
  if (command !== 'generate' && command !== 'check') {
    io.log(USAGE);
    return 2;
  }
  try {
    const text = await generated(root);
    if (command === 'generate') {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, text);
      io.log(`Wrote ${OUTPUT_PATH.split('\\').join('/')}`);
      return 0;
    }
    if ((await committed(output)) !== text) {
      io.log('The route table is out of date. Run `npm run routes:generate -w @machvon/web`.');
      return 1;
    }
    return 0;
  } catch (error) {
    io.log(messageOf(error));
    return 1;
  }
}
