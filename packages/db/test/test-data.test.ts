import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import type { TestDatabase } from '../src/test-database';
import {
  FIXTURES_RELATIVE_PATH,
  MASKING_KEY_ENV,
  PERSONAL_COLUMNS,
  PERSONAL_JSON_FIELDS,
  loadFixtures,
  loadSyntheticTenant,
  maskRow,
  personalColumnsOf,
  syntheticTenant,
  unmaskedPersonalColumns,
} from '../src/test-data';
import type { DataDictionary } from '../src/test-data';
import { REPO_ROOT } from './support/authz-fixtures';

const KEY = 'test-masking-key';
const DICTIONARY: DataDictionary = JSON.parse(readFileSync(resolve(REPO_ROOT, 'Design', 'MACHVON_Design', '03_Engineering', 'data_dictionary.json'), 'utf8')) as DataDictionary;

describe('synthetic tenants', () => {
  it('give the same rows for the same seed and different rows for another', () => {
    const first = syntheticTenant('seed-1');
    expect(syntheticTenant('seed-1')).toEqual(first);
    const other = syntheticTenant('seed-2');
    expect(other.tenant.id).not.toBe(first.tenant.id);
    expect(other.tenant.code).not.toBe(first.tenant.code);
    expect(other.users.map((user) => user.email)).not.toEqual(first.users.map((user) => user.email));
  });

  it('are a consistent organisation: one root, parents before children, paths that end in the unit, members in existing units', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const data = syntheticTenant(seed);
      expect(data.units.filter((unit) => unit.parentId === null)).toHaveLength(1);
      const byId = new Map(data.units.map((unit) => [unit.id, unit]));
      expect(byId.size).toBe(data.units.length);
      for (const unit of data.units) {
        const parent = unit.parentId === null ? undefined : byId.get(unit.parentId);
        if (unit.parentId !== null) expect(parent).toBeDefined();
        expect(unit.path).toBe(`${parent?.path ?? '/'}${unit.id}/`);
        expect(unit.depth).toBe(unit.path.split('/').length - 3);
        expect(unit.depth).toBeLessThanOrEqual(3);
      }
      expect(data.memberships).toHaveLength(data.users.length);
      for (const member of data.memberships) expect(byId.has(member.organizationId)).toBe(true);
      expect(new Set(data.users.map((user) => user.email)).size).toBe(data.users.length);
    }
  });

  it('carry no real personal data: example addresses, a phone number that cannot be dialled', () => {
    const data = syntheticTenant('seed-3');
    for (const user of data.users) {
      expect(user.email).toMatch(/@example\.test$/);
      expect(user.phone).toMatch(/^\+840000\d{6}$/);
    }
  });

  it('give actors whose labels sanitise to the same address distinct addresses', () => {
    const users = syntheticTenant('seed-z', { actors: ['maker+one', 'maker-one', 'Maker-One'] }).users;
    expect(new Set(users.map((user) => user.email)).size).toBe(3);
    expect(users.map((user) => user.displayName)).toEqual(['maker+one', 'maker-one', 'Maker-One']);
  });

  it('take the code and the actors of a named fixture', () => {
    const data = syntheticTenant('TNT-A', { code: 'TNT-A', actors: ['A-maker', 'A-reviewer'] });
    expect(data.tenant.code).toBe('TNT-A');
    expect(data.users.map((user) => user.displayName)).toEqual(['A-maker', 'A-reviewer']);
    expect(data.users.map((user) => user.email)).toEqual([expect.stringMatching(/^a-maker\.[0-9a-f]{8}@example\.test$/), expect.stringMatching(/^a-reviewer\.[0-9a-f]{8}@example\.test$/)]);
  });

  it('give two tenants that name the same actor different addresses, because an address is unique in the whole database', () => {
    const first = syntheticTenant('seed-x', { actors: ['maker', 'Checker One'] });
    const second = syntheticTenant('seed-y', { actors: ['maker', 'Checker One'] });
    const addresses = [...first.users, ...second.users].map((user) => user.email);
    expect(new Set(addresses).size).toBe(addresses.length);
    for (const address of addresses) expect(address).toMatch(/^[a-z0-9._-]+@example\.test$/);
    expect(syntheticTenant('seed-x', { actors: ['maker', 'Checker One'] }).users.map((user) => user.email)).toEqual(first.users.map((user) => user.email));
  });
});

