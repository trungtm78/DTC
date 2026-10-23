import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { DomainError } from '@machvon/kernel';
import { IdempotencyStore } from '../src/idempotency-store';
import { LegalHoldStore } from '../src/legal-hold-store';
import { LEGAL_HOLD_SQLSTATE, assertNotOnHold, asLegalHoldViolation, isHeld } from '../src/purge-guard';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, id, memberId, unitId } from './support/authz-fixtures';

const PLACER = memberId(1);
const RELEASER = memberId(2);
const PROJECT_FAMILY = 0x50;
const CONTRACT_FAMILY = 0x53;
const PROJECT_IN_U2 = id(PROJECT_FAMILY, 1);
const PROJECT_IN_U5 = id(PROJECT_FAMILY, 2);
const CONTRACT_IN_U2 = id(CONTRACT_FAMILY, 1);
const CONTRACT_IN_U5 = id(CONTRACT_FAMILY, 2);
const FOREIGN_RESOURCE = id(0x70, 1);
const path = (...ns: number[]): string => `/${ns.map(unitId).join('/')}/`;

describe('legal holds (ST-ADM-003, BR-PLT-04)', () => {
  const harness = new AuthzHarness();
  const store = new LegalHoldStore();
  const ctxA = contextFor(TENANT_A, PLACER);
  const ctxB = contextFor(TENANT_B, PLACER);

  const asA = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]): Promise<T> => harness.tenants.withTenant(ctxA, work);

  async function clearHolds(): Promise<void> {
    await harness.owner(TENANT_A, [['delete from machvon.legal_hold', []]]);
    await harness.owner(TENANT_B, [['delete from machvon.legal_hold', []]]);
  }

  async function place(kind: 'TENANT' | 'UNIT' | 'PROJECT' | 'CONTRACT' | 'RESOURCE', ids: string[] = [], options: { effectiveAt?: string } = {}): Promise<string> {
    const placed = await asA((tx) =>
      store.place(
        tx,
        { holdKind: 'INSPECTION', scope: { kind, ids }, authorityReference: 'Decision 12/QD-TTCP', reason: 'Inspection of the project files', effectiveAt: options.effectiveAt },
        PLACER,
      ),
    );
    return placed.id;
  }

  const releaseHold = (holdId: string, by = RELEASER, reason = 'Inspection closed by decision'): Promise<unknown> =>
    asA(async (tx) => {
      const hold = await store.lock(tx, holdId, 1);
      return store.release(tx, hold, by, reason);
    });

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: path(1) },
      { n: 2, path: path(1, 2), parent: 1 },
      { n: 3, path: path(1, 2, 3), parent: 2 },
      { n: 5, path: path(1, 5), parent: 1 },
    ]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: path(1) }]);
    await harness.seedMembership(TENANT_A, 1, 1);
    await harness.seedMembership(TENANT_A, 2, 1);
    // The reference data a project points at (master versions, packages, contractors) is not what is under test.
    const admin = new Client({ connectionString: harness.database.adminUrl });
    await admin.connect();
    try {
      await admin.query('set session_replication_role = replica');
      await admin.query(
        `insert into machvon.project (tenant_id, id, code, name, owner_unit_id, area_master_version_id, classification, total_investment_vnd, status, version)
         values ($1, $2, 'P1', 'Project 1', $3, $4, 'INTERNAL', 1000, 'CONCEPT', 1), ($1, $5, 'P2', 'Project 2', $6, $4, 'INTERNAL', 1000, 'CONCEPT', 1)`,
        [TENANT_A, PROJECT_IN_U2, unitId(2), id(0x52, 1), PROJECT_IN_U5, unitId(5)],
      );
      for (const [contract, project, code] of [
        [CONTRACT_IN_U2, PROJECT_IN_U2, 'C1'],
        [CONTRACT_IN_U5, PROJECT_IN_U5, 'C2'],
      ]) {
        await admin.query(
          `insert into machvon.contract (tenant_id, id, project_id, package_id, contractor_id, code, type, currency, status, version, contract_value_vnd, signed_on, effective_from)
           values ($1, $2, $3, $4, $5, $6, 'LUMP_SUM', 'VND', 'ACTIVE', 1, 1000, date '2026-01-01', date '2026-01-01')`,
          [TENANT_A, contract, project, id(0x54, 1), id(0x55, 1), code],
        );
      }
    } finally {
      await admin.end();
    }
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  afterEach(clearHolds);

  describe('isHeld: which resources a hold contains', () => {
    it('holds nothing back while there is no hold, a hold has been released or has not started yet', async () => {
      expect(await asA((tx) => isHeld(tx, { type: 'organization_unit', id: unitId(2) }))).toBe(false);
      const released = await place('TENANT');
      await releaseHold(released);
      const future = await place('TENANT', [], { effectiveAt: '2999-01-01T00:00:00Z' });
      expect(future).toBeDefined();
      expect(await asA((tx) => isHeld(tx, { type: 'organization_unit', id: unitId(2) }))).toBe(false);
    });

    it('lets a tenant hold contain every resource, with or without an id', async () => {
      await place('TENANT');
      expect(await asA((tx) => isHeld(tx, { type: 'whatever', id: FOREIGN_RESOURCE }))).toBe(true);
      expect(await asA((tx) => isHeld(tx, { type: 'user_session', id: undefined }))).toBe(true);
    });

    it('contains exactly the listed ids for a resource hold', async () => {
      await place('RESOURCE', [FOREIGN_RESOURCE]);
      expect(await asA((tx) => isHeld(tx, { type: 'report_revision', id: FOREIGN_RESOURCE }))).toBe(true);
      expect(await asA((tx) => isHeld(tx, { type: 'report_revision', id: id(0x70, 2) }))).toBe(false);
      expect(await asA((tx) => isHeld(tx, { type: 'report_revision', id: undefined }))).toBe(false);
    });

    it('contains the units of a subtree, their projects and the contracts of those projects (and nothing of a sibling)', async () => {
      await place('UNIT', [unitId(2)]);
      const held = (type: string, resource: string): Promise<boolean> => asA((tx) => isHeld(tx, { type, id: resource }));
      expect(await held('organization_unit', unitId(2))).toBe(true);
      expect(await held('organization_unit', unitId(3))).toBe(true);
      expect(await held('organization_unit', unitId(5))).toBe(false);
      expect(await held('organization_unit', unitId(1))).toBe(false);
      expect(await held('project', PROJECT_IN_U2)).toBe(true);
      expect(await held('project', PROJECT_IN_U5)).toBe(false);
      expect(await held('contract', CONTRACT_IN_U2)).toBe(true);
      expect(await held('contract', CONTRACT_IN_U5)).toBe(false);
    });

    it('keeps a unit whose path merely starts with the same characters out of the subtree', async () => {
      await harness.seedUnits(TENANT_A, [{ n: 21, path: `/${unitId(1)}/${unitId(2)}x/`, parent: 1 }]);
      await harness.owner(TENANT_A, [['update machvon.organization_unit set path = $2 where id = $1', [unitId(21), `${path(1, 2).slice(0, -1)}9/`]]]);
      await place('UNIT', [unitId(2)]);
      expect(await asA((tx) => isHeld(tx, { type: 'organization_unit', id: unitId(21) }))).toBe(false);
      await harness.owner(TENANT_A, [['delete from machvon.organization_unit where id = $1', [unitId(21)]]]);
    });

    it('contains a project and its contracts for a project hold, and one contract for a contract hold', async () => {
      await place('PROJECT', [PROJECT_IN_U2]);
      expect(await asA((tx) => isHeld(tx, { type: 'project', id: PROJECT_IN_U2 }))).toBe(true);
      expect(await asA((tx) => isHeld(tx, { type: 'contract', id: CONTRACT_IN_U2 }))).toBe(true);
      expect(await asA((tx) => isHeld(tx, { type: 'project', id: PROJECT_IN_U5 }))).toBe(false);
      expect(await asA((tx) => isHeld(tx, { type: 'contract', id: CONTRACT_IN_U5 }))).toBe(false);
      await clearHolds();
      await place('CONTRACT', [CONTRACT_IN_U5]);
      expect(await asA((tx) => isHeld(tx, { type: 'contract', id: CONTRACT_IN_U5 }))).toBe(true);
      expect(await asA((tx) => isHeld(tx, { type: 'contract', id: CONTRACT_IN_U2 }))).toBe(false);
      expect(await asA((tx) => isHeld(tx, { type: 'project', id: PROJECT_IN_U5 }))).toBe(false);
    });

    it('never lets a hold of one tenant reach the resources of another', async () => {
      await place('TENANT');
      expect(await harness.tenants.withTenant(ctxB, (tx) => isHeld(tx, { type: 'organization_unit', id: unitId(1) }))).toBe(false);
    });
  });

  describe('assertNotOnHold', () => {
    it('refuses with LEGAL_HOLD_ACTIVE (409) while held and passes after the release', async () => {
      const holdId = await place('RESOURCE', [FOREIGN_RESOURCE]);
      const refusal = await asA((tx) => assertNotOnHold(tx, { type: 'report_revision', id: FOREIGN_RESOURCE })).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(DomainError);
      expect(refusal).toMatchObject({ code: 'LEGAL_HOLD_ACTIVE', status: 409 });
      await releaseHold(holdId);
      await expect(asA((tx) => assertNotOnHold(tx, { type: 'report_revision', id: FOREIGN_RESOURCE }))).resolves.toBeUndefined();
    });
  });

  describe('the database trigger behind every purge path', () => {
    async function insertExpiredRecord(resourceId: string | null): Promise<string> {
      const recordId = randomUUID();
      await harness.owner(TENANT_A, [
        [
          `insert into machvon.idempotency_record
             (tenant_id, id, subject_id, operation, key_hash, request_hash, response_ref, status, expires_at, created_at, resource_type, resource_id)
           values ($1, $2, $3, 'createWidget', $4, $5, '{}'::jsonb, 'COMPLETED', now() - interval '1 day', now() - interval '5 days', 'widget', $6)`,
          [TENANT_A, recordId, PLACER, randomUUID().replaceAll('-', '').padEnd(64, '0'), 'a'.repeat(64), resourceId],
        ],
      ]);
      return recordId;
    }

    it('refuses to delete a record of a held resource with a dedicated SQLSTATE, as the owner as well as the application role (AC-ST-ADM-003-1)', async () => {
      const recordId = await insertExpiredRecord(FOREIGN_RESOURCE);
      await place('RESOURCE', [FOREIGN_RESOURCE]);
      const byApp = await asA((tx) => tx.query('delete from machvon.idempotency_record where id = $1', [recordId])).catch((error: unknown) => error);
      expect(byApp).toMatchObject({ code: LEGAL_HOLD_SQLSTATE });
      expect(asLegalHoldViolation(byApp)).toMatchObject({ code: 'LEGAL_HOLD_ACTIVE', status: 409 });
      const byOwner = await harness.owner(TENANT_A, [['delete from machvon.idempotency_record where id = $1', [recordId]]]).catch((error: unknown) => error);
      expect(byOwner).toMatchObject({ code: LEGAL_HOLD_SQLSTATE });
    });

    it('lets the delete through once the hold is released, and for resources the hold does not contain', async () => {
      const held = await insertExpiredRecord(FOREIGN_RESOURCE);
      const free = await insertExpiredRecord(id(0x70, 2));
      const holdId = await place('RESOURCE', [FOREIGN_RESOURCE]);
      await expect(asA((tx) => tx.query('delete from machvon.idempotency_record where id = $1', [free]))).resolves.toBeDefined();
      await releaseHold(holdId);
      await expect(asA((tx) => tx.query('delete from machvon.idempotency_record where id = $1', [held]))).resolves.toBeDefined();
    });

    async function seedRowsWithoutResource(): Promise<void> {
      const admin = new Client({ connectionString: harness.database.adminUrl });
      await admin.connect();
      try {
        await admin.query('set session_replication_role = replica');
        await admin.query(
          `insert into machvon.outbox_event (tenant_id, id, aggregate_id, type, schema_version, payload, created_at, aggregate_type, aggregate_version, event_key, correlation_id)
           values ($1, $2, $3, 'T', 1, '{}', now(), 'widget', 1, $4, $5)`,
          [TENANT_A, randomUUID(), id(0x70, 5), `key-${randomUUID()}`, randomUUID()],
        );
        await admin.query(
          `insert into machvon.user_session (tenant_id, id, user_account_id, membership_id, idp_session_id, assurance_level, ip_hash, user_agent_summary)
           values ($1, $2, $3, $4, $5, 'aal1', repeat('a', 64), 'agent')`,
          [TENANT_A, randomUUID(), id(0x60, 1), PLACER, `idp-${randomUUID()}`],
        );
        await admin.query(
          `insert into machvon.integration_event_inbox (tenant_id, id, provider, event_key, payload_hash, payload_reference, received_at, status, signature_key_id)
           values ($1, $2, 'provider', $3, repeat('b', 64), 'ref', now(), 'PROCESSED', 'key')`,
          [TENANT_A, randomUUID(), `event-${randomUUID()}`],
        );
        await admin.query(
          `insert into machvon.delivery_attempt (tenant_id, id, notification_id, channel_account_id, attempt_no, status, cost, channel, template_version_id)
           values ($1, $2, $3, $4, 1, 'Delivered', 0, 'EMAIL', $5)`,
          [TENANT_A, randomUUID(), randomUUID(), randomUUID(), randomUUID()],
        );
      } finally {
        await admin.end();
      }
    }

    it('lets a tenant hold stop the purge of every technical table, including rows with no resource (AC-ST-ADM-003-2)', async () => {
      const recordId = await insertExpiredRecord(null);
      await seedRowsWithoutResource();
      await place('TENANT');
      const refusal = await asA((tx) => tx.query('delete from machvon.idempotency_record where id = $1', [recordId])).catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: LEGAL_HOLD_SQLSTATE });
      for (const table of ['outbox_event', 'user_session', 'integration_event_inbox', 'delivery_attempt']) {
        const attempt = await asA((tx) => tx.query(`delete from machvon.${table}`, [])).catch((error: unknown) => error);
        expect({ table, code: (attempt as { code?: string }).code }).toEqual({ table, code: LEGAL_HOLD_SQLSTATE });
      }
    });

    it('lets those tables be purged again once the tenant hold is released', async () => {
      await seedRowsWithoutResource();
      const holdId = await place('TENANT');
      await releaseHold(holdId);
      await expect(asA((tx) => tx.query('delete from machvon.user_session', []))).resolves.toBeDefined();
    });

    it('guards an outbox event through its aggregate and the audit table through its resource', async () => {
      const aggregate = id(0x70, 3);
      await asA((tx) =>
        tx.query(
          `insert into machvon.outbox_event (tenant_id, id, aggregate_id, type, schema_version, payload, created_at, aggregate_type, aggregate_version, event_key, correlation_id)
           values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, 'T', 1, '{}', now(), 'widget', 1, $3, $4)`,
          [randomUUID(), aggregate, `key-${randomUUID()}`, randomUUID()],
        ),
      );
      await place('RESOURCE', [aggregate]);
      const outbox = await asA((tx) => tx.query('delete from machvon.outbox_event where aggregate_id = $1', [aggregate])).catch((error: unknown) => error);
      expect(outbox).toMatchObject({ code: LEGAL_HOLD_SQLSTATE });
      await harness.owner(TENANT_A, [
        [
          `insert into machvon.audit_event (tenant_id, id, actor_id, action, resource_type, resource_id, safe_diff, correlation_id, request_id, occurred_at)
           values ($1, $2, $3, 'x', 'widget', $4, '{}', $5, $5, now())`,
          [TENANT_A, randomUUID(), PLACER, aggregate, randomUUID()],
        ],
      ]);
      const audit = await harness.owner(TENANT_A, [['delete from machvon.audit_event where resource_id = $1', [aggregate]]]).catch((error: unknown) => error);
      expect(audit).toMatchObject({ code: LEGAL_HOLD_SQLSTATE });
    });

    it('purges expired idempotency records except those of held resources, without failing the batch (AC-ST-ADM-003-2)', async () => {
      const heldRecord = await insertExpiredRecord(FOREIGN_RESOURCE);
      const freeRecord = await insertExpiredRecord(id(0x70, 4));
      await place('RESOURCE', [FOREIGN_RESOURCE]);
      const removed = await new IdempotencyStore(harness.tenants).purgeExpired(ctxA);
      expect(removed).toBeGreaterThanOrEqual(1);
      const left = await harness.owner<{ id: string }>(TENANT_A, [['select id from machvon.idempotency_record where id = any($1::uuid[])', [[heldRecord, freeRecord]]]]);
      expect(left.map((row) => row.id)).toEqual([heldRecord]);
    });
  });

  describe('placing and releasing', () => {
    it('stores an Active hold with its scope, authority reference and the person who placed it', async () => {
      const holdId = await place('UNIT', [unitId(2)]);
      const hold = await asA((tx) => store.find(tx, holdId));
      expect(hold).toMatchObject({
        id: holdId,
        holdKind: 'INSPECTION',
        status: 'Active',
        scope: { kind: 'UNIT', ids: [unitId(2)] },
        authorityReference: 'Decision 12/QD-TTCP',
        placedBy: PLACER,
        releasedBy: null,
        version: 1,
      });
    });

    it('refuses a release by the person who placed the hold, in the store and in the database (AC-ST-ADM-003-1)', async () => {
      const holdId = await place('TENANT');
      const refusal = await releaseHold(holdId, PLACER).catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: 'SELF_APPROVAL_DENIED', status: 403 });
      const bypass = await harness
        .owner(TENANT_A, [
          ["update machvon.legal_hold set status = 'Released', released_at = now(), released_by = placed_by, release_reason = 'a reason that is long enough' where id = $1", [holdId]],
        ])
        .catch((error: unknown) => error);
      expect(bypass).toMatchObject({ code: '23514' });
    });

    it('refuses a release with a reason shorter than ten characters, in the database too', async () => {
      const holdId = await place('TENANT');
      const bypass = await harness
        .owner(TENANT_A, [["update machvon.legal_hold set status = 'Released', released_at = now(), released_by = $2, release_reason = 'short' where id = $1", [holdId, RELEASER]]])
        .catch((error: unknown) => error);
      expect(bypass).toMatchObject({ code: '23514' });
    });

    it('releases once: the second release is LEGAL_HOLD_STATE_INVALID, a stale version is VERSION_CONFLICT', async () => {
      const holdId = await place('TENANT');
      await expect(asA((tx) => store.lock(tx, holdId, 7))).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
      await releaseHold(holdId);
      const released = await asA((tx) => store.find(tx, holdId));
      expect(released).toMatchObject({ status: 'Released', releasedBy: RELEASER, releaseReason: 'Inspection closed by decision', version: 2 });
      expect(released?.releasedAt).not.toBeNull();
      await expect(asA((tx) => store.lock(tx, holdId, 2))).rejects.toMatchObject({ code: 'LEGAL_HOLD_STATE_INVALID', status: 409 });
    });

    it('answers RESOURCE_NOT_FOUND for a hold of another tenant', async () => {
      const holdId = await place('TENANT');
      expect(await harness.tenants.withTenant(ctxB, (tx) => store.find(tx, holdId))).toBeUndefined();
      await expect(harness.tenants.withTenant(ctxB, (tx) => store.lock(tx, holdId, 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('never lets the application role delete or truncate a hold, which are kept for good', async () => {
      const holdId = await place('TENANT');
      const deletion = await asA((tx) => tx.query('delete from machvon.legal_hold where id = $1', [holdId])).catch((error: unknown) => error);
      expect(deletion).toMatchObject({ code: '42501' });
    });

    it('pages holds with the active ones first and refuses a cursor it did not issue', async () => {
      const first = await place('TENANT');
      const second = await place('RESOURCE', [FOREIGN_RESOURCE]);
      await releaseHold(first);
      const page = await asA((tx) => store.list(tx, { limit: 1, after: undefined }));
      expect(page.map((row) => row.id)).toEqual([second]);
      const rest = await asA((tx) => store.list(tx, { limit: 5, after: { code: 'Active', id: second } }));
      expect(rest.map((row) => row.id)).toEqual([first]);
      await expect(asA((tx) => store.list(tx, { limit: 5, after: { code: 'nonsense', id: second } }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('resolves the owner units of the ids a hold names and reports ids that do not exist', async () => {
      const resolved = await asA((tx) =>
        store.resolveScopeRefs(tx, { kind: 'PROJECT', ids: [PROJECT_IN_U2, PROJECT_IN_U5] }),
      );
      expect(resolved).toEqual([
        { id: PROJECT_IN_U2, ownerUnitId: unitId(2), ownerUnitPath: path(1, 2), projectId: PROJECT_IN_U2 },
        { id: PROJECT_IN_U5, ownerUnitId: unitId(5), ownerUnitPath: path(1, 5), projectId: PROJECT_IN_U5 },
      ]);
      const contracts = await asA((tx) => store.resolveScopeRefs(tx, { kind: 'CONTRACT', ids: [CONTRACT_IN_U2] }));
      expect(contracts).toEqual([{ id: CONTRACT_IN_U2, ownerUnitId: unitId(2), ownerUnitPath: path(1, 2), projectId: PROJECT_IN_U2, contractId: CONTRACT_IN_U2 }]);
      const units = await asA((tx) => store.resolveScopeRefs(tx, { kind: 'UNIT', ids: [unitId(3)] }));
      expect(units).toEqual([{ id: unitId(3), ownerUnitId: unitId(3), ownerUnitPath: path(1, 2, 3) }]);
      await expect(asA((tx) => store.resolveScopeRefs(tx, { kind: 'PROJECT', ids: [id(0x70, 9)] }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(await asA((tx) => store.resolveScopeRefs(tx, { kind: 'RESOURCE', ids: [FOREIGN_RESOURCE] }))).toEqual([]);
      expect(await asA((tx) => store.resolveScopeRefs(tx, { kind: 'TENANT', ids: [] }))).toEqual([]);
    });
  });
});
