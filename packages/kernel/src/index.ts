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
export { STANDARD_FEATURES, allowedFeature, entitlementsHash } from './entitlement.ts';
export type { AllowedFeatureInput, EntitlementDenial, FeatureEntry, LicenseMode, OperationKind, Override, TenantAccessPolicy } from './entitlement.ts';
export { FEATURE_BY_PERMISSION, featureOf } from './features.ts';