describe('masking', () => {
  const person = { id: 'u1', email_normalized: 'real.person@gov.example', display_name: 'Tran Thi Real', phone_e164: '+84912345678', locale: 'vi-VN', idp_subject: 'sub-1' };

  it('replaces the personal fields of a row and leaves every other field alone', () => {
    const masked = maskRow('user_account', person, { key: KEY });
    expect(masked.id).toBe('u1');
    expect(masked.locale).toBe('vi-VN');
    expect(masked.idp_subject).toBe('sub-1');
    expect(masked.email_normalized).toMatch(/^masked-[0-9a-f]{16}@example\.invalid$/);
    expect(masked.display_name).toMatch(/^Person [0-9a-f]{8}$/);
    expect(masked.phone_e164).toMatch(/^\+840000\d{6}$/);
    expect(JSON.stringify(masked)).not.toMatch(/real\.person|Tran Thi|912345678/);
    expect(person.display_name).toBe('Tran Thi Real');
  });

  it('is stable: the same input and key give the same pseudonym, another key or another input another one', () => {
    expect(maskRow('user_account', person, { key: KEY })).toEqual(maskRow('user_account', { ...person }, { key: KEY }));
    expect(maskRow('user_account', person, { key: 'other-key' }).email_normalized).not.toBe(maskRow('user_account', person, { key: KEY }).email_normalized);
    expect(maskRow('user_account', { ...person, display_name: 'Someone Else' }, { key: KEY }).display_name).not.toBe(maskRow('user_account', person, { key: KEY }).display_name);
  });

  it('cannot be undone without the key: the pseudonym is not a plain hash of the value either', () => {
    const plain = createHash('sha256').update('Tran Thi Real').digest('hex');
    const masked = maskRow('user_account', person, { key: KEY });
    expect(String(masked.display_name)).not.toContain(plain.slice(0, 8));
    expect(maskRow('affected_household', { national_id_hash: 'a'.repeat(64) }, { key: KEY }).national_id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(maskRow('affected_household', { national_id_hash: 'a'.repeat(64) }, { key: KEY }).national_id_hash).not.toBe('a'.repeat(64));
  });

  it('keeps the shape of each kind: identity numbers and accounts are digits, binary columns stay binary, null stays null', () => {
    const household = maskRow(
      'affected_household',
      { head_name: 'Le Van Real', national_id_enc: Buffer.from('ciphertext'), phone_enc: Buffer.from('cipher2'), address_text: '1 Real Street', national_id_hash: 'b'.repeat(64) },
      { key: KEY },
    );
    expect(Buffer.isBuffer(household.national_id_enc)).toBe(true);
    expect(household.national_id_enc?.toString('utf8')).toMatch(/^\d{12}$/);
    expect(Buffer.isBuffer(household.phone_enc)).toBe(true);
    expect(household.address_text).toMatch(/^Masked address [0-9a-f]{8}$/);
    expect(maskRow('compensation_payment', { bank_account_enc: Buffer.from('acct') }, { key: KEY }).bank_account_enc?.toString('utf8')).toMatch(/^\d{10}$/);
    expect(maskRow('land_complaint', { description: 'a real complaint' }, { key: KEY }).description).toMatch(/^\[masked text [0-9a-f]{8}\]$/);
    expect(maskRow('user_account', { ...person, phone_e164: null }, { key: KEY }).phone_e164).toBeNull();
  });

  describe('personal values inside a JSON column', () => {
    const OWNER = 'first.owner@gov.example';
    const run = { id: 'r1', status: 'Running', steps_json: { _request: { initial_owner_email: OWNER, platform_subdomain: 'danang', root_unit_name: 'Sở Tài chính' }, ADMIN: { state: 'DONE' } } };

    it('masks the email of the first owner that the provisioning request keeps in steps_json, and nothing else of the run', () => {
      const masked = maskRow('tenant_provisioning_run', run, { key: KEY });
      expect(JSON.stringify(masked)).not.toContain(OWNER);
      expect((masked.steps_json._request as Record<string, unknown>).initial_owner_email).toMatch(/^masked-[0-9a-f]{16}@example\.invalid$/);
      expect(masked.steps_json._request).toMatchObject({ platform_subdomain: 'danang', root_unit_name: 'Sở Tài chính' });
      expect(masked.steps_json.ADMIN).toEqual({ state: 'DONE' });
      expect(masked.status).toBe('Running');
      expect(run.steps_json._request.initial_owner_email).toBe(OWNER);
    });

    it('gives the same pseudonym as the user account of that person, so the refreshed data still agrees with itself', () => {
      const account = maskRow('user_account', { email_normalized: OWNER }, { key: KEY });
      const masked = maskRow('tenant_provisioning_run', run, { key: KEY });
      expect((masked.steps_json._request as Record<string, unknown>).initial_owner_email).toBe(account.email_normalized);
    });

    it('masks the same value when the driver hands the JSON over as text, and leaves a run without a request alone', () => {
      const masked = maskRow('tenant_provisioning_run', { ...run, steps_json: JSON.stringify(run.steps_json) }, { key: KEY });
      expect(typeof masked.steps_json).toBe('string');
      expect(String(masked.steps_json)).not.toContain(OWNER);
      const bare = { id: 'r2', steps_json: { ADMIN: { state: 'DONE' } } };
      expect(maskRow('tenant_provisioning_run', bare, { key: KEY })).toEqual(bare);
      expect(maskRow('tenant_provisioning_run', { id: 'r3', steps_json: null }, { key: KEY })).toEqual({ id: 'r3', steps_json: null });
    });

    it('names only columns that exist in the dictionary', () => {
      for (const [table, columns] of Object.entries(PERSONAL_JSON_FIELDS)) {
        for (const column of Object.keys(columns)) expect(Object.keys(DICTIONARY.entities[table] ?? {})).toContain(column);
      }
    });
  });

  it('leaves a table without personal columns unchanged', () => {
    const row = { id: 'x', code: 'c', name: 'n' };
    expect(maskRow('organization_unit', row, { key: KEY })).toEqual(row);
  });

  it('fails closed without a key: nothing is masked with a built-in default', () => {
    const saved = process.env[MASKING_KEY_ENV];
    delete process.env[MASKING_KEY_ENV];
    try {
      expect(() => maskRow('user_account', person)).toThrow(MASKING_KEY_ENV);
      expect(() => maskRow('user_account', person, { key: '' })).toThrow(MASKING_KEY_ENV);
      process.env[MASKING_KEY_ENV] = KEY;
      expect(maskRow('user_account', person)).toEqual(maskRow('user_account', person, { key: KEY }));
    } finally {
      if (saved === undefined) delete process.env[MASKING_KEY_ENV];
      else process.env[MASKING_KEY_ENV] = saved;
    }
  });
});

describe('the data dictionary and the masking rules', () => {
  it('leaves no PERSONAL column of the dictionary unmasked', () => {
    const personal = personalColumnsOf(DICTIONARY);
    expect(personal.length).toBeGreaterThanOrEqual(10);
    expect(unmaskedPersonalColumns(DICTIONARY)).toEqual([]);
  });

  it('finds the columns that the dictionary marks as PERSONAL and the ones that look personal by name', () => {
    const found = personalColumnsOf(DICTIONARY).map((column) => `${column.table}.${column.column}`);
    expect(found).toEqual(
      expect.arrayContaining([
        'affected_household.head_name',
        'affected_household.national_id_enc',
        'compensation_payment.bank_account_enc',
        'land_complaint.description',
        'qms_signature.signer_name_snapshot',
        'user_account.email_normalized',
        'user_account.phone_e164',
        'user_account.display_name',
      ]),
    );
    // A CHECK list that merely names the classification, a reference to a document and a parcel address are not personal values.
    expect(found).not.toContain('channel_message.classification');
    expect(found).not.toContain('signing_certificate.kind');
    expect(found).not.toContain('household_parcel.title_document_version_id');
    expect(found).not.toContain('land_parcel.address_text');
  });

  it('names only columns that exist in the dictionary', () => {
    for (const [table, columns] of Object.entries(PERSONAL_COLUMNS)) {
      for (const column of Object.keys(columns)) expect(Object.keys(DICTIONARY.entities[table] ?? {})).toContain(column);
    }
  });

  it('reports a new column that is marked PERSONAL or looks personal and has no rule (negative control)', () => {
    const doctored: DataDictionary = {
      entities: {
        ...DICTIONARY.entities,
        guardian: { id: 'uuid PK', guardian_email: 'text NOT NULL', note: 'text NULL (PERSONAL — free text)', user_ref: 'uuid NOT NULL (PERSONAL)' },
      },
    };
    expect(unmaskedPersonalColumns(doctored).map((column) => `${column.table}.${column.column}`)).toEqual(['guardian.guardian_email', 'guardian.note']);
  });
});

describe('fixtures in a database of the shared test server', () => {
  let database: TestDatabase;
  let admin: Client;

  const countOf = async (sql: string, params: unknown[] = []): Promise<number> => Number((await admin.query<{ n: string }>(sql, params)).rows[0]?.n);

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    admin = new Client({ connectionString: database.adminUrl });
    await admin.connect();
  }, 180_000);

  afterAll(async () => {
    await admin?.end();
    if (database) await database.stop();
  }, 60_000);

  it('loads the tenants of test_fixtures.json with their actors, and loading again changes nothing (AC-ST-KERNEL-034-1)', async () => {
    const fixtureFile = JSON.parse(readFileSync(resolve(REPO_ROOT, FIXTURES_RELATIVE_PATH), 'utf8')) as { tenants: string[]; actors: string[] };
    expect(fixtureFile.tenants).toEqual(['TNT-A', 'TNT-B']);

    const loaded = await loadFixtures(database, ['TNT-A', 'TNT-B'], REPO_ROOT);
    expect(loaded.map((data) => data.tenant.code)).toEqual(['TNT-A', 'TNT-B']);
    const [a, b] = loaded;
    expect(a?.users.map((user) => user.displayName)).toEqual(['A-maker', 'A-reviewer', 'A-auditor', 'A-tenant-admin']);
    expect(b?.users.map((user) => user.displayName)).toEqual(['B-maker']);

    const snapshot = async (): Promise<number[]> => [
      await countOf("select count(*) as n from machvon.tenant where code in ('TNT-A','TNT-B')"),
      await countOf('select count(*) as n from machvon.organization_unit where tenant_id = $1', [a?.tenant.id]),
      await countOf('select count(*) as n from machvon.membership where tenant_id = $1', [a?.tenant.id]),
      await countOf('select count(*) as n from machvon.membership where tenant_id = $1', [b?.tenant.id]),
    ];
    const before = await snapshot();
    expect(before).toEqual([2, a?.units.length, 4, 1]);
    await loadFixtures(database, ['TNT-A', 'TNT-B'], REPO_ROOT);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses a name that test_fixtures.json does not list', async () => {
    await expect(loadFixtures(database, ['TNT-Z'], REPO_ROOT)).rejects.toThrow('UNKNOWN_FIXTURE: TNT-Z');
  });

  it('loads two synthetic tenants side by side; the same seed loaded twice does not duplicate rows', async () => {
    const one = syntheticTenant('load-1');
    const two = syntheticTenant('load-2');
    await loadSyntheticTenant(database, one);
    await loadSyntheticTenant(database, two);
    await loadSyntheticTenant(database, one);
    expect(await countOf('select count(*) as n from machvon.organization_unit where tenant_id = $1', [one.tenant.id])).toBe(one.units.length);
    expect(await countOf('select count(*) as n from machvon.membership where tenant_id = $1', [two.tenant.id])).toBe(two.users.length);
  });

  it('loads two tenants that name the same actors side by side (the address of an actor is unique in the database)', async () => {
    const one = syntheticTenant('twin-1', { actors: ['maker'] });
    const two = syntheticTenant('twin-2', { actors: ['maker'] });
    await loadSyntheticTenant(database, one);
    await loadSyntheticTenant(database, two);
    expect(await countOf('select count(*) as n from machvon.membership where tenant_id = $1', [two.tenant.id])).toBe(1);
    expect(await countOf('select count(*) as n from machvon.user_account where id = any($1::uuid[])', [[...one.users, ...two.users].map((user) => user.id)])).toBe(2);
  });

  it('masks the owner email that a provisioning run keeps, as read from the database (AC-ST-KERNEL-034-2)', async () => {
    const data = syntheticTenant('refresh-run');
    await loadSyntheticTenant(database, data);
    const owner = 'real.owner@gov.example';
    await admin.query("select set_config('app.tenant_id', $1, false)", [data.tenant.id]);
    await admin.query(
      `insert into machvon.tenant_provisioning_run (tenant_id, id, attempt, temporal_workflow_id, status, current_step, steps_json, requested_by)
       values ($1, gen_random_uuid(), 1, 'wf-refresh-run', 'Running', 'ADMIN', $2::jsonb, $3)`,
      [data.tenant.id, JSON.stringify({ _request: { plan_version_id: data.tenant.id, platform_subdomain: 'refresh', root_unit_name: 'Root', initial_owner_email: owner } }), data.users[0]?.id],
    );
    const rows = (await admin.query('select * from machvon.tenant_provisioning_run where tenant_id = $1', [data.tenant.id])).rows as Array<Record<string, unknown>>;
    expect(JSON.stringify(rows)).toContain(owner);
    const masked = rows.map((row) => maskRow('tenant_provisioning_run', row, { key: KEY }));
    expect(JSON.stringify(masked)).not.toContain(owner);
  });

  it('masks what a staging refresh would copy: no real personal value survives in the masked user accounts (AC-ST-KERNEL-034-2)', async () => {
    const data = syntheticTenant('refresh-1');
    await loadSyntheticTenant(database, data);
    const rows = (await admin.query('select * from machvon.user_account where id = any($1::uuid[])', [data.users.map((user) => user.id)])).rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(data.users.length);
    const masked = rows.map((row) => maskRow('user_account', row, { key: KEY }));
    const text = JSON.stringify(masked);
    for (const user of data.users) {
      expect(text).not.toContain(user.email);
      expect(text).not.toContain(user.displayName);
      expect(text).not.toContain(user.phone);
    }
    expect(masked.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(maskRow('user_account', rows[0] ?? {}, { key: KEY })).toEqual(masked[0]);
  });
});
