import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { DocumentStore, SignatureStore, TenantDatabase, VERSION_SCOPE_COLUMNS, scopePredicate } from '@machvon/db';
import type { StoredSignature } from '@machvon/db';
import { DomainError, NOOP_METRICS, objectKey, overallOf } from '@machvon/kernel';
import type { EffectiveAccess, MetricsSink, SignatureResult, SignatureStatus, TenantContext, VerificationPolicy } from '@machvon/kernel';
import { Command, Scope } from '../../command.decorator';
import { commandResult } from '../../command-result';
import type { CommandResult } from '../../command-result';
import type { CommandScope } from '../../command-scope';
import type { Schemas } from '../../contract-types';
import { CurrentAccess } from '../../current-access.decorator';
import { OperationId } from '../../operation-id.decorator';
import { CurrentTenant } from '../../tenant-context.decorator';
import { DOCUMENT_FILE_PORT } from './file-port';
import type { DocumentFilePort } from './file-port';
import { verifyPdfSignatures } from './pades-verifier';
import type { RevocationPort } from './pades-verifier';
import { DOC_CLOCK, DOC_METRICS, DOC_REVOCATION, DOC_TRUST_STORE } from './tokens';
import type { TrustStoreProvider } from './trust-anchors';

const VERIFY_PERMISSION = PERMISSIONS.verifyDocumentSignatures;
const READ_PERMISSION = PERMISSIONS.getDocumentSignatureReport;
const VERSION_TYPE = 'document_version';
const PDF_MIME = 'application/pdf';
const REPORT_KIND = 'sigreport';
const REPORT_MIME = 'application/json';

function view(row: StoredSignature): Record<string, unknown> {
  return {
    index: row.index,
    role: row.role,
    verification_no: row.verificationNo,
    subject_dn: row.subjectDn,
    issuer_dn: row.issuerDn,
    serial: row.serial,
    fingerprint_sha256: row.fingerprintSha256,
    registered_certificate_id: row.signingCertificateId,
    trust_regime: row.trustRegime,
    profile: row.profile,
    docmdp_level: row.docmdpLevel,
    byte_range: row.byteRange,
    covers_end_offset: row.coversEndOffset,
    signed_at: row.signedAt?.toISOString() ?? null,
    timestamp_at: row.timestampAt?.toISOString() ?? null,
    status: row.status,
    chain_status: row.chainStatus,
    revocation_status: row.revocationStatus,
    incremental_changes_allowed: row.incrementalChangesAllowed,
    findings: row.findings,
    verified_at: row.verifiedAt.toISOString(),
    verifier_version: row.verifierVersion,
  };
}

function asResult(row: StoredSignature): SignatureResult {
  return {
    index: row.index,
    role: row.role,
    subjectDn: row.subjectDn,
    issuerDn: row.issuerDn,
    serial: row.serial,
    fingerprintSha256: row.fingerprintSha256,
    trustRegime: row.trustRegime,
    profile: row.profile ?? 'PADES_B_B',
    docmdpLevel: row.docmdpLevel,
    byteRange: row.byteRange,
    coversEndOffset: row.coversEndOffset,
    signedAt: row.signedAt,
    timestampAt: row.timestampAt,
    status: row.status,
    chainStatus: row.chainStatus,
    revocationStatus: row.revocationStatus,
    incrementalChangesAllowed: row.incrementalChangesAllowed,
    findings: row.findings as SignatureResult['findings'],
  };
}

interface StoredReport {
  overall: SignatureStatus;
  policy: VerificationPolicy;
}

/**
 * Signature verification of PDF versions (ST-DOC-003, BR-DOC-14 f): a verification reads the stored file, checks every
 * signature and stores the result as new rows; the report shows the latest verification. The report keeps public
 * certificate data only.
 */
@Controller()
export class SignaturesController {
  private readonly documents = new DocumentStore();
  private readonly signatures = new SignatureStore();
  private readonly metrics: MetricsSink;
  private readonly clock: () => Date;

  constructor(
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Inject(DOCUMENT_FILE_PORT) private readonly files: DocumentFilePort,
    @Inject(DOC_TRUST_STORE) private readonly trust: TrustStoreProvider,
    @Inject(DOC_REVOCATION) private readonly revocation: RevocationPort,
    @Optional() @Inject(DOC_METRICS) metrics?: MetricsSink,
    @Optional() @Inject(DOC_CLOCK) clock?: () => Date,
  ) {
    this.metrics = metrics ?? NOOP_METRICS;
    this.clock = clock ?? ((): Date => new Date());
  }

