import { randomUUID } from 'node:crypto';
import { DomainError, licenseStatusAt, signLicenseClaims, verifyLicenseToken, versionConflict } from '@machvon/kernel';
import type { LicenseClaims, LicenseSigner } from '@machvon/kernel';
import type { EntitlementStore } from './entitlement-store.ts';
import type { TenantTx } from './tenant-database.ts';

export type LicenseEdition = 'PILOT' | 'STANDARD' | 'ENTERPRISE' | 'PRIVATE';

/** The stored status of a revision (`license_revision_status_ck`); the time states are derived from it and the clock. */
export type LicenseStatus = 'Draft' | 'Issued' | 'Active' | 'Grace' | 'Expired' | 'Suspended' | 'Revoked' | 'Superseded';

export interface LicenseRow {
  id: string;
  tenantId: string;
  serial: string;
  revision: number;
  edition: LicenseEdition;
  status: LicenseStatus;
  validFrom: Date;
  validUntil: Date;
  graceUntil: Date;
  seats: number | null;
  quota: Record<string, unknown>;
  issuer: string;
  issuedBy: string | null;
  issuedAt: Date | null;
  statusReason: string | null;
  deploymentBinding: string | null;
  offlineLeaseUntil: Date | null;
  keyId: string;
  entitlementVersionId: string;
  supersedesId: string | null;
  version: number;
  /** The signed claims (a compact JWS): public by design, they carry no secret. Reads for the tenant plane leave them out. */
  signedClaims: string;
}

export interface IssueLicenseInput {
  tenantId: string;
  edition: LicenseEdition;
  validFrom: Date;
  validUntil: Date;
  graceUntil: Date;
  entitlementVersionId: string;
  seats?: number | undefined;
  quota?: Record<string, unknown> | undefined;
  deploymentBinding?: string | undefined;
  /** PRIVATE deployments only: the offline lease, up to 30 days from now and never past `graceUntil`. */
  offlineLeaseDays?: number | undefined;
  issuedBy: string;
  /** The tenant the command transaction acts as outside the hook (the platform tenant). */
  restoreTenantId: string;
}

export interface RevokeLicenseInput {
  licenseId: string;
  reason: string;
  expectedVersion: number;
  restoreTenantId: string;
}

export interface NewSigningKey {
  keyId: string;
  publicKeyPem: string;
  kmsKeyRef: string;
  notBefore: Date;
  notAfter: Date;
}

/** The ordering key of the last row of a page: revisions come back by serial and revision. */
export interface LicensePageAnchor {
  code: string;
  id: string;
}

export type SignatureCheck = 'VALID' | 'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'CLAIMS_MISMATCH';

const MAX_LEASE_DAYS = 30;
const MIN_REASON_LENGTH = 10;
const DAY_MS = 86_400_000;
/** The statuses a person may still end: a license that is already Revoked, Superseded, Expired or a draft is not revoked again. */
const REVOCABLE: readonly string[] = ['Issued', 'Active', 'Grace', 'Suspended'];

const COLUMNS = `id, tenant_id, serial, revision, edition, status, valid_from, valid_until, grace_until, seats, quota_json, issuer, issued_by,
  issued_at, status_reason, deployment_binding, offline_lease_until, key_id, entitlement_version_id, supersedes_id, version::text as version, signed_claims`;

interface Row {
  id: string;
  tenant_id: string;
  serial: string;
  revision: number;
  edition: LicenseEdition;
  status: LicenseStatus;
  valid_from: Date;
  valid_until: Date;
  grace_until: Date;
  seats: number | null;
  quota_json: Record<string, unknown>;
  issuer: string;
  issued_by: string | null;
  issued_at: Date | null;
  status_reason: string | null;
  deployment_binding: string | null;
  offline_lease_until: Date | null;
  key_id: string;
  entitlement_version_id: string;
  supersedes_id: string | null;
  version: string;
  signed_claims: string;
}

