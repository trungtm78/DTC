/** Names of the fixture tenants in Design/MACHVON_Design/03_Engineering/test_fixtures.json. */
export type TenantName = 'TNT-A' | 'TNT-B';

export const TENANT_NAMES: readonly TenantName[] = ['TNT-A', 'TNT-B'];

// The fixture tenants are names, not UUIDs, so fixed UUIDs stand in for them.
export const TENANT_IDS: Readonly<Record<TenantName, string>> = {
  'TNT-A': '00000000-0000-4000-8000-00000000000a',
  'TNT-B': '00000000-0000-4000-8000-00000000000b',
};

export interface UnitFixture {
  id: string;
  code: string;
  name: string;
}

/** Synthetic organization units; the names are distinctive so a leak is easy to recognise. */
export const UNIT_FIXTURES: Readonly<Record<TenantName, readonly UnitFixture[]>> = {
  'TNT-A': [
    { id: '00000000-0000-4000-a001-000000000001', code: 'A-HQ', name: 'Sở Tài chính Alpha Đà Nẵng' },
    { id: '00000000-0000-4000-a001-000000000002', code: 'A-OPS', name: 'Phòng Vận hành Alpha' },
    { id: '00000000-0000-4000-a001-000000000003', code: 'A-AUD', name: 'Ban Kiểm toán Alpha' },
  ],
  'TNT-B': [
    { id: '00000000-0000-4000-b002-000000000001', code: 'B-HQ', name: 'Văn phòng Bí mật Beta Huế' },
    { id: '00000000-0000-4000-b002-000000000002', code: 'B-OPS', name: 'Phòng Dự án Beta' },
  ],
};

/**
 * One way of reading another tenant's data (API, database, later search, file, export, sync).
 * `readAs` makes the user of tenant `user` request the first organization unit of tenant `target`.
 * `listAs`, when present, lists every organization unit the user can see.
 */
export interface IsolationChannel {
  name: string;
  seed(tenant: TenantName): Promise<void>;
  readAs(user: 'TNT-A', target: 'TNT-B'): Promise<{ status: number; body: string }>;
  listAs?(user: 'TNT-A'): Promise<{ status: number; body: string }>;
}

export interface IsolationSuiteInput {
  channels: readonly IsolationChannel[];
  /** Implemented operations with a path parameter (see enumerateIdBearingOperations). */
  idBearingOperations: readonly string[];
  /** Operations that have a registered foreign-id case. */
  foreignIdCases: ReadonlySet<string>;
}

export interface IsolationReport {
  ok: boolean;
  /** Human-readable violations; they name the channel and the kind of data, never the data. */
  leaks: string[];
  /** Implemented id-bearing operations without a registered foreign-id case. */
  uncoveredOperations: string[];
}

/** Everything that identifies a tenant's data in a response body, grouped by kind. */
function markersOf(tenant: TenantName): Array<{ kind: string; value: string }> {
  const markers = [{ kind: 'tenant id', value: TENANT_IDS[tenant] }];
  for (const unit of UNIT_FIXTURES[tenant]) {
    markers.push({ kind: 'unit id', value: unit.id }, { kind: 'unit code', value: unit.code }, { kind: 'unit name', value: unit.name });
  }
  return markers;
}

function exposedKinds(body: string, tenant: TenantName): string[] {
  const haystack = body.toLowerCase();
  const kinds = markersOf(tenant)
    .filter((marker) => haystack.includes(marker.value.toLowerCase()))
    .map((marker) => marker.kind);
  return [...new Set(kinds)];
}

function foreignReadLeaks(channel: IsolationChannel, result: { status: number; body: string }): string[] {
  const leaks: string[] = [];
  if (result.status !== 404) leaks.push(`${channel.name}: foreign id read answered ${result.status} instead of 404`);
  for (const kind of exposedKinds(result.body, 'TNT-B')) leaks.push(`${channel.name}: foreign id read exposes a TNT-B ${kind}`);
  return leaks;
}

function listLeaks(channel: IsolationChannel, result: { status: number; body: string }): string[] {
  const leaks: string[] = [];
  if (result.status !== 200) leaks.push(`${channel.name}: list answered ${result.status} instead of 200`);
  for (const kind of exposedKinds(result.body, 'TNT-B')) leaks.push(`${channel.name}: list exposes a TNT-B ${kind}`);
  for (const unit of UNIT_FIXTURES['TNT-A']) {
    if (!result.body.includes(unit.name)) leaks.push(`${channel.name}: list misses own unit ${unit.code}`);
  }
  return leaks;
}

/**
 * Runs the isolation conformance checks (ST-KERNEL-026) over every channel: a TNT-A user asking for a
 * TNT-B object by id must get 404 with a body free of TNT-B data, and a list must hold TNT-A rows only.
 * It also requires a registered foreign-id case for every implemented id-bearing operation.
 * Violations are reported, never thrown, so a negative control can assert on them.
 */
export async function runIsolationSuite(input: IsolationSuiteInput): Promise<IsolationReport> {
  const leaks: string[] = [];
  for (const channel of input.channels) {
    for (const tenant of TENANT_NAMES) await channel.seed(tenant);
    leaks.push(...foreignReadLeaks(channel, await channel.readAs('TNT-A', 'TNT-B')));
    if (channel.listAs !== undefined) leaks.push(...listLeaks(channel, await channel.listAs('TNT-A')));
  }
  const uncoveredOperations = input.idBearingOperations.filter((operation) => !input.foreignIdCases.has(operation));
  return { ok: leaks.length === 0 && uncoveredOperations.length === 0, leaks, uncoveredOperations };
}
