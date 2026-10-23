import { DomainError, versionConflict } from '@machvon/kernel';
import type { ParsedCertificate } from '@machvon/kernel';
import { assertTimestampCursor, timestampKey } from './keyset.ts';
import type { TenantTx } from './tenant-database.ts';

export type CertificateKind = 'PERSONAL' | 'ORGANIZATION';
export type CertificateStatus = 'Active' | 'Expired' | 'Revoked' | 'Suspended';

export interface NewCertificate {
  kind: CertificateKind;
  holderMembershipId?: string | undefined;
  organizationUnitId?: string | undefined;
  providerCode: string;
  parsed: ParsedCertificate;
}

export interface CertificateRow {
  id: string;
  kind: CertificateKind;
  holderMembershipId: string | null;
  organizationUnitId: string | null;
  serial: string;
  issuerDn: string;
  subjectDn: string;
  providerCode: string;
  validFrom: string;
  validUntil: string;
  fingerprintSha256: string;
  /** The stored status with the clock applied: an Active certificate past its end is reported Expired. */
  status: CertificateStatus;
  statusReason: string | null;
  registeredBy: string;
  version: number;
}

/** The ordering key of the last row of a page: certificates come back by the end of their validity, then by id. */
export interface CertificatePageAnchor {
  code: string;
  id: string;
}

interface Row {
  id: string;
  kind: CertificateKind;
  holder_membership_id: string | null;
  organization_unit_id: string | null;
  certificate_serial: string;
  issuer_dn: string;
  subject_dn: string;
  provider_code: string;
  valid_from: string;
  valid_until: string;
  fingerprint_sha256: string;
  status: CertificateStatus;
  status_reason: string | null;
  registered_by: string;
  version: string;
}

const UNIQUE_VIOLATION = '23505';

// The status of a certificate is the stored one, except that an Active certificate whose validity has ended reads as
// Expired right away: the daily job only makes the stored value catch up.
const COLUMNS = `id, kind, holder_membership_id, organization_unit_id, certificate_serial, issuer_dn, subject_dn, provider_code,
  ${timestampKey('valid_from')} as valid_from, ${timestampKey('valid_until')} as valid_until, fingerprint_sha256,
  case when status = 'Active' and valid_until <= now() then 'Expired' else status end as status,
  status_reason, registered_by, version::text as version`;

function toRow(row: Row): CertificateRow {
  return {
    id: row.id,
    kind: row.kind,
    holderMembershipId: row.holder_membership_id,
    organizationUnitId: row.organization_unit_id,
    serial: row.certificate_serial,
    issuerDn: row.issuer_dn,
    subjectDn: row.subject_dn,
    providerCode: row.provider_code,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    fingerprintSha256: row.fingerprint_sha256,
    status: row.status,
    statusReason: row.status_reason,
    registeredBy: row.registered_by,
    version: Number(row.version),
  };
}

/**
 * The signing certificate registry (ST-ADM-008, ADM 3.9). It holds public certificates only: identifiers, validity
 * and the SHA-256 fingerprint. Every query runs inside the caller's tenant transaction, so row-level security keeps
 * tenants apart.
 */