function toRow(row: Row): LicenseRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serial: row.serial,
    revision: row.revision,
    edition: row.edition,
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    graceUntil: row.grace_until,
    seats: row.seats,
    quota: row.quota_json,
    issuer: row.issuer,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    statusReason: row.status_reason,
    deploymentBinding: row.deployment_binding,
    offlineLeaseUntil: row.offline_lease_until,
    keyId: row.key_id,
    entitlementVersionId: row.entitlement_version_id,
    supersedesId: row.supersedes_id,
    version: Number(row.version),
    signedClaims: row.signed_claims,
  };
}

const rangeInvalid = (field: string): DomainError => new DomainError('LICENSE_RANGE_INVALID', 422, field);

const LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('license:' || current_setting('app.tenant_id'), 0))";
const TENANT_SQL = 'select status from machvon.tenant where id = $1::uuid for share';
const ENTITLEMENT_SQL = 'select entitlements_hash from machvon.entitlement_version where id = $1::uuid';
const OVERLAP_SQL = `select 1 from machvon.license_revision
  where status not in ('Draft', 'Revoked', 'Superseded') and valid_from < $2::timestamptz and valid_until > $1::timestamptz limit 1`;
const SERIAL_COUNT_SQL = 'select count(distinct serial)::int as n from machvon.license_revision';
const KEY_SQL = 'select status, not_before, not_after from machvon.license_signing_key where id = $1';
const INSERT_SQL = `insert into machvon.license_revision
    (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id,
     edition, seats, quota_json, issuer, issued_by, issued_at, deployment_binding, offline_lease_until, version)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, 1, $3, $4, $5, $6, 'Issued', $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, 1)
  returning ${COLUMNS}`;
const LOCATE_SQL = 'select machvon.license_tenant_of($1::uuid) as tenant_id';
const LOCK_ROW_SQL = `select ${COLUMNS} from machvon.license_revision where id = $1::uuid for update`;
const REVOKE_SQL = `update machvon.license_revision set status = 'Revoked', status_reason = $2, version = version + 1
  where id = $1::uuid returning ${COLUMNS}`;
const REGISTER_KEY_SQL = `insert into machvon.license_signing_key (id, algorithm, public_key_pem, kms_key_ref, status, not_before, not_after)
  values ($1, 'EdDSA', $2, $3, 'Active', $4, $5) on conflict (id) do nothing returning id`;

