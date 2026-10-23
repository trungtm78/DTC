import { parseArgs } from 'node:util';
import type { AlertSink } from '@machvon/kernel';
import { Pool } from 'pg';
import { AuditSealJob } from './audit-seal-job.ts';
import { ControlDatabase } from './control-database.ts';
import { IdempotencyStore } from './idempotency-store.ts';
import { JobRunner } from './job-runner.ts';
import { DATABASE_JOBS, registeredTenantIds, standardJobs } from './jobs.ts';
import { TenantDatabase } from './tenant-database.ts';

export interface Io {
  log: (line: string) => void;
}

const USAGE = `Usage: jobs-cli.ts <${DATABASE_JOBS.join('|')}>`;
const stdoutIo: Io = { log: (line) => process.stdout.write(`${line}\n`) };

/** One line of JSON per alert, for the log pipeline of the operations channel. */
function logAlerts(io: Io): AlertSink {
  return { raise: (code, context) => io.log(JSON.stringify({ alert: code, ...context })) };
}

/**
 * Runs one database job once and exits. Exit codes: 0 the job succeeded, or another runner holds it (skipped);
 * 1 the job failed; 2 usage or configuration error. The outbox relay and the access cache belong to the API process.
 * DATABASE_URL_APP connects as machvon_app, DATABASE_URL_CONTROL as machvon_control (it lists the tenants).
 */
export async function main(argv: string[], env: Record<string, string | undefined> = process.env, io: Io = stdoutIo): Promise<number> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true });
  const name = DATABASE_JOBS.find((candidate) => candidate === positionals[0]);
  if (name === undefined || positionals.length !== 1) {
    io.log(USAGE);
    return 2;
  }
  const appUrl = env.DATABASE_URL_APP;
  const controlUrl = env.DATABASE_URL_CONTROL;
  if (appUrl === undefined || appUrl === '' || controlUrl === undefined || controlUrl === '') {
    io.log('DATABASE_URL_APP (role machvon_app) and DATABASE_URL_CONTROL (role machvon_control) are required.');
    return 2;
  }
  const appPool = new Pool({ connectionString: appUrl, max: 4 });
  const controlPool = new Pool({ connectionString: controlUrl, max: 2 });
  try {
    const alerts = logAlerts(io);
    const tenants = new TenantDatabase(appPool);
    const control = new ControlDatabase(controlPool);
    const runner = new JobRunner(appPool, { alerts });
    for (const handler of standardJobs({
      tenantIds: () => registeredTenantIds(control),
      seal: new AuditSealJob(tenants, { alerts }),
      idempotency: new IdempotencyStore(tenants),
    })) {
      runner.register(handler);
    }
    const record = await runner.runOnce(name);
    io.log(`${name}: ${record.outcome}`);
    return record.outcome === 'FAILED' ? 1 : 0;
  } finally {
    await Promise.all([appPool.end(), controlPool.end()]);
  }
}