export class CertificateStore {
  /**
   * Registers a certificate as Active. The holder (a membership) or the organisation unit it belongs to must exist in
   * the tenant, and the fingerprint is unique per tenant (409 CERTIFICATE_DUPLICATE).
   */
  async register(tx: TenantTx, input: NewCertificate, registeredBy: string): Promise<{ id: string; version: number }> {
    const holder = input.kind === 'PERSONAL' ? input.holderMembershipId : undefined;
    const unit = input.kind === 'ORGANIZATION' ? input.organizationUnitId : undefined;
    if (input.kind === 'PERSONAL' && holder === undefined) throw new DomainError('VALIDATION_FAILED', 422, 'holder_membership_id');
    if (input.kind === 'ORGANIZATION' && unit === undefined) throw new DomainError('VALIDATION_FAILED', 422, 'organization_unit_id');
    if (holder !== undefined) await this.assertExists(tx, 'membership', holder, 'holder_membership_id');
    if (unit !== undefined) await this.assertExists(tx, 'organization_unit', unit, 'organization_unit_id');
    const { parsed } = input;
    // A duplicate is answered without touching the unique index, so the transaction is not left aborted by it.
    const existing = await tx.query<{ id: string }>('select id from machvon.signing_certificate where fingerprint_sha256 = $1', [parsed.fingerprintSha256]);
    if (existing.length > 0) throw new DomainError('CERTIFICATE_DUPLICATE', 409);
    try {
      const rows = await tx.query<{ id: string }>(
        `insert into machvon.signing_certificate
           (tenant_id, id, kind, holder_membership_id, organization_unit_id, certificate_serial, issuer_dn, subject_dn, provider_code,
            valid_from, valid_until, fingerprint_sha256, status, registered_by, version)
         values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1, $2::uuid, $3::uuid, $4, $5, $6, $7,
            $8::timestamptz, $9::timestamptz, $10, 'Active', $11::uuid, 1)
         returning id`,
        [input.kind, holder ?? null, unit ?? null, parsed.serial, parsed.issuerDn, parsed.subjectDn, input.providerCode, parsed.validFrom.toISOString(), parsed.validUntil.toISOString(), parsed.fingerprintSha256, registeredBy],
      );
      return { id: (rows[0] as { id: string }).id, version: 1 };
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new DomainError('CERTIFICATE_DUPLICATE', 409);
      throw error;
    }
  }

  private async assertExists(tx: TenantTx, table: 'membership' | 'organization_unit', id: string, field: string): Promise<void> {
    const rows = await tx.query<{ id: string }>(`select id from machvon.${table} where id = $1::uuid`, [id]);
    if (rows.length === 0) throw new DomainError('VALIDATION_FAILED', 422, field);
  }

  async find(tx: TenantTx, id: string): Promise<CertificateRow | undefined> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.signing_certificate where id = $1::uuid`, [id]);
    return rows[0] === undefined ? undefined : toRow(rows[0]);
  }

  /** Keyset page: the certificates that end soonest first. The caller asks for one more row than it shows. */
  async list(tx: TenantTx, request: { limit: number; after: CertificatePageAnchor | undefined }): Promise<CertificateRow[]> {
    const { after } = request;
    assertTimestampCursor(after?.code);
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.signing_certificate
        where ($1::text is null or (${timestampKey('valid_until')}, id) > ($1::text, $2::uuid))
        order by valid_until, id
        limit $3`,
      [after?.code ?? null, after?.id ?? null, request.limit],
    );
    return rows.map(toRow);
  }

  /**
   * Locks a certificate for revocation. One that is not there is 404, one already revoked is 409
   * STAGE_TRANSITION_DENIED (a revocation is final, whatever the version sent), a stale version is 409 VERSION_CONFLICT.
   */
  async lock(tx: TenantTx, id: string, expectedVersion: number): Promise<CertificateRow> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.signing_certificate where id = $1::uuid for update`, [id]);
    const certificate = rows[0] === undefined ? undefined : toRow(rows[0]);
    if (certificate === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (certificate.status === 'Revoked') throw new DomainError('STAGE_TRANSITION_DENIED', 409);
    if (certificate.version !== expectedVersion) throw versionConflict(certificate.version);
    return certificate;
  }

  async revoke(tx: TenantTx, certificate: CertificateRow, reason: string): Promise<{ version: number }> {
    const rows = await tx.query<{ version: string }>(
      `update machvon.signing_certificate set status = 'Revoked', status_reason = $2, version = version + 1
        where id = $1::uuid returning version::text as version`,
      [certificate.id, reason],
    );
    return { version: Number((rows[0] as { version: string }).version) };
  }

  /** The daily job: makes the stored status of every Active certificate past its end Expired; returns how many. */
  async expireDue(tx: TenantTx): Promise<number> {
    const rows = await tx.query<{ id: string }>(
      `update machvon.signing_certificate set status = 'Expired', status_reason = 'VALIDITY_ENDED', version = version + 1
        where status = 'Active' and valid_until <= now() returning id`,
    );
    return rows.length;
  }

  /** Active certificates that end within `days` days and have not ended yet: the 30-day warning of ADM-08. */
  async expiringWithin(tx: TenantTx, days: number): Promise<CertificateRow[]> {
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.signing_certificate
        where status = 'Active' and valid_until > now() and valid_until <= now() + make_interval(days => $1::int)
        order by valid_until, id`,
      [days],
    );
    return rows.map(toRow);
  }
}
