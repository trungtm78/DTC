import { randomUUID } from 'node:crypto';
import { enqueueOutbox, seedSystemRoles } from '@machvon/db';
import type { AuditWriter, ControlDatabase, EntitlementStore, LicenseStore, OutboxEventInput, TenantBootstrapStore, TenantTx, ThemeStore } from '@machvon/db';
import { TRIAL_DAYS } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import { INVITATION_TTL_DAYS, createInvitationToken, hashEmail } from '../modules/adm/invitation-token';
import type { InvitationMailer } from '../modules/adm/invitation-mailer';
import { LICENSE_ISSUED_EVENT, LICENSE_REVOKED_EVENT, licenseIssuedRecord } from '../modules/sas/license.controller';
import type { LicenseKeyStore } from '../modules/sas/license-signer';
import { TENANT_STATUS_CHANGED_EVENT } from '../modules/sas/tenant-status-consumer';
import { ownerAssignedEvents } from '../modules/sas/tenant-owner';
import { defaultTenantTheme } from './default-theme';
import { INFRASTRUCTURE_STEP_DEFINITIONS } from './steps';
import type { StepContext, StepDefinition } from './steps';

const DAY_MS = 86_400_000;
/** The pilot license outlives the trial by this long, so a tenant is never cut off on the day the trial ends (grace period). */
const PILOT_GRACE_DAYS = 30;
const MEMBERSHIP_STATE_INVALID = 'MEMBERSHIP_STATE_INVALID';
const REVOCATION_REASON = 'Provisioning of the tenant was cancelled.';

/** What steps 6 to 11 write besides the registry: the entitlements, the license, the theme, the roles, the unit and the owner. */
export interface ProvisioningServices {
  control: ControlDatabase;
  entitlements: EntitlementStore;
  licenses: LicenseStore;
  keys: LicenseKeyStore;
  themes: ThemeStore;
  bootstrap: TenantBootstrapStore;
  audit: AuditWriter;
  mailer: InvitationMailer;
  now?: () => Date;
}

/** The audit row and the events a step writes belong to the run: its id is their correlation, every write has a request id of its own. */
function recorder(tx: TenantTx, services: ProvisioningServices, context: StepContext) {
  const correlationId = context.run.id;
  const actor = context.run.requestedBy;
  return {
    audit: (entry: { action: string; resourceType: string; resourceId: string; diff: Record<string, unknown>; reason?: string }) =>
      services.audit.recordInTx(tx, actor, { ...entry, correlationId, requestId: randomUUID() }),
    emit: (event: Omit<OutboxEventInput, 'correlationId'>) => enqueueOutbox(tx, { ...event, correlationId }),
  };
}

/**
 * Steps 6 to 11 of the saga (SAS 3.1): entitlement version 1 with the trial subscription, the pilot license, the system roles,
 * the root unit, theme version 1 and the owner invitation. Each runs in one control-plane transaction acting as the tenant,
 * is idempotent by the natural key of the table it writes, and writes its audit row and events in the same transaction.
 * Only the license and the owner invitation have something to undo when provisioning is cancelled; everything else
 * belongs to a tenant that is archived as a whole.
 */
