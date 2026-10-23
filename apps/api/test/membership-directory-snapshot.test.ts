import { TenantDatabase } from '@machvon/db';
import type { TenantTx } from '@machvon/db';
import type { TenantContext } from '@machvon/kernel';
import { MembershipsController } from '../src/session/memberships.controller';
import { AuthzHarness, TENANT_A, contextFor, memberId } from '../../../packages/db/test/support/authz-fixtures';

jest.setTimeout(120_000);

/**
 * A database whose transactions let another administrator change a membership right after the directory row was read, which
 * is the interleaving that a plain READ COMMITTED transaction allows between two statements.
 */
class ChangingDatabase extends TenantDatabase {
  after: (() => Promise<void>) | undefined;

  override withTenant<T>(ctx: TenantContext, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return super.withTenant(ctx, (tx) => {
      const watching: TenantTx = {
        query: async <R>(sql: string, params?: unknown[]): Promise<R[]> => {
          const rows = await tx.query<R>(sql, params);
          const change = this.after;
          if (change !== undefined && sql.includes('tenant_user_directory d join machvon.organization_unit')) {
            this.after = undefined;
            await change();
          }
          return rows;
        },
      };
      return work(watching);
    });
  }
}

describe('the membership directory read (get_resources_membership)', () => {
  const harness = new AuthzHarness();
  let database: ChangingDatabase;
  let controller: MembershipsController;
  const caller = contextFor(TENANT_A, memberId(1));

  beforeAll(async () => {
    await harness.start();
    database = new ChangingDatabase(harness.appPool);
    controller = new MembershipsController(database);
    await harness.seedUnits(TENANT_A, [{ n: 1, path: '/u1/' }]);
    for (const member of [1, 2, 3]) await harness.seedMembership(TENANT_A, member, 1);
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  const suspend = (member: number) => async (): Promise<void> => {
    await harness.owner(TENANT_A, [["update machvon.membership set status = 'Suspended', version = version + 1 where id = $1", [memberId(member)]]]);
  };

  it('reads the status and the version that If-Match checks from one state of the membership: one row, one statement', async () => {
    database.after = suspend(2);
    const shown = await controller.get(caller, memberId(2));
    // The change came after the row was read, so the whole answer is the state before it: Active at version 1, never Active at version 2.
    expect([shown.status, shown.version]).toEqual(['Active', 1]);
    // The next read sees the change, again as one state.
    const next = await controller.get(caller, memberId(2));
    expect([next.status, next.version]).toEqual(['Suspended', 2]);
  });

  it('does the same for a page of the directory', async () => {
    database.after = suspend(3);
    const page = await controller.list(caller, undefined, '50');
    const row = page.items.find((item) => item.id === memberId(3));
    expect([row?.status, row?.version]).toEqual(['Active', 1]);
  });
});
