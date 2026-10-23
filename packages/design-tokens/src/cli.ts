import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CSS_OUTPUT_PATH, DESIGN_TOKENS_PATH, TS_OUTPUT_PATH, generateTokens } from './generate.ts';
import type { DesignTokens } from './types.ts';

export interface Io {
  log: (line: string) => void;
}

const USAGE = 'Usage: cli.ts <generate|check> [--root <repository root>]';
const stdoutIo: Io = { log: (line) => process.stdout.write(`${line}\n`) };

function normaliseEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function generated(root: string): Array<{ path: string; text: string }> {
  const json = JSON.parse(readFileSync(join(root, DESIGN_TOKENS_PATH), 'utf8')) as DesignTokens;
  const { css, ts } = generateTokens(json);
  return [
    { path: CSS_OUTPUT_PATH, text: css },
    { path: TS_OUTPUT_PATH, text: ts },
  ];
}

function readCommitted(path: string): string | undefined {
  try {
    return normaliseEol(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Exit codes: 0 ok, 1 a generated file is stale or missing, 2 usage error. */
export function main(argv: string[], io: Io = stdoutIo): number {
  const { values, positionals } = parseArgs({ args: argv, options: { root: { type: 'string', default: '.' } }, allowPositionals: true });
  const root = resolve(values.root);
  switch (positionals[0]) {
    case 'generate':
      for (const file of generated(root)) {
        const target = join(root, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.text);
        io.log(`Wrote: ${file.path}`);
      }
      return 0;
    case 'check': {
      const stale = generated(root).filter((file) => readCommitted(join(root, file.path)) !== file.text);
      for (const file of stale) io.log(`Out of date: ${file.path}. Run \`npm run tokens:generate\`.`);
      return stale.length === 0 ? 0 : 1;
    }
    default:
      io.log(USAGE);
      return 2;
  }
}

// Runs only when started as a script (node src/cli.ts), never when imported by tests.
if (process.argv[1] !== undefined && /[\\/]cli\.ts$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