export function provisioningStepDefinitions(services: ProvisioningServices): readonly StepDefinition[] {
  const now = (): Date => services.now?.() ?? new Date();
  const inTenant = <T>(context: StepContext, work: (tx: TenantTx) => Promise<T>): Promise<T> => services.control.withTenantOf(context.tenant.id, work);

  return [
    {
      step: 'ENTITLEMENT_V1',
      execute: (context) =>
        inTenant(context, async (tx) => {
          // The lock comes before the look: two processes that resume the same run must not both find the tenant without a version.
          await services.entitlements.lock(tx);
          if ((await services.entitlements.latestVersionId(tx)) !== undefined) return;
          const planVersionId = context.run.request.plan_version_id;
          const features = await services.bootstrap.planFeatures(tx, planVersionId);
          const subscriptionId = await services.bootstrap.ensureTrialSubscription(tx, planVersionId, now());
          await services.entitlements.record(tx, { cause: 'PROVISIONING', planVersionId, subscriptionId, features });
        }),
      compensate: () => Promise.resolve(),
    },
    {
      step: 'LICENSE_PILOT',
      execute: (context) =>
        inTenant(context, async (tx) => {
          // The lock comes before the look: the second of two processes that resume the same run then finds the license of the first.
          await services.licenses.lock(tx);
          if ((await services.licenses.list(tx, { limit: 1, after: undefined })).length > 0) return;
          const entitlementVersionId = await services.entitlements.latestVersionId(tx);
          if (entitlementVersionId === undefined) throw new DomainError('LICENSE_TENANT_MISMATCH', 422, 'entitlement_version_id');
          const at = now();
          const record = recorder(tx, services, context);
          await services.licenses.issue(
            tx,
            {
              tenantId: context.tenant.id,
              edition: 'PILOT',
              validFrom: at,
              validUntil: new Date(at.getTime() + TRIAL_DAYS * DAY_MS),
              graceUntil: new Date(at.getTime() + (TRIAL_DAYS + PILOT_GRACE_DAYS) * DAY_MS),
              entitlementVersionId,
              issuedBy: context.run.requestedBy,
              restoreTenantId: context.tenant.id,
            },
            () => services.keys.current(),
            async (issued) => {
              const issuedRecord = licenseIssuedRecord(issued);
              await record.audit({ action: 'license.issued', resourceType: 'license', resourceId: issued.id, diff: issuedRecord.diff });
              await record.emit({ aggregateType: 'license', aggregateId: issued.id, aggregateVersion: issued.version, type: LICENSE_ISSUED_EVENT, schemaVersion: 1, payload: issuedRecord.payload, eventKey: issuedRecord.eventKey });
            },
            at,
          );
        }),
      compensate: (context) =>
        inTenant(context, async (tx) => {
          const record = recorder(tx, services, context);
          for (const license of await services.licenses.list(tx, { limit: 100, after: undefined })) {
            if (license.status === 'Revoked' || license.status === 'Superseded' || license.status === 'Draft' || license.status === 'Expired') continue;
            await services.licenses.revoke(tx, { licenseId: license.id, reason: REVOCATION_REASON, expectedVersion: license.version, restoreTenantId: context.tenant.id }, async (revoked) => {
              await record.audit({ action: 'license.revoked', resourceType: 'license', resourceId: revoked.id, reason: REVOCATION_REASON, diff: { serial: revoked.serial, revision: revoked.revision, status: revoked.status } });
              await record.emit({
                aggregateType: 'license',
                aggregateId: revoked.id,
                aggregateVersion: revoked.version,
                type: LICENSE_REVOKED_EVENT,
                schemaVersion: 1,
                payload: { tenant_id: revoked.tenantId, license_id: revoked.id, serial: revoked.serial, revision: revoked.revision },
                eventKey: `license:${revoked.id}:revoked`,
              });
            });
          }
        }),
    },
    {
      step: 'ROLE_SEED',
      execute: (context) => inTenant(context, (tx) => seedSystemRoles(tx, context.run.requestedBy).then(() => undefined)),
      compensate: () => Promise.resolve(),
    },
    {
      step: 'ROOT_UNIT',
      execute: (context) => inTenant(context, (tx) => services.bootstrap.ensureRootUnit(tx, randomUUID(), context.run.request.root_unit_name, now()).then(() => undefined)),
      compensate: () => Promise.resolve(),
    },
    {
      step: 'THEME_V1',
      execute: (context) =>
        inTenant(context, (tx) =>
          services.themes.createInitialVersion(tx, { tenantId: context.tenant.id, config: defaultTenantTheme(context.tenant.name), publishedBy: context.run.requestedBy }).then(() => undefined),
        ),
      compensate: () => Promise.resolve(),
    },
    {
      step: 'OWNER_INVITE',
      async execute(context) {
        const email = context.run.request.initial_owner_email;
        const issuedAt = now();
        const { token, hash } = createInvitationToken(context.tenant.id);
        const expiresAt = new Date(issuedAt.getTime() + INVITATION_TTL_DAYS * DAY_MS);
        const assigned = await inTenant(context, async (tx) => {
          try {
            const result = await services.bootstrap.assignOwner(tx, { email, assignedBy: context.run.requestedBy, tokenHash: hash, emailHash: hashEmail(email), expiresAt });
            const record = recorder(tx, services, context);
            // The audit row and the events carry no email address and no token.
            await record.audit({ action: 'tenant.owner_assigned', resourceType: 'tenant', resourceId: context.tenant.id, diff: { membership_id: result.membershipId, via: 'provisioning' } });
            for (const event of ownerAssignedEvents(context.tenant.id, result)) await record.emit(event);
            return result;
          } catch (error) {
            // A person who already owns the tenant (the step ran before and the invitation was accepted) has nothing left to invite.
            if (error instanceof DomainError && error.code === MEMBERSHIP_STATE_INVALID && error.detail === 'already owner') return undefined;
            throw error;
          }
        });
        if (assigned?.invitationId === undefined) return;
        await services.mailer.send({ tenantId: context.tenant.id, invitationId: assigned.invitationId, toEmail: email.trim().toLowerCase(), token, expiresAt });
      },
      compensate: (context) => inTenant(context, (tx) => services.bootstrap.revokePendingOwners(tx, context.run.requestedBy).then(() => undefined)),
    },
  ];
}

/** All eleven steps of SAS 3.1 in order: the infrastructure of M2e and the data steps above. */
export function createProvisioningSteps(services: ProvisioningServices): readonly StepDefinition[] {
  return [...INFRASTRUCTURE_STEP_DEFINITIONS, ...provisioningStepDefinitions(services)];
}

/**
 * The audit row and the event of the move to Active (SAS 3.1 step 4), written by `completeRun` in the transaction that
 * makes the tenant Active.
 */
export function activationRecorder(services: ProvisioningServices): (tx: TenantTx, tenant: { id: string }, run: { id: string; requestedBy: string }) => Promise<void> {
  return async (tx, tenant, run) => {
    const rows = await tx.query<{ version: string }>('select version::text as version from machvon.tenant where id = $1::uuid', [tenant.id]);
    const version = Number(rows[0]?.version);
    await services.audit.recordInTx(tx, run.requestedBy, {
      action: 'tenant.activated',
      resourceType: 'tenant',
      resourceId: tenant.id,
      diff: { from: 'Provisioning', to: 'Active' },
      correlationId: run.id,
      requestId: randomUUID(),
    });
    await enqueueOutbox(tx, {
      aggregateType: 'tenant',
      aggregateId: tenant.id,
      aggregateVersion: version,
      type: TENANT_STATUS_CHANGED_EVENT,
      schemaVersion: 1,
      payload: { tenant_id: tenant.id, from: 'Provisioning', to: 'Active' },
      eventKey: `tenant:${tenant.id}:status:${version}`,
      correlationId: run.id,
    });
  };
}
