export const KERNEL_PACKAGE = '@machvon/kernel';
export { DomainError } from './errors.ts';
export type { DomainErrorOptions } from './errors.ts';
export { canonicalJson, sha256Hex } from './canonical-json.ts';
export {
  IDEMPOTENCY_LOCK_SECONDS,
  IDEMPOTENCY_TTL_HOURS,
  keyHashOf,
  parseIdempotencyKey,
  requestHashOf,
} from './idempotency.ts';
export type { IdempotencyTtl, RequestParts } from './idempotency.ts';
export { formatEtag, parseIfMatch, versionConflict } from './if-match.ts';
export { auditLeafHash, merkleRoot, sealHashOf } from './audit-seal.ts';
export { OUTBOX_BATCH_SIZE, OUTBOX_LAG_ALERT_SECONDS, OUTBOX_MAX_ATTEMPTS, outboxDelaySeconds } from './outbox-policy.ts';
export { safeDiff } from './redact.ts';
export { NOOP_ALERTS, NOOP_METRICS } from './ports.ts';
export type { AlertSink, MetricsSink } from './ports.ts';
export { assertAllowedFields } from './allowlist.ts';
export { loadErrorRegistry } from './error-registry.ts';
export type { RegisteredError } from './error-registry.ts';
export { asUuid, parseTenantContext } from './tenant-context.ts';
export type { TenantContext } from './tenant-context.ts';
export { InvalidKeyError, TenantCache, tenantKey } from './tenant-keys.ts';
export type { KeyValueStore } from './tenant-keys.ts';
export { signTenantContext, verifyTenantContext } from './signed-context.ts';
export { permissionMatches } from './permission.ts';
export { scopeContains, scopeCovers } from './scope.ts';
export type { ResourceRef, Scope } from './scope.ts';
export { activeGrants, effectivePermissions, holdsPermission, maxRank } from './effective-access.ts';
export type { EffectiveAccess, GrantView } from './effective-access.ts';
export { STEP_UP_WINDOW_MINUTES, decide } from './decision.ts';
export type { DecideInput, Decision, Plane } from './decision.ts';
export { checkGrant, checkRoleDefinition, permissionCovered } from './anti-escalation.ts';
export type { AntiEscalationCode, AntiEscalationResult, GrantCheckInput, RoleDefinitionCheckInput } from './anti-escalation.ts';
export { CONTROL_ROLES, controlAccessOf } from './control-access.ts';
export type { ControlRole } from './control-access.ts';
export { STANDARD_FEATURES, activeOverride, allowedFeature, entitlementsHash } from './entitlement.ts';
export type { AllowedFeatureInput, EntitlementDenial, FeatureEntry, LicenseMode, OperationKind, Override, TenantAccessPolicy } from './entitlement.ts';
export { FEATURE_BY_PERMISSION, RISKY_FEATURES, featureOf, isRiskyFeature } from './features.ts';
export { TenantRateLimiter } from './tenant-rate-limit.ts';
export type { RateLimitVerdict, TenantRateLimiterOptions } from './tenant-rate-limit.ts';
export { buildSymbol, formatRegisterNumber, validateSymbolPattern, vietnamDateOf, vietnamYearOf } from './doc-numbering.ts';
export type { SymbolParts } from './doc-numbering.ts';
export { ND30_A4_STANDARD, assertLayoutWithinLegalRange, layoutProfileOf } from './pdf-layout.ts';
export type {
  Box,
  ElementName,
  ElementStyle,
  LayoutProfile,
  LayoutProfileRow,
  NumberFieldLayout,
  SignatureLayout,
  WatermarkPolicy,
} from './pdf-layout.ts';
export { documentIdOf, normalisePayload, payloadSha256, renderInputHash } from './pdf-render.ts';
export type { PdfRenderer, RenderBlock, RenderContent, RenderInput, RenderRequest, RenderedPdf } from './pdf-render.ts';
export { IntervalScheduler, SYSTEM_TIMERS } from './scheduler.ts';
export type { IntervalSchedulerOptions, JobDefinition, JobOutcome, JobRunRecord, Scheduler, TimerPort } from './scheduler.ts';
