import { NIL_RESOURCE_ID } from '../src/audit-writer';
import { CORRELATION, MEMBERSHIP, TENANT_A, TENANT_B, contextOf, entryOf, startAuditHarness } from './support/audit-fixtures';
import type { AuditHarness } from './support/audit-fixtures';

interface Stored {
  action: string;
  outcome: string;
  actor_id: string;
  safe_diff: Record<string, unknown>;
  classification: string;
  resource_id: string;
}

describe('AuditWriter', () => {
  let harness: AuditHarness;

  const rowsOf = (tenantId: string): Promise<Stored[]> =>
    harness.tenantDatabase.withTenant(contextOf(tenantId), (tx) =>
      tx.query<Stored>('select action, outcome, actor_id, safe_diff, classification, resource_id from machvon.audit_event order by seq'),
    );

  beforeAll(async () => {
    harness = await startAuditHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  }, 60_000);

  it('makes a success entry visible after commit and gone after rollback (AC-ST-KERNEL-023-3, AC-ST-ADM-002-2)', async () => {
    const committed = await harness.tenantDatabase.withTenant(contextOf(TENANT_A), (tx) =>
      harness.writer.recordInTx(tx, MEMBERSHIP, entryOf('committed')),
    );
    expect(committed).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      harness.tenantDatabase.withTenant(contextOf(TENANT_A), async (tx) => {
        await harness.writer.recordInTx(tx, MEMBERSHIP, entryOf('rolled-back'));
        throw new Error('command failed');
      }),
    ).rejects.toThrow('command failed');
    const rows = await rowsOf(TENANT_A);
    expect(rows.map((row) => row.action)).toEqual(['committed']);
    expect(rows[0]).toMatchObject({ outcome: 'SUCCESS', actor_id: MEMBERSHIP, classification: 'INTERNAL', safe_diff: { name: 'Đà Nẵng' } });
  });

  it('stores a redacted diff, honouring caller-declared sensitive keys', async () => {
    await harness.tenantDatabase.withTenant(contextOf(TENANT_A), (tx) =>
      harness.writer.recordInTx(
        tx,
        MEMBERSHIP,
        entryOf('redacted', {
          diff: { password: 'p', contract_value: 1_000_000, nested: [{ api_key: 'k', title: 'ok' }] },
          sensitiveKeys: ['contract_value'],
        }),
      ),
    );
    const row = (await rowsOf(TENANT_A)).find((candidate) => candidate.action === 'redacted');
    const redacted = '[REDACTED]';
    expect(row?.safe_diff).toEqual({ password: redacted, contract_value: redacted, nested: [{ api_key: redacted, title: 'ok' }] });
  });

  it('writes a denial in its own transaction, which survives the rollback of the denied command', async () => {
    await expect(
      harness.tenantDatabase.withTenant(contextOf(TENANT_B), async (tx) => {
        await harness.writer.recordInTx(tx, MEMBERSHIP, entryOf('denied-command-success-row'));
        await harness.writer.recordDenied(contextOf(TENANT_B), entryOf('denied-command', { resourceId: NIL_RESOURCE_ID }));
        throw new Error('denied');
      }),
    ).rejects.toThrow('denied');
    const rows = await rowsOf(TENANT_B);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'denied-command', outcome: 'DENIED', actor_id: MEMBERSHIP, resource_id: NIL_RESOURCE_ID });
  });

  it('records the optional fields', async () => {
    const other = '00000000-0000-4000-8000-0000000000f2';
    await harness.tenantDatabase.withTenant(contextOf(TENANT_A), (tx) =>
      harness.writer.recordInTx(
        tx,
        MEMBERSHIP,
        entryOf('optional', { reason: 'support ticket', classification: 'PERSONAL', impersonatorId: other, onBehalfOfId: other, ipHash: 'a'.repeat(64) }),
      ),
    );
    const [row] = await harness.tenantDatabase.withTenant(contextOf(TENANT_A), (tx) =>
      tx.query<Record<string, string>>(
        "select reason, classification, impersonator_id, on_behalf_of_id, ip_hash, correlation_id from machvon.audit_event where action = 'optional'",
      ),
    );
    expect(row).toMatchObject({ reason: 'support ticket', classification: 'PERSONAL', impersonator_id: other, on_behalf_of_id: other, ip_hash: 'a'.repeat(64), correlation_id: CORRELATION });
  });

  it('rejects an invalid classification through the table CHECK', async () => {
    await expect(
      harness.tenantDatabase.withTenant(contextOf(TENANT_A), (tx) =>
        harness.writer.recordInTx(tx, MEMBERSHIP, entryOf('bad', { classification: 'SECRET' as never })),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses UPDATE and DELETE to the application role (AC-ST-KERNEL-023-1)', async () => {
    for (const statement of ["update machvon.audit_event set action = 'x'", 'delete from machvon.audit_event']) {
      await expect(harness.tenantDatabase.withTenant(contextOf(TENANT_A), (tx) => tx.query(statement))).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('keeps tenants apart', async () => {
    const actionsOfA = (await rowsOf(TENANT_A)).map((row) => row.action);
    const actionsOfB = (await rowsOf(TENANT_B)).map((row) => row.action);
    expect(actionsOfA).not.toContain('denied-command');
    expect(actionsOfB).toEqual(['denied-command']);
  });
});
