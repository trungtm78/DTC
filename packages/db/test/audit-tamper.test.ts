import type { Client } from 'pg';
import { AuditSealJob } from '../src/audit-seal-job';
import {
  MEMBERSHIP,
  RESOURCE,
  TENANT_A,
  TENANT_B,
  appendEntries,
  contextOf,
  ownerSession,
  recorder,
  startAuditHarness,
} from './support/audit-fixtures';
import type { AuditHarness, Recorded } from './support/audit-fixtures';

interface SealIds {
  id: string;
  from_seq: string;
  to_seq: string;
}

// UAT-AC139 and AC-ST-KERNEL-023-2: the owner role may edit audit tables (the drill needs it), and the verifier must notice.
describe('audit tamper detection', () => {
  let harness: AuditHarness;
  let seen: Recorded;
  let job: AuditSealJob;
  let owner: Client;

  const tenantSeals = async (): Promise<SealIds[]> => (await owner.query<SealIds>('select id, from_seq, to_seq from machvon.audit_seal order by to_seq')).rows;

  const reset = async (): Promise<void> => {
    await owner.query('delete from machvon.audit_seal');
    await owner.query('delete from machvon.audit_event');
    seen = recorder();
    job = new AuditSealJob(harness.tenantDatabase, { windowRows: 10, ...seen.sinks });
  };

  // Rows are sealed in windows of 10; `burnAfter` leaves free seq values for the insert variants.
  const sealed = async (count: number, burnAfter: readonly number[] = []): Promise<{ seqs: number[]; burnt: number[] }> => {
    const written = await appendEntries(harness, TENANT_A, count, burnAfter);
    await job.seal(contextOf(TENANT_A));
    return written;
  };

  const insertRow = (seq: number): Promise<unknown> =>
    owner.query(
      `insert into machvon.audit_event (tenant_id, id, seq, actor_id, action, resource_type, resource_id, safe_diff, correlation_id, request_id, occurred_at)
       values ($1, gen_random_uuid(), $2, $3, 'planted', 'widget', $4, '{}', $4, $4, now())`,
      [TENANT_A, seq, MEMBERSHIP, RESOURCE],
    );

  beforeAll(async () => {
    harness = await startAuditHarness();
    owner = await ownerSession(harness, TENANT_A);
  }, 180_000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (harness) await harness.stop();
  }, 60_000);

  beforeEach(reset);

  it('verifies an untouched chain', async () => {
    await sealed(50);
    expect(await job.verify(contextOf(TENANT_A))).toEqual({ ok: true, seals: 5 });
    expect(seen.alerts).toEqual([]);
  });

  it('reports the window of an altered 25th row, raises AUDIT_CHAIN_BROKEN and counts the failure (AC-ST-KERNEL-023-2)', async () => {
    const { seqs } = await sealed(50);
    await owner.query("update machvon.audit_event set action = 'tampered' where seq = $1", [seqs[24]]);
    const outcome = await job.verify(contextOf(TENANT_A));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a broken chain');
    expect(outcome.brokenAt.reason).toBe('ROOT_MISMATCH');
    expect(outcome.brokenAt.fromSeq).toBeLessThanOrEqual(seqs[24] as number);
    expect(outcome.brokenAt.toSeq).toBeGreaterThanOrEqual(seqs[24] as number);
    expect(outcome.seals).toBe(3);
    expect(seen.alerts).toEqual([{ code: 'AUDIT_CHAIN_BROKEN', context: { tenantId: TENANT_A, ...outcome.brokenAt } }]);
    expect(seen.metrics).toEqual([{ name: 'audit_seal_failures_total', labels: { tenant_id: TENANT_A } }]);
  });

  it('detects a deleted row', async () => {
    const { seqs } = await sealed(30);
    await owner.query('delete from machvon.audit_event where seq = $1', [seqs[12]]);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { reason: 'ROOT_MISMATCH' } });
  });

  it('detects a window whose rows were all deleted', async () => {
    const { seqs } = await sealed(20);
    await owner.query('delete from machvon.audit_event where seq between $1 and $2', [seqs[0], seqs[9]]);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { reason: 'ROOT_MISMATCH' } });
  });

  it('detects a row planted inside a sealed window', async () => {
    const { burnt } = await sealed(20, [5]);
    await insertRow(burnt[0] as number);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { reason: 'ROOT_MISMATCH' } });
  });

  it('detects a row planted in the gap between two seals', async () => {
    const first = await appendEntries(harness, TENANT_A, 10, [10]);
    await job.seal(contextOf(TENANT_A));
    await appendEntries(harness, TENANT_A, 10);
    await job.seal(contextOf(TENANT_A));
    await insertRow(first.burnt[0] as number);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { reason: 'UNSEALED_ROW_IN_GAP' } });
  });

  it('detects a rewritten prev_seal_hash', async () => {
    await sealed(30);
    const seals = await tenantSeals();
    await owner.query("update machvon.audit_seal set prev_seal_hash = repeat('d', 64) where id = $1", [seals[1]?.id]);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { sealId: seals[1]?.id, reason: 'CHAIN_LINK_MISMATCH' } });
  });

  it('detects a rewritten seal_hash', async () => {
    await sealed(30);
    const seals = await tenantSeals();
    await owner.query("update machvon.audit_seal set seal_hash = repeat('c', 64) where id = $1", [seals[0]?.id]);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { sealId: seals[0]?.id, reason: 'SEAL_HASH_MISMATCH' } });
  });

  it('detects a rewritten merkle_root', async () => {
    await sealed(20);
    const seals = await tenantSeals();
    await owner.query("update machvon.audit_seal set merkle_root = repeat('e', 64) where id = $1", [seals[1]?.id]);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false, brokenAt: { reason: 'ROOT_MISMATCH' } });
  });

  it('never lets tampering in one tenant fail another', async () => {
    const { seqs } = await sealed(20);
    await appendEntries(harness, TENANT_B, 20);
    await job.seal(contextOf(TENANT_B));
    await owner.query("update machvon.audit_event set action = 'tampered' where seq = $1", [seqs[3]]);
    expect(await job.verify(contextOf(TENANT_A))).toMatchObject({ ok: false });
    expect(await job.verify(contextOf(TENANT_B))).toEqual({ ok: true, seals: 2 });
    const ownerB = await ownerSession(harness, TENANT_B);
    try {
      await ownerB.query('delete from machvon.audit_seal');
      await ownerB.query('delete from machvon.audit_event');
    } finally {
      await ownerB.end();
    }
  });
});
