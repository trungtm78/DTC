import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import type { TestDatabase } from './test-database.ts';

/** The synthetic fixtures of the design baseline: tenants, actors and expectations, no real vendor or personal record. */
export const FIXTURES_RELATIVE_PATH = 'Design/MACHVON_Design/03_Engineering/test_fixtures.json';
/** The secret that keeps masked values stable between refreshes and impossible to reverse; there is no built-in default. */
export const MASKING_KEY_ENV = 'MACHVON_MASKING_KEY';

const REGIONS = ['vn-north', 'vn-central', 'vn-south'];
const FAMILY_NAMES = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vu', 'Dang', 'Bui'];
const GIVEN_NAMES = ['An', 'Binh', 'Chi', 'Dung', 'Hanh', 'Khanh', 'Lan', 'Minh', 'Nam', 'Phuc'];
const MAX_CHILD_UNITS = 5;
const MIN_CHILD_UNITS = 2;
const MAX_UNIT_DEPTH = 3;
const MIN_USERS = 3;
const USER_SPREAD = 4;
const PHONE_PREFIX = '+840000';
const PLACEMENT_FAMILY = 'placement';

export interface SyntheticUnit {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
}

export interface SyntheticUser {
  id: string;
  idpSubject: string;
  email: string;
  displayName: string;
  phone: string;
}

export interface SyntheticMembership {
  id: string;
  userId: string;
  organizationId: string;
  status: 'Active';
}