async function actAs(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

// The window of BR-SAS-11: valid_from < valid_until <= grace_until, and a license that has already ended is no license to issue.
function assertWindow(input: IssueLicenseInput, now: Date): void {
  if (!(input.validFrom.getTime() < input.validUntil.getTime())) throw rangeInvalid('valid_until');
  if (input.graceUntil.getTime() < input.validUntil.getTime()) throw rangeInvalid('grace_until');
  if (input.validUntil.getTime() <= now.getTime()) throw rangeInvalid('valid_until');
  if (input.seats !== undefined && (!Number.isInteger(input.seats) || input.seats < 1)) throw new DomainError('VALIDATION_FAILED', 422, 'seats');
}

// An offline lease belongs to a private deployment, lasts up to 30 days and never outlives the grace period (the table checks the same).
function leaseUntil(input: IssueLicenseInput, now: Date): Date | null {
  const days = input.offlineLeaseDays;
  if (days === undefined || days === 0) return null;
  if (input.edition !== 'PRIVATE' || !Number.isInteger(days) || days < 0 || days > MAX_LEASE_DAYS) throw rangeInvalid('offline_lease_days');
  const until = new Date(now.getTime() + days * DAY_MS);
  if (until.getTime() > input.graceUntil.getTime()) throw rangeInvalid('offline_lease_days');
  return until;
}

const serialOf = (now: Date, ordinal: number): string => `LIC-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(ordinal).padStart(4, '0')}`;

/**
 * Licenses of the control plane (ST-SAS-003): issue, revoke, read and check the signature. Every change runs inside the
 * transaction of a control command acting as the tenant of the license; the signed claims come from a `LicenseSigner`
 * (a KMS, an HSM or a key from the environment) that signs and never exports its key. Each change records a new
 * entitlement version, so `sas.entitlement.changed.v1` tells every session of the tenant (SAS 3.4).
 */
export class LicenseStore {
  constructor(private readonly entitlements: EntitlementStore) {}

  /** Registers the public key of a signing key as Active; a key id that is already registered is left as it is (returns false). */
  async registerSigningKey(tx: TenantTx, key: NewSigningKey): Promise<boolean> {
    const inserted = await tx.query(REGISTER_KEY_SQL, [key.keyId, key.publicKeyPem, key.kmsKeyRef, key.notBefore, key.notAfter]);
    return inserted.length > 0;
  }

  /**
   * Issues revision 1 of a license: checks the window, the tenant, the entitlement version, the overlap with the other
   * revisions and the signing key, then signs and stores it as `Issued`. `signerOf` is called last, so a missing key
   * never hides a refusal that does not depend on it. `whileActing` runs while the transaction acts as the tenant (audit
   * row and events).
   */
  async issue(
    tx: TenantTx,
    input: IssueLicenseInput,
    signerOf: () => Promise<LicenseSigner>,
    whileActing: (license: LicenseRow) => Promise<void>,
    now: Date = new Date(),
  ): Promise<LicenseRow> {
    assertWindow(input, now);
    const lease = leaseUntil(input, now);
    await actAs(tx, input.tenantId);
    await tx.query(LOCK_SQL);
    const [tenant] = await tx.query<{ status: string }>(TENANT_SQL, [input.tenantId]);
    if (tenant === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (tenant.status === 'Requested' || tenant.status === 'Archived') throw new DomainError('TENANT_STATE_INVALID', 409, `${tenant.status}->license`);
    // The tenant boundary hides the versions of other tenants, so a version that is not the tenant's is not found: the same refusal.
    const [version] = await tx.query<{ entitlements_hash: string }>(ENTITLEMENT_SQL, [input.entitlementVersionId]);
    if (version === undefined) throw new DomainError('LICENSE_TENANT_MISMATCH', 422, 'entitlement_version_id');
    if ((await tx.query(OVERLAP_SQL, [input.validFrom, input.validUntil])).length > 0) throw rangeInvalid('valid_from');

    const signer = await signerOf();
    const [key] = await tx.query<{ status: string; not_before: Date; not_after: Date }>(KEY_SQL, [signer.keyId]);
    if (key === undefined || key.status !== 'Active' || now.getTime() < key.not_before.getTime() || now.getTime() >= key.not_after.getTime()) {
      throw new DomainError('SIGNING_KEY_UNAVAILABLE', 503);
    }

    const [{ n } = { n: 0 }] = await tx.query<{ n: number }>(SERIAL_COUNT_SQL);
    const id = randomUUID();
    const serial = serialOf(now, n + 1);
    const claims: LicenseClaims = {
      iss: 'machvon-platform',
      tenant_id: input.tenantId,
      license_id: id,
      serial,
      revision: 1,
      edition: input.edition,
      valid_from: input.validFrom.toISOString(),
      valid_until: input.validUntil.toISOString(),
      grace_until: input.graceUntil.toISOString(),
      entitlements_hash: version.entitlements_hash,
      seats: input.seats ?? null,
      quota: input.quota ?? {},
      ...(input.deploymentBinding === undefined ? {} : { deployment_binding: input.deploymentBinding }),
      ...(lease === null ? {} : { offline_lease_until: lease.toISOString() }),
      kid: signer.keyId,
    };
    const signedClaims = await signLicenseClaims(claims, signer);
    const [stored] = await tx.query<Row>(INSERT_SQL, [
      id,
      serial,
      input.entitlementVersionId,
      input.validFrom,
      input.validUntil,
      input.graceUntil,
      signedClaims,
      signer.keyId,
      input.edition,
      input.seats ?? null,
      JSON.stringify(input.quota ?? {}),
      claims.iss,
      input.issuedBy,
      now,
      input.deploymentBinding ?? null,
      lease,
    ]);
    if (stored === undefined) throw new Error('license revision was not stored');
    const license = toRow(stored);
    await this.entitlements.recordCurrent(tx, 'LICENSE_CHANGE');
    await whileActing(license);
    await actAs(tx, input.restoreTenantId);
    return license;
  }

  /**
   * Ends a license for good (BR-SAS-12: a revoked license never becomes valid again). The license is found by its id alone;
   * the row is locked, so two operators serialise; a stale version is 409 VERSION_CONFLICT and a license that is not live
   * any more is 409 LICENSE_STATE_INVALID.
   */
  async revoke(tx: TenantTx, input: RevokeLicenseInput, whileActing: (license: LicenseRow) => Promise<void>): Promise<LicenseRow> {
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) throw new DomainError('VALIDATION_FAILED', 422, 'reason');
    const [located] = await tx.query<{ tenant_id: string | null }>(LOCATE_SQL, [input.licenseId]);
    const tenantId = located?.tenant_id ?? undefined;
    if (tenantId === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    await actAs(tx, tenantId);
    await tx.query(LOCK_SQL);
    const [current] = await tx.query<Row>(LOCK_ROW_SQL, [input.licenseId]);
    if (current === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (Number(current.version) !== input.expectedVersion) throw versionConflict(Number(current.version));
    if (!REVOCABLE.includes(current.status)) throw new DomainError('LICENSE_STATE_INVALID', 409, `${current.status}->Revoked`);
    const [updated] = await tx.query<Row>(REVOKE_SQL, [input.licenseId, reason]);
    if (updated === undefined) throw new Error('license revision was not updated');
    const license = toRow(updated);
    await this.entitlements.recordCurrent(tx, 'LICENSE_CHANGE');
    await whileActing(license);
    await actAs(tx, input.restoreTenantId);
    return license;
  }

  /** One revision of the tenant of `tx`; another tenant's id is not found (row-level security). */
  async find(tx: TenantTx, id: string): Promise<LicenseRow | undefined> {
    const [row] = await tx.query<Row>(`select ${COLUMNS} from machvon.license_revision where id = $1::uuid`, [id]);
    return row === undefined ? undefined : toRow(row);
  }

  /** Keyset page by serial and revision. The caller asks for one more row than it shows. */
  async list(tx: TenantTx, request: { limit: number; after: LicensePageAnchor | undefined }): Promise<LicenseRow[]> {
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.license_revision
        where $1::uuid is null or (serial, revision) > (select serial, revision from machvon.license_revision where id = $1::uuid)
        order by serial, revision
        limit $2`,
      [request.after?.id ?? null, request.limit],
    );
    return rows.map(toRow);
  }

  /**
   * Whether the signature of a revision is true: it verifies with one of `publicKeys` (kid to SPKI DER bytes) and the
   * signed claims say what the row says (tenant, license, serial, revision, window and key), so a row that was edited
   * after it was signed no longer passes.
   */
  verifySignature(row: LicenseRow, publicKeys: ReadonlyMap<string, Uint8Array>): SignatureCheck {
    const result = verifyLicenseToken(row.signedClaims, publicKeys);
    if (!result.valid) return result.reason === 'TENANT_MISMATCH' ? 'CLAIMS_MISMATCH' : result.reason;
    const { claims } = result;
    const same =
      claims.tenant_id === row.tenantId &&
      claims.license_id === row.id &&
      claims.serial === row.serial &&
      claims.revision === row.revision &&
      claims.kid === row.keyId &&
      claims.edition === row.edition &&
      claims.valid_from === row.validFrom.toISOString() &&
      claims.valid_until === row.validUntil.toISOString() &&
      claims.grace_until === row.graceUntil.toISOString();
    return same ? 'VALID' : 'CLAIMS_MISMATCH';
  }

  /** The state of a revision at `now`: the stored label wins for a revocation, the clock decides the rest. */
  statusAt(row: LicenseRow, now: Date): ReturnType<typeof licenseStatusAt> {
    return licenseStatusAt({ validFrom: row.validFrom, validUntil: row.validUntil, graceUntil: row.graceUntil, status: row.status }, now);
  }
}
