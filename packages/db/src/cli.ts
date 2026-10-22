import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkGenerated, loadCommittedMigrations, writeGenerated } from './generate-migrations.ts';
import { migrate } from './migrate.ts';

export interface Io {
  log: (line: string) => void;
}

const USAGE = 'Usage: cli.ts <generate|migrate|check> [--root <repository root>]';
const PROFILES = ['production', 'test'] as const;

const stdoutIo: Io = { log: (line) => process.stdout.write(`${line}\n`) };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runMigrate(root: string, env: Record<string, string | undefined>, io: Io): Promise<number> {
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') {
    io.log('DATABASE_URL is required (a privileged connection that may SET ROLE machvon_owner).');
    return 2;
  }
  const profile = PROFILES.find((candidate) => candidate === (env.MACHVON_DB_PROFILE ?? 'production'));
  if (profile === undefined) {
    io.log(`MACHVON_DB_PROFILE must be one of: ${PROFILES.join(', ')}.`);
    return 2;
  }
  try {
    await checkGenerated(root);
  } catch (error) {
    io.log(messageOf(error));
    return 1;
  }
  const { applied } = await migrate(url, await loadCommittedMigrations(root), { profile });
  io.log(applied.length === 0 ? 'Nothing to apply' : `Applied: ${applied.join(', ')}`);
  return 0;
}

/** Exit codes: 0 ok, 1 drift or migration failure, 2 usage or configuration error. */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, io: Io = stdoutIo): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { root: { type: 'string', default: '.' } }, allowPositionals: true });
  const root = resolve(values.root);
  switch (positionals[0]) {
    case 'generate':
      io.log(`Wrote: ${(await writeGenerated(root)).join(', ')}`);
      return 0;
    case 'check':
      try {
        await checkGenerated(root);
        return 0;
      } catch (error) {
        io.log(messageOf(error));
        return 1;
      }
    case 'migrate':
      return runMigrate(root, env, io);
    default:
      io.log(USAGE);
      return 2;
  }
}

// Runs only when started as a script (node src/cli.ts), never when imported by tests.
if (process.argv[1] !== undefined && /[\\/]cli\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${messageOf(error)}\n`);
      process.exitCode = 1;
    },
  );
}
