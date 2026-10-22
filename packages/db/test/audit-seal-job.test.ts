import { AuditSealJob } from '../src/audit-seal-job';
import { MEMBERSHIP, TENANT_A, TENANT_B, appendEntries, contextOf, entryOf, ownerSession, recorder, startAuditHarness } from './support/audit-fixtures';
import type { AuditHarness } from './support/audit-fixtures';

interface SealRow {
  from_seq: string;
  to_seq: string;
  prev_seal_hash: string | null;
  seal_hash: string;
}

describe('AuditSealJob', () => {
  let harness: AuditHarness;

  const sealsOf = (tenantId: string): Promise<SealRow[]> =>
    harness.tenantDatabase.withTenant(contextOf(tenantId), (tx) =>
      tx.query<SealRow>('select from_seq, to_seq, prev_seal_hash, seal_hash from machvon.audit_seal order by to_seq'),
    );

  const clearTenant = async (tenantId: string): Promise<void> => {
    const owner = await ownerSession(harness, tenantId);
    try {
      await owner.query('delete from machvon.audit_seal');
      await owner.query('delete from machvon.audit_event');
    } finally {
      await owner.end();
    }
  };

  beforeAll(async () => {
    harness = await startAuditHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  }, 60_000);

  afterEach(async () => {
    await clearTenant(TENANT_A);
    await clearTenant(TENANT_B);
  });

  it('seals 1,000 entries into one seal covering the tenant rows, then has nothing more to seal', async () => {
    const { seqs } = await appendEntries(harness, TENANT_A, 1000);
    const job = new AuditSealJob(harness.tenantDatabase);
    expect(await job.seal(contextOf(TENANT_A))).toEqual({ sealed: 1000, seals: 1 });
    const seals = await sealsOf(TENANT_A);
    expect(seals).toHaveLength(1);
    expect(Number(seals[0]?.from_seq)).toBe(seqs[0]);
    expect(Number(seals[0]?.to_seq)).toBe(seqs[999]);
    expect(seals[0]?.prev_seal_hash).toBeNull();
    expect(await job.seal(contextOf(TENANT_A))).toEqual({ sealed: 0, seals: 0 });
    expect(await job.verify(contextOf(TENANT_A))).toEqual({ ok: true, seals: 1 });
  }, 120_000);

  it('chains windows of 10, 10 and 5 rows by prev_seal_hash', async () => {
    await appendEntries(harness, TENANT_A, 25);
    const job = new AuditSealJob(harness.tenantDatabase, { windowRows: 10 });
    expect(await job.seal(contextOf(TENANT_A))).toEqual({ sealed: 25, seals: 3 });
    const seals = await sealsOf(TENANT_A);
    expect(seals[0]?.prev_seal_hash).toBeNull();
    expect(seals[1]?.prev_seal_hash).toBe(seals[0]?.seal_hash);
    expect(seals[2]?.prev_seal_hash).toBe(seals[1]?.seal_hash);
    await appendEntries(harness, TENANT_A, 3);
    expect(await job.seal(contextOf(TENANT_A))).toEqual({ sealed: 3, seals: 1 });
    expect((await sealsOf(TENANT_A))[3]?.prev_seal_hash).toBe(seals[2]?.seal_hash);
    expect(await job.verify(contextOf(TENANT_A))).toEqual({ ok: true, seals: 4 });
  });

  it('gives interleaved tenants independent chains that both verify', async () => {
    for (let round = 0; round < 3; round += 1) {
      await appendEntries(harness, TENANT_A, 4);
      await appendEntries(harness, TENANT_B, 4);
    }
    const job = new AuditSealJob(harness.tenantDatabase, { windowRows: 5 });
    expect(await job.seal(contextOf(TENANT_A))).toEqual({ sealed: 12, seals: 3 });
    expect(await job.seal(contextOf(TENANT_B))).toEqual({ sealed: 12, seals: 3 });
    expect((await sealsOf(TENANT_A))[0]?.prev_seal_hash).toBeNull();
    expect((await sealsOf(TENANT_B))[0]?.prev_seal_hash).toBeNull();
    expect(await job.verify(contextOf(TENANT_A))).toEqual({ ok: true, seals: 3 });
    expect(await job.verify(contextOf(TENANT_B))).toEqual({ ok: true, seals: 3 });
  });

  it('waits for an in-flight writer and then seals its row, never sealing around it', async () => {
    const job = new AuditSealJob(harness.tenantDatabase);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written: () => void = () => undefined;
    const rowWritten = new Promise<void>((resolve) => {
      written = resolve;
    });
    const writer = harness.tenantDatabase.withTenant(contextOf(TENANT_A), async (tx) => {
      await harness.writer.recordInTx(tx, MEMBERSHIP, entryOf('in-flight'));
      written();
      await gate;
    });
    await rowWritten;
    let sealed = false;
    const sealing = job.seal(contextOf(TENANT_A)).then((outcome) => {
      sealed = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sealed).toBe(false);
    release();
    await writer;
    expect(await sealing).toEqual({ sealed: 1, seals: 1 });
    expect(await job.verify(contextOf(TENANT_A))).toEqual({ ok: true, seals: 1 });
  });

  it('verifies a tenant without seals as ok and rejects a bad window size', async () => {
    const job = new AuditSealJob(harness.tenantDatabase);
    expect(await job.verify(contextOf(TENANT_B))).toEqual({ ok: true, seals: 0 });
    expect(() => new AuditSealJob(harness.tenantDatabase, { windowRows: 0 })).toThrow(RangeError);
    expect(() => new AuditSealJob(harness.tenantDatabase, { windowRows: 1.5 })).toThrow(RangeError);
  });

  it('uses the injected sinks only on a failure', async () => {
    const seen = recorder();
    await appendEntries(harness, TENANT_A, 3);
    const job = new AuditSealJob(harness.tenantDatabase, { ...seen.sinks });
    await job.seal(contextOf(TENANT_A));
    await job.verify(contextOf(TENANT_A));
    expect(seen.alerts).toEqual([]);
    expect(seen.metrics).toEqual([]);
  });
});