  @Post('document-versions/:id/signature-verifications')
  @HttpCode(200)
  @OperationId('verifyDocumentSignatures')
  @Command({ operation: 'verifyDocumentSignatures' })
  async verify(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Schemas['DocVerifyRequest'] | undefined,
  ): Promise<CommandResult & Record<string, unknown>> {
    const now = this.clock();
    const policy: VerificationPolicy = body?.policy ?? 'STRICT';
    // A version the caller cannot see is indistinguishable from one that does not exist.
    const version = await this.documents.findVersion(scope.tx, id, (first) => scopePredicate(access, VERIFY_PERMISSION, now, VERSION_SCOPE_COLUMNS, first));
    if (version === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (version.mime !== PDF_MIME) throw new DomainError('DOCUMENT_VERSION_NOT_PDF', 422);
    if (version.scanStatus === 'PENDING') throw new DomainError('SCAN_PENDING', 409);
    if (version.scanStatus === 'INFECTED') throw new DomainError('SCOPE_DENIED', 403);
    const file = await this.files.get(version.objectKey);
    if (file === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);

    const report = await verifyPdfSignatures(file.bytes, await this.trust.forTenant(scope.tenant.tenantId), now, {
      policy,
      revocation: body?.revalidate_revocation === true ? this.revocation : undefined,
    });
    const reportKey = report.signatures.length === 0 ? null : objectKey(scope.tenant.tenantId, REPORT_KIND, randomUUID());
    const rows = await this.signatures.record(scope.tx, {
      versionId: version.id,
      signatures: report.signatures,
      verifiedAt: report.verifiedAt,
      verifierVersion: report.verifierVersion,
      reportObjectKey: reportKey,
    });
    const verificationNo = rows[0]?.verificationNo ?? null;
    if (reportKey !== null) {
      const stored = { version_id: version.id, verification_no: verificationNo, policy, overall: report.overall, signatures: rows.map(view) };
      await this.files.put(reportKey, Buffer.from(JSON.stringify(stored), 'utf8'), REPORT_MIME);
    }
    await scope.audit({
      action: 'document.signature.verify',
      resourceType: VERSION_TYPE,
      resourceId: version.id,
      classification: version.classification,
      diff: { overall: report.overall, policy, signature_count: report.signatures.length, verification_no: verificationNo, revalidate_revocation: body?.revalidate_revocation === true },
    });
    await scope.emit({
      aggregateType: VERSION_TYPE,
      aggregateId: version.id,
      aggregateVersion: version.version,
      type: 'doc.signature_verified.v1',
      schemaVersion: 1,
      payload: { document_id: version.documentId, version_id: version.id, verification_no: verificationNo, overall: report.overall, signature_count: report.signatures.length },
      eventKey: `${VERSION_TYPE}:${version.id}:verified:${scope.requestId}`,
    });
    this.metrics.increment('doc_signature_verification_total', { result: report.overall.toLowerCase() });
    return {
      ...commandResult(scope, report.overall, version.version, version.id),
      overall: report.overall,
      verification_no: verificationNo,
      signature_count: report.signatures.length,
    };
  }

  @Get('document-versions/:id/signature-report')
  @OperationId('getDocumentSignatureReport')
  async report(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    const now = this.clock();
    const loaded = await this.database.withTenant(tenant, async (tx) => {
      const version = await this.documents.findVersion(tx, id, (first) => scopePredicate(access, READ_PERMISSION, now, VERSION_SCOPE_COLUMNS, first));
      return version === undefined ? undefined : this.signatures.latest(tx, version.id);
    });
    if (loaded === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return { version_id: id, overall: await this.overallOf(loaded), signatures: loaded.map(view) };
  }

  /** The overall result as it was decided when the verification ran, which depends on the policy that was chosen. */
  private async overallOf(rows: readonly StoredSignature[]): Promise<SignatureStatus> {
    const key = rows[0]?.reportObjectKey;
    const stored = key === null || key === undefined ? undefined : await this.files.get(key);
    if (stored !== undefined) {
      const kept = JSON.parse(Buffer.from(stored.bytes).toString('utf8')) as StoredReport;
      return kept.overall;
    }
    return overallOf(rows.map(asResult), 'STRICT');
  }
}
