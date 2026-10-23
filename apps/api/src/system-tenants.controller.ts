import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PROVISIONING_STEPS, TenantRegistry } from '@machvon/db';
import type { RunRow, TenantRequestInput, TenantRow } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import { Command, Scope } from './command.decorator';
import type { CommandScope } from './command-scope';
import type { Schemas } from './contract-types';
import { OperationId } from './operation-id.decorator';
import { encodeCursor, parsePageRequest } from './pagination';
import { TENANT_REQUESTED_EVENT } from './provisioning/provisioning.consumer';

const RESOURCE_TYPE = 'tenant';

type TenantLifecycleResult = Schemas['TenantLifecycleResult'];
type TenantDetail = Schemas['TenantDetail'];
type TenantSummaryPage = Schemas['TenantSummaryPage'];

function requestOf(body: Schemas['TenantProvisionRequest'], requestedBy: string): TenantRequestInput {
  return {
    code: body.code,
    name: body.name,
    governingBodyType: body.governing_body_type,
    ...(body.administrative_code === undefined ? {} : { administrativeCode: body.administrative_code }),
    region: body.region,
    isolationMode: body.isolation_mode,
    planVersionId: body.plan_version_id,
    rootUnitName: body.root_unit_name,
    initialOwnerEmail: body.initial_owner_email,
    platformSubdomain: body.platform_subdomain,
    ...(body.procurement_contract_ref === undefined ? {} : { procurementContractRef: body.procurement_contract_ref }),
    requestedBy,
  };
}

/**
 * The code of a run that failed after every step finished (the final activation): the run holds it, no step does. It is shown on
 * the step the run stopped at, as FAILED, so the timeline of a Failed tenant never reads as entirely successful; the stored steps
 * stay DONE, which is what lets a retry run activate the tenant without repeating one.
 */
function activationFailureOf(run: RunRow): { step: string; code: string } | undefined {
  if (run.status !== 'Failed' || run.errorCode === undefined) return undefined;
  const stepFailed = PROVISIONING_STEPS.some((step) => run.steps[step].status === 'FAILED' || typeof run.steps[step].error_code === 'string');
  return stepFailed ? undefined : { step: run.currentStep, code: run.errorCode };
}

function detailOf(tenant: TenantRow, run: RunRow | undefined): TenantDetail {
  const activation = run === undefined ? undefined : activationFailureOf(run);
  return {
    id: tenant.id,
    code: tenant.code,
    name: tenant.name,
    governing_body_type: tenant.governingBodyType,
    status: tenant.status,
    isolation_mode: tenant.isolationMode,
    placement_id: tenant.placementId,
    ...(run === undefined
      ? {}
      : {
          provisioning: {
            run_id: run.id,
            attempt: run.attempt,
            current_step: run.currentStep,
            steps: PROVISIONING_STEPS.map((step) =>
              activation?.step === step
                ? { step, status: 'FAILED' as const, attempts: run.steps[step].attempts, error_code: activation.code }
                : {
                    step,
                    status: run.steps[step].status,
                    attempts: run.steps[step].attempts,
                    ...(typeof run.steps[step].error_code === 'string' ? { error_code: run.steps[step].error_code } : {}),
                  },
            ),
          },
        }),
    version: tenant.version,
  };
}

/**
 * The control-plane tenant registry (ST-SAS-001): requesting provisioning, retrying it, listing and reading tenants.
 * Every operation is control-plane only (token audience `machvon-control`, permission from the realm roles of the
 * caller). The commands run through the command pipeline on the control database under the platform tenant.
 */
@Controller('system/tenants')
export class SystemTenantsController {
  constructor(@Inject(TenantRegistry) private readonly registry: TenantRegistry) {}

  @Post()
  @HttpCode(202)
  @OperationId('requestTenantProvisioning')
  @Command({ operation: 'requestTenantProvisioning', plane: 'control' })
  async request(@Scope() scope: CommandScope, @Body() body: Schemas['TenantProvisionRequest']): Promise<TenantLifecycleResult> {
    const input = requestOf(body, scope.tenant.membershipId);
    const created = await this.registry.requestTenant(scope.tx, input, scope.tenant.tenantId, async (tenant) => {
      // The rows below belong to the new tenant: the transaction acts as that tenant while they are written.
      await scope.audit({
        action: 'tenant.requested',
        resourceType: RESOURCE_TYPE,
        resourceId: tenant.tenantId,
        diff: { code: input.code, region: input.region, isolation_mode: input.isolationMode, plan_version_id: input.planVersionId },
      });
      await scope.emit({
        aggregateType: RESOURCE_TYPE,
        aggregateId: tenant.tenantId,
        aggregateVersion: tenant.version,
        type: TENANT_REQUESTED_EVENT,
        schemaVersion: 1,
        payload: { tenant_id: tenant.tenantId, run_id: tenant.runId, attempt: 1, plan_version_id: input.planVersionId, region: input.region, isolation_mode: input.isolationMode },
        eventKey: `${RESOURCE_TYPE}:${tenant.tenantId}:requested:1`,
      });
    });
    return { tenant_id: created.tenantId, status: 'Requested', provisioning_run_id: created.runId, version: created.version };
  }

  @Post(':tenantId/provisioning/retry')
  @HttpCode(202)
  @OperationId('retryTenantProvisioning')
  @Command({ operation: 'retryTenantProvisioning', plane: 'control', versioned: true })
  async retry(
    @Scope() scope: CommandScope,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: Schemas['ReasonOnly'],
  ): Promise<TenantLifecycleResult> {
    const retried = await this.registry.startRetryRun(
      scope.tx,
      tenantId,
      scope.expectedVersion ?? 0,
      scope.tenant.membershipId,
      scope.tenant.tenantId,
      async (run) => {
        await scope.audit({
          action: 'tenant.provisioning_retry',
          resourceType: RESOURCE_TYPE,
          resourceId: tenantId,
          reason: body.reason,
          diff: { attempt: run.attempt },
        });
        await scope.emit({
          aggregateType: RESOURCE_TYPE,
          aggregateId: tenantId,
          aggregateVersion: run.version,
          type: TENANT_REQUESTED_EVENT,
          schemaVersion: 1,
          payload: { tenant_id: tenantId, run_id: run.runId, attempt: run.attempt },
          eventKey: `${RESOURCE_TYPE}:${tenantId}:requested:${run.attempt}`,
        });
      },
    );
    return { tenant_id: tenantId, status: 'Provisioning', provisioning_run_id: retried.runId, version: retried.version };
  }

  @Get()
  @OperationId('listSystemTenants')
  async list(@Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown): Promise<TenantSummaryPage> {
    const page = parsePageRequest(limit, cursor);
    const found = await this.registry.listTenants(page.limit, page.after);
    return { items: found.items, next_cursor: found.next === null ? null : encodeCursor(found.next) };
  }

  @Get(':tenantId')
  @OperationId('getSystemTenant')
  async get(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<TenantDetail> {
    const detail = await this.registry.getDetail(tenantId);
    if (detail === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return detailOf(detail.tenant, detail.run);
  }
}
