import { PERMISSIONS } from '@machvon/contracts';
import { scopePredicate } from '@machvon/db';
import type { EffectiveAccessStore, TenantDatabase } from '@machvon/db';
import { runScheduledExport } from '@machvon/kernel';
import type { ScheduledExportDeps, ScheduledExportJob, ScheduledExportOutcome } from '@machvon/kernel';
import { UNIT_FIXTURES } from '../suite';
import type { ForeignAttempt, IsolationChannel, TenantName } from '../suite';
import { contextOf } from './database';

/** The permission the scheduled export runs under: reading the organisation units, which the TNT-A test role holds. */
export const EXPORT_PERMISSION = PERMISSIONS.get_resources_organization_unit;

export interface ExportRow {
  id: string;
  code: string;
  name: string;
}

export type ExportDataDeps = Pick<ScheduledExportDeps<ExportRow>, 'reachableUnitIds' | 'produce'>;

/** The units a user reaches and their rows, both read through the user's own tenant transaction (row-level security applies). */
export function tenantExportData(database: TenantDatabase, tenant: TenantName): ExportDataDeps {
  const ctx = contextOf(tenant);
  return {
    reachableUnitIds: (access, permission, now) => {
      const scope = scopePredicate(access, permission, now, { unitPath: 'u.path', unitId: 'u.id' }, 1);
      return database.withTenant(ctx, async (tx) => (await tx.query<{ id: string }>(`select u.id from machvon.organization_unit u where ${scope.sql}`, scope.params)).map((row) => row.id));
    },
    produce: (unitIds) =>
      database.withTenant(ctx, (tx) => tx.query<ExportRow>('select id, code, name from machvon.organization_unit where id = any($1::uuid[]) order by code', [unitIds])),
  };
}

function bodyOf(outcome: ScheduledExportOutcome<ExportRow>): { status: number; body: string } {
  // A job that produced nothing is an empty answer: no file exists that could hold data.
  return { status: 200, body: JSON.stringify({ items: outcome.status === 'DONE' ? outcome.rows : [], status: outcome.status }) };
}

export interface ExportChannelOptions {
  database: TenantDatabase;
  access: EffectiveAccessStore;
  /** The units a user reaches and the rows of units; the default reads through the tenant transaction of the user. */
  data?: (tenant: TenantName) => ExportDataDeps;
  now?: () => Date;
}

/**
 * Scheduled exports as a way to read another tenant's data. The creator of a job is a TNT-A member who names units in
 * the job: the job of "foreign read" names only TNT-B units, the job of the list names the TNT-A units and one TNT-B
 * unit. The run takes the units the creator reaches today (grants resolved in the creator's own tenant) and produces
 * rows for those only, so no TNT-B unit may come out, whatever the job says (NFR-TENANCY-06).
 */
export function createExportChannel(options: ExportChannelOptions): IsolationChannel {
  const now = options.now ?? (() => new Date());
  const dataOf = options.data ?? ((tenant: TenantName) => tenantExportData(options.database, tenant));

  function run(user: TenantName, unitIds: string[], permission: string = EXPORT_PERMISSION): Promise<ScheduledExportOutcome<ExportRow>> {
    const ctx = contextOf(user);
    const job: ScheduledExportJob = { id: `export-${user}`, createdBy: ctx.membershipId, permission, unitIds };
    return runScheduledExport(job, { now, loadAccess: () => options.access.load(ctx), ...dataOf(user) });
  }

  const idsOf = (tenant: TenantName): string[] => UNIT_FIXTURES[tenant].map((unit) => unit.id);

  return {
    name: 'export',
    foreignReadOutcome: 'empty',
    // The rows come from the units that the seed of the other channels created; nothing to plant here.
    seed: async () => undefined,
    async readAs(user, target) {
      return bodyOf(await run(user, [UNIT_FIXTURES[target][0]?.id ?? '']));
    },
    async listAs(user) {
      // The job names every unit of the user's tenant and, as a crafted job could, the first unit of TNT-B.
      return bodyOf(await run(user, [...idsOf(user), UNIT_FIXTURES['TNT-B'][0]?.id ?? '']));
    },
    async foreignAttempts(user): Promise<ForeignAttempt[]> {
      const everything = [...idsOf('TNT-A'), ...idsOf('TNT-B')];
      return [
        { operation: 'export:all-units', ...bodyOf(await run(user, everything)), expectedStatuses: [200] },
        { operation: 'export:lost-permission', ...bodyOf(await run(user, everything, 'report.nobody.holds')), expectedStatuses: [200] },
      ];
    },
  };
}