export interface SyntheticTenant {
  tenant: { id: string; code: string; name: string; region: string; placementId: string };
  units: SyntheticUnit[];
  users: SyntheticUser[];
  memberships: SyntheticMembership[];
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A version 4 shaped UUID derived from a label, so the same label is the same id on every run and every machine. */
function uuidOf(label: string): string {
  const hex = sha256(label);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A deterministic stream of numbers: the n-th draw of a seed is always the same. */
class Draws {
  private counter = 0;

  constructor(private readonly seed: string) {}

  /** An integer in [0, bound). */
  next(bound: number): number {
    const digest = createHash('sha256').update(`${this.seed}:${this.counter}`).digest();
    this.counter += 1;
    return digest.readUInt32BE(0) % bound;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.next(items.length)] as T;
  }
}

function syntheticUnits(seed: string, draws: Draws): SyntheticUnit[] {
  const units: SyntheticUnit[] = [];
  const rootId = uuidOf(`${seed}:unit:0`);
  units.push({ id: rootId, code: 'U0', name: 'Unit 0', parentId: null, path: `/${rootId}/`, depth: 0 });
  const children = MIN_CHILD_UNITS + draws.next(MAX_CHILD_UNITS - MIN_CHILD_UNITS + 1);
  for (let index = 1; index <= children; index += 1) {
    const candidates = units.filter((unit) => unit.depth < MAX_UNIT_DEPTH);
    const parent = draws.pick(candidates);
    const id = uuidOf(`${seed}:unit:${index}`);
    units.push({ id, code: `U${index}`, name: `Unit ${index}`, parentId: parent.id, path: `${parent.path}${id}/`, depth: parent.depth + 1 });
  }
  return units;
}

const digitsOf = (hex: string, count: number): string => {
  let digits = '';
  for (let index = 0; digits.length < count; index += 1) digits += String(parseInt(hex.slice(index * 2, index * 2 + 2), 16) % 10);
  return digits;
};

function syntheticUsers(seed: string, draws: Draws, actors: readonly string[] | undefined): SyntheticUser[] {
  const count = actors?.length ?? MIN_USERS + draws.next(USER_SPREAD);
  return Array.from({ length: count }, (_unused, index) => {
    const label = actors?.[index];
    const hex = sha256(`${seed}:user:${index}`);
    const slug = label === undefined ? `user-${hex.slice(0, 8)}` : label.toLowerCase();
    return {
      id: uuidOf(`${seed}:user:${index}`),
      idpSubject: `synthetic:${seed}:${index}`,
      email: `${slug}@example.test`,
      displayName: label ?? `${draws.pick(FAMILY_NAMES)} Van ${draws.pick(GIVEN_NAMES)}`,
      phone: `${PHONE_PREFIX}${digitsOf(hex, 6)}`,
    };
  });
}

/**
 * A complete, deterministic tenant: the same seed always gives the same ids, codes, organisation tree and people, and
 * another seed another tenant. Everything in it is synthetic (example addresses, a phone number that cannot be
 * dialled), so it is safe to load anywhere. `actors` names the people (one per name); `code` overrides the generated one.
 */
export function syntheticTenant(seed: string, options: { code?: string; actors?: readonly string[] } = {}): SyntheticTenant {
  const draws = new Draws(seed);
  const hex = sha256(`${seed}:tenant`);
  const units = syntheticUnits(seed, draws);
  const users = syntheticUsers(seed, draws, options.actors);
  const tenantId = uuidOf(`${seed}:tenant`);
  return {
    tenant: {
      id: tenantId,
      code: options.code ?? `SYN-${hex.slice(0, 6).toUpperCase()}`,
      name: options.code === undefined ? `Synthetic tenant ${hex.slice(0, 6)}` : `Fixture ${options.code}`,
      region: draws.pick(REGIONS),
      placementId: uuidOf(PLACEMENT_FAMILY),
    },
    units,
    users,
    memberships: users.map((user, index) => ({
      id: uuidOf(`${seed}:member:${index}`),
      userId: user.id,
      organizationId: (units[index % units.length] as SyntheticUnit).id,
      status: 'Active' as const,
    })),
  };
}

/** Runs `work` with a superuser connection to the database (row level security does not apply to it). */
async function withAdmin<T>(database: Pick<TestDatabase, 'adminUrl'>, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: database.adminUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Inserts a synthetic tenant; rows that exist already are left as they are, so loading is repeatable. */
export async function loadSyntheticTenant(database: Pick<TestDatabase, 'adminUrl'>, data: SyntheticTenant): Promise<void> {
  const { tenant } = data;
  await withAdmin(database, async (client) => {
    await client.query('begin');
    try {
      await client.query(
        `insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status)
         values ($1, 'POOL', $2, 'synthetic-cluster', 'synthetic-kms', 'Active') on conflict do nothing`,
        [tenant.placementId, tenant.region],
      );
      await client.query(
        `insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, $2, $3, 'Active', $4, $5) on conflict do nothing`,
        [tenant.id, tenant.code, tenant.name, tenant.placementId, tenant.region],
      );
      await client.query("select set_config('app.tenant_id', $1, true)", [tenant.id]);
      for (const unit of data.units) {
        await client.query(
          `insert into machvon.organization_unit (tenant_id, id, code, name, parent_id, valid_from, path, depth)
           values ($1, $2, $3, $4, $5, date '2026-01-01', $6, $7) on conflict do nothing`,
          [tenant.id, unit.id, unit.code, unit.name, unit.parentId, unit.path, unit.depth],
        );
      }
      for (const user of data.users) {
        await client.query(
          `insert into machvon.user_account (id, idp_subject, email_normalized, display_name, phone_e164, status)
           values ($1, $2, $3, $4, $5, 'Active') on conflict do nothing`,
          [user.id, user.idpSubject, user.email, user.displayName, user.phone],
        );
      }
      for (const member of data.memberships) {
        await client.query(
          `insert into machvon.membership (tenant_id, id, user_id, organization_id, status, valid_from) values ($1, $2, $3, $4, $5, now()) on conflict do nothing`,
          [tenant.id, member.id, member.userId, member.organizationId, member.status],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}

interface FixtureFile {
  tenants: string[];
  actors: string[];
}

/** An actor `A-maker` belongs to the tenant `TNT-A`; actors without a tenant letter (`system-admin`) belong to the platform. */
const actorsOf = (tenantName: string, actors: readonly string[]): string[] => {
  const letter = /^TNT-(\w)$/.exec(tenantName)?.[1];
  return letter === undefined ? [] : actors.filter((actor) => actor.startsWith(`${letter}-`));
};

/**
 * Loads tenants of `test_fixtures.json` (by name) with their actors into a database of the shared test server and
 * returns what was loaded. A name that the file does not list is refused; loading the same name again changes nothing.
 */
export async function loadFixtures(database: Pick<TestDatabase, 'adminUrl'>, names: readonly string[], root: string): Promise<SyntheticTenant[]> {
  const file = JSON.parse(readFileSync(resolve(root, FIXTURES_RELATIVE_PATH), 'utf8')) as FixtureFile;
  const loaded: SyntheticTenant[] = [];
  for (const name of names) {
    if (!file.tenants.includes(name)) throw new Error(`UNKNOWN_FIXTURE: ${name}`);
    const data = syntheticTenant(name, { code: name, actors: actorsOf(name, file.actors) });
    await loadSyntheticTenant(database, data);
    loaded.push(data);
  }
  return loaded;
}

export type PersonalKind = 'name' | 'email' | 'phone' | 'identity' | 'account' | 'address' | 'text' | 'hash';

/**
 * How each personal column is replaced (table, then column). A column that the data dictionary classifies as PERSONAL, or
 * that is named like a person's contact or identity, must have an entry here or an exemption below; the test over the
 * dictionary fails otherwise, so a new personal column cannot reach a staging refresh unmasked.
 */
export const PERSONAL_COLUMNS: Readonly<Record<string, Readonly<Record<string, PersonalKind>>>> = {
  user_account: { email_normalized: 'email', display_name: 'name', phone_e164: 'phone' },
  contact: { display_name: 'name', phone_hash: 'hash', email_hash: 'hash' },
  membership_invitation: { email_hash: 'hash' },
  affected_household: { head_name: 'name', national_id_enc: 'identity', national_id_hash: 'hash', phone_enc: 'phone', address_text: 'address' },
  compensation_payment: { bank_account_enc: 'account' },
  land_complaint: { description: 'text' },
  qms_signature: { signer_name_snapshot: 'name' },
  document: { signer_name: 'name' },
};

/** Columns that look personal by name but are not a person's data; each states why. */
export const NOT_PERSONAL: Readonly<Record<string, string>> = {
  'land_parcel.address_text': 'the address of a parcel of land, not of a person',
  'channel_account.display_name': 'the name of an organisation channel account (an official page), not of a person',
  'lineage_node.display_name': 'the label of a node in the data lineage graph',
};

export interface DataDictionary {
  entities: Record<string, Record<string, unknown>>;
}

export interface PersonalColumn {
  table: string;
  column: string;
  type: string;
}

const PERSONAL_MARKER = /(?<!['\w])PERSONAL(?!['\w])/;
const PERSONAL_NAME = /email|phone|national_id|cccd|citizen|bank_account|head_name|signer_name|display_name|address_text|full_name/;
const REFERENCE_TYPE = /^uuid\b/;

/**
 * The columns of the data dictionary that hold a person's data: those whose description marks them PERSONAL (the word
 * outside a quoted CHECK list) and those named like contact or identity data. A uuid column is a reference to another
 * row and carries no personal value itself.
 */
export function personalColumnsOf(dictionary: DataDictionary): PersonalColumn[] {
  const found: PersonalColumn[] = [];
  for (const [table, columns] of Object.entries(dictionary.entities)) {
    for (const [column, definition] of Object.entries(columns)) {
      const type = typeof definition === 'string' ? definition : JSON.stringify(definition);
      if (REFERENCE_TYPE.test(type) || NOT_PERSONAL[`${table}.${column}`] !== undefined) continue;
      if (PERSONAL_MARKER.test(type) || PERSONAL_NAME.test(column)) found.push({ table, column, type });
    }
  }
  return found;
}

/** The personal columns of the dictionary that have no masking rule. */
export function unmaskedPersonalColumns(dictionary: DataDictionary, rules: Readonly<Record<string, Readonly<Record<string, PersonalKind>>>> = PERSONAL_COLUMNS): PersonalColumn[] {
  return personalColumnsOf(dictionary).filter(({ table, column }) => rules[table]?.[column] === undefined);
}

function pseudonym(kind: PersonalKind, value: string, key: string): string {
  const hex = createHmac('sha256', key).update(`${kind}\0${value}`).digest('hex');
  switch (kind) {
    case 'name':
      return `Person ${hex.slice(0, 8)}`;
    case 'email':
      return `masked-${hex.slice(0, 16)}@example.invalid`;
    case 'phone':
      return `${PHONE_PREFIX}${digitsOf(hex, 6)}`;
    case 'identity':
      return digitsOf(hex, 12);
    case 'account':
      return digitsOf(hex, 10);
    case 'address':
      return `Masked address ${hex.slice(0, 8)}`;
    case 'text':
      return `[masked text ${hex.slice(0, 8)}]`;
    case 'hash':
      return hex;
  }
}

/**
 * Replaces the personal fields of a row by stable pseudonyms (HMAC of the value under a secret key, so the same value is
 * the same pseudonym on every refresh and nobody without the key can recover or confirm the value). Other fields and
 * null values are returned as they are; the input row is not changed. Without a key (option or `MACHVON_MASKING_KEY`)
 * it throws instead of masking with a guessable default.
 */
export function maskRow<T extends Record<string, unknown>>(table: string, row: T, options: { key?: string } = {}): T {
  const key = options.key ?? process.env[MASKING_KEY_ENV];
  if (key === undefined || key === '') throw new Error(`${MASKING_KEY_ENV} is not set: refusing to mask without a secret key`);
  const rules = PERSONAL_COLUMNS[table];
  if (rules === undefined) return row;
  const masked: Record<string, unknown> = { ...row };
  for (const [column, kind] of Object.entries(rules)) {
    const value = masked[column];
    if (value === null || value === undefined) continue;
    if (Buffer.isBuffer(value)) masked[column] = Buffer.from(pseudonym(kind, value.toString('hex'), key), 'utf8');
    else masked[column] = pseudonym(kind, String(value), key);
  }
  return masked as T;
}
