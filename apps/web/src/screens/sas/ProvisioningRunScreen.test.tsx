import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import vi_ from '../../i18n/vi.json';
import ProvisioningRunScreen from './ProvisioningRunScreen';
import { PLATFORM_OPERATOR, SYSTEM_ADMIN, harness, mount, routeOf } from './test-support';
import { RUN_POLL_MS } from './tenants/hooks';

const ROUTE = routeOf('SAS-22', 'FR-SAS-22');
const TENANT = '00000000-0000-4000-8000-0000000000a1';
const PATH = `/sas/sas-22?tenant=${TENANT}`;
const STEPS = ['IDP_ORG', 'DNS_SUBDOMAIN', 'STORAGE_PREFIX', 'DB_PLACEMENT', 'RLS_SEED', 'ENTITLEMENT_V1', 'LICENSE_PILOT', 'ROLE_SEED', 'ROOT_UNIT', 'THEME_V1', 'OWNER_INVITE'] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  IDP_ORG: vi_['sas.tenants.step.idpOrg'],
  DNS_SUBDOMAIN: vi_['sas.tenants.step.dnsTls'],
  STORAGE_PREFIX: vi_['sas.tenants.step.storagePrefix'],
  DB_PLACEMENT: vi_['sas.tenants.step.dbPlacement'],
  RLS_SEED: vi_['sas.tenants.step.rlsSeed'],
  ENTITLEMENT_V1: vi_['sas.tenants.step.entitlementV1'],
  LICENSE_PILOT: vi_['sas.tenants.step.licensePilot'],
  ROLE_SEED: vi_['sas.tenants.step.roleSeed'],
  ROOT_UNIT: vi_['sas.tenants.step.rootUnit'],
  THEME_V1: vi_['sas.tenants.step.themeV1'],
  OWNER_INVITE: vi_['sas.tenants.step.ownerInvite'],
};
const REASON = 'The registry of the plan was fixed.';

interface Scenario {
  status: string;
  done: number;
  failedAt?: (typeof STEPS)[number];
  errorCode?: string;
  version?: number;
}

let scenario: Scenario = { status: 'Active', done: 11 };

function detail(): Record<string, unknown> {
  const steps = STEPS.map((step, index) => {
    if (scenario.failedAt === step) return { step, status: 'FAILED', attempts: 4, error_code: scenario.errorCode ?? 'STEP_FAILED' };
    if (index < scenario.done) return { step, status: 'DONE', attempts: 1 };
    if (index === scenario.done && scenario.status === 'Provisioning') return { step, status: 'RUNNING', attempts: 1 };
    return { step, status: 'PENDING', attempts: 0 };
  });
  return {
    id: TENANT,
    code: 'cao-bang',
    name: 'Cao Bằng',
    status: scenario.status,
    version: scenario.version ?? 7,
    provisioning: { run_id: 'run-1', attempt: 2, current_step: scenario.failedAt ?? STEPS[Math.min(scenario.done, 10)], steps },
  };
}

function answer(operation: string): unknown {
  return operation === 'getSystemTenant' ? detail() : new Error('unexpected read');
}

const open = (next: Scenario, permissions: readonly string[] | undefined = SYSTEM_ADMIN, command?: (operation: string, input: unknown) => unknown, path = PATH) => {
  scenario = next;
  const h = harness(answer, command);
  mount(<ProvisioningRunScreen route={ROUTE} />, h, permissions, path);
  return h;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SAS-22 provisioning progress', () => {
  it('shows the eleven steps in order with their state, attempts, error code and what is undone on cancel', async () => {
    open({ status: 'Active', done: 11 });
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.getAttribute('data-step'))).toEqual([...STEPS]);
    for (const step of STEPS) {
      const row = rows.find((candidate) => candidate.getAttribute('data-step') === step);
      expect(within(row as HTMLElement).getByText(STEP_LABEL[step])).toBeTruthy();
      expect(within(row as HTMLElement).getByText(vi_['sas.tenants.run.done'])).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 1, name: vi_['sas.provisioning.page.title'] })).toBeTruthy();
    expect(screen.getByText(vi_['sas.provisioning.card.title'].replace('{code}', 'cao-bang'))).toBeTruthy();
    expect(screen.getByText(vi_['sas.provisioning.attempt.text'].replace('{attempt}', '2'))).toBeTruthy();
    expect(screen.getByText(vi_['sas.provisioning.active.notice'])).toBeTruthy();
    expect(screen.getByText(vi_['sas.provisioning.footer.reference'].replace('{id}', 'SAS-22').replace('{req}', 'FR-SAS-22'))).toBeTruthy();
  });

  it('names for every step what the cancellation undoes: five removals, two revocations and five steps that leave their rows to the tenant', async () => {
    open({ status: 'Active', done: 11 });
    const table = await screen.findByRole('table');
    const text = (step: string): string => within(table.querySelector(`tr[data-step="${step}"]`) as HTMLElement).getAllByRole('cell')[4]?.textContent ?? '';
    expect(text('IDP_ORG')).toBe(vi_['sas.provisioning.compensation.idpOrg']);
    expect(text('DNS_SUBDOMAIN')).toBe(vi_['sas.provisioning.compensation.dnsSubdomain']);
    expect(text('STORAGE_PREFIX')).toBe(vi_['sas.provisioning.compensation.storagePrefix']);
    expect(text('DB_PLACEMENT')).toBe(vi_['sas.provisioning.compensation.dbPlacement']);
    expect(text('LICENSE_PILOT')).toBe(vi_['sas.provisioning.compensation.licensePilot']);
    expect(text('OWNER_INVITE')).toBe(vi_['sas.provisioning.compensation.ownerInvite']);
    for (const step of ['RLS_SEED', 'ENTITLEMENT_V1', 'ROLE_SEED', 'ROOT_UNIT', 'THEME_V1']) expect(text(step)).toBe(vi_['sas.provisioning.compensation.none']);
  });

  it('marks the step that is running and the state of a tenant that is still provisioning', async () => {
    open({ status: 'Provisioning', done: 6 });
    await screen.findByRole('table');
    const running = document.querySelector('tr[data-step-status="RUNNING"]');
    expect(running?.getAttribute('data-step')).toBe('LICENSE_PILOT');
    expect(running?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText(vi_['sas.tenants.status.provisioning'])).toBeTruthy();
    expect(document.querySelectorAll('tr[data-step-status="PENDING"]')).toHaveLength(4);
    expect(screen.queryByText(vi_['sas.provisioning.active.notice'])).toBeNull();
  });

  it('reads the run again while the saga works, and stops when the tenant is Active', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'] });
    const h = open({ status: 'Provisioning', done: 3 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(h.read).toHaveBeenCalledTimes(1);
    scenario = { status: 'Provisioning', done: 8 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS + 50);
    });
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('tr[data-step-status="DONE"]')).toHaveLength(8);
    scenario = { status: 'Active', done: 11 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS + 50);
    });
    expect(h.read).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 3);
    });
    expect(h.read).toHaveBeenCalledTimes(3);
  });

  it('does not read again for a tenant that is Failed or Active', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'] });
    const h = open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT', errorCode: 'VALIDATION_FAILED' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 3);
    });
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  describe('a run that failed', () => {
    it('names the failed step and its error code, keeps the finished steps and offers the retry', async () => {
      open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT', errorCode: 'VALIDATION_FAILED' });
      const alert = await screen.findByRole('alert');
      expect(alert.getAttribute('data-failed-step')).toBe('ROOT_UNIT');
      expect(alert.textContent).toBe(vi_['sas.provisioning.failed.notice'].replace('{step}', STEP_LABEL.ROOT_UNIT).replace('{code}', 'VALIDATION_FAILED'));
      const failed = document.querySelector('tr[data-step="ROOT_UNIT"]') as HTMLElement;
      expect(within(failed).getByText('VALIDATION_FAILED')).toBeTruthy();
      expect(within(failed).getByText(vi_['sas.tenants.run.failed'])).toBeTruthy();
      expect(document.querySelectorAll('tr[data-step-status="DONE"]')).toHaveLength(8);
      expect(screen.getByRole('button', { name: vi_['sas.tenants.retry.submit'] })).toBeTruthy();
    });

    it('refuses a reason that is too short and sends nothing', async () => {
      const user = userEvent.setup();
      const h = open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT' });
      await user.type(await screen.findByLabelText(vi_['sas.tenants.retry.reason.label']), 'short');
      await user.click(screen.getByRole('button', { name: vi_['sas.tenants.retry.submit'] }));
      expect(screen.getByText(vi_['sas.tenants.retry.reason.tooShort'])).toBeTruthy();
      expect(h.command).not.toHaveBeenCalled();
    });

    it('retries with the version the screen showed, one command for a double click, and says that a new attempt started', async () => {
      const user = userEvent.setup();
      const h = open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT', version: 9 }, SYSTEM_ADMIN, () => ({ tenant_id: TENANT, status: 'Provisioning', version: 10 }));
      await user.type(await screen.findByLabelText(vi_['sas.tenants.retry.reason.label']), ` ${REASON} `);
      await user.dblClick(screen.getByRole('button', { name: vi_['sas.tenants.retry.submit'] }));
      await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
      const [operation, input] = h.command.mock.calls[0] as [string, { path: { tenantId: string }; body: { reason: string }; ifMatchVersion: number }];
      expect(operation).toBe('retryTenantProvisioning');
      expect(input.path.tenantId).toBe(TENANT);
      expect(input.body).toEqual({ reason: REASON });
      expect(input.ifMatchVersion).toBe(9);
      expect(await screen.findByText(vi_['sas.provisioning.retry.started.notice'])).toBeTruthy();
    });

    it('shows a stale version in words and keeps the form', async () => {
      const user = userEvent.setup();
      open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT' }, SYSTEM_ADMIN, () => new ApiError({ status: 409, code: 'VERSION_CONFLICT', correlationId: 'c', extensions: { current_version: 12 } }));
      await user.type(await screen.findByLabelText(vi_['sas.tenants.retry.reason.label']), REASON);
      await user.click(screen.getByRole('button', { name: vi_['sas.tenants.retry.submit'] }));
      expect(await screen.findByText(vi_['sas.tenantCreate.error.conflict'].replace('{version}', '12'))).toBeTruthy();
      expect((screen.getByLabelText(vi_['sas.tenants.retry.reason.label']) as HTMLTextAreaElement).value).toBe(REASON);
    });

    it('gives a platform operator the reading only: a notice and no retry', async () => {
      open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT' }, PLATFORM_OPERATOR);
      expect(await screen.findByText(vi_['sas.provisioning.readOnly.notice'])).toBeTruthy();
      expect(screen.queryByRole('button', { name: vi_['sas.tenants.retry.submit'] })).toBeNull();
    });

    it('offers the retry when the session does not state its permissions', async () => {
      open({ status: 'Failed', done: 8, failedAt: 'ROOT_UNIT' }, undefined);
      expect(await screen.findByRole('button', { name: vi_['sas.tenants.retry.submit'] })).toBeTruthy();
    });
  });

  it('shows no retry for a tenant that did not fail, and a failed step without a code as a dash', async () => {
    open({ status: 'Provisioning', done: 2 });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: vi_['sas.tenants.retry.submit'] })).toBeNull();
    cleanup();
    scenario = { status: 'Failed', done: 3, failedAt: 'DB_PLACEMENT' };
    const h = harness(() => {
      const view = detail() as { provisioning: { steps: Array<Record<string, unknown>> } };
      for (const step of view.provisioning.steps) delete step.error_code;
      return view;
    });
    mount(<ProvisioningRunScreen route={ROUTE} />, h, SYSTEM_ADMIN, PATH);
    expect((await screen.findByRole('alert')).textContent).toContain(vi_['sas.tenants.none']);
  });

  it('says so when the tenant has no run, and asks for a tenant when the address names none', async () => {
    scenario = { status: 'Active', done: 11 };
    const h = harness(() => ({ id: TENANT, code: 'old', name: 'Old', status: 'Active', version: 1 }));
    mount(<ProvisioningRunScreen route={ROUTE} />, h, SYSTEM_ADMIN, PATH);
    expect(await screen.findByText(vi_['sas.provisioning.noRun.notice'])).toBeTruthy();
    cleanup();
    const empty = harness(answer);
    mount(<ProvisioningRunScreen route={ROUTE} />, empty, SYSTEM_ADMIN, '/sas/sas-22');
    expect(screen.getByText(vi_['sas.provisioning.missing.notice'])).toBeTruthy();
    expect(empty.read).not.toHaveBeenCalled();
  });

  it('links back to the tenant list above the title', async () => {
    open({ status: 'Active', done: 11 });
    const link = await screen.findByRole('link', { name: new RegExp(vi_['sas.provisioning.back.link']) });
    expect(link.getAttribute('href')).toBe('/sas/sas-01');
  });

  describe('the seven states', () => {
    const fail = (error: ApiError) => (): unknown => error;
    const mountFailing = (error: ApiError) => mount(<ProvisioningRunScreen route={ROUTE} />, harness(fail(error)), SYSTEM_ADMIN, PATH);

    it('shows the denied, signed-out, offline and error states, and a loading state first', async () => {
      mountFailing(new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }));
      expect(screen.getByRole('status')).toBeTruthy();
      expect(await screen.findByText(vi_['states.denied.title'])).toBeTruthy();
      cleanup();
      mountFailing(new ApiError({ status: 401, code: 'SESSION_EXPIRED', correlationId: 'c' }));
      expect(await screen.findByText(vi_['states.signedOut.title'])).toBeTruthy();
      cleanup();
      mountFailing(new ApiError({ status: 0, code: NETWORK_ERROR_CODE, correlationId: 'c' }));
      expect(await screen.findByText(vi_['states.offline.title'])).toBeTruthy();
      cleanup();
      mountFailing(new ApiError({ status: 404, code: 'RESOURCE_NOT_FOUND', correlationId: 'c' }));
      expect(await screen.findByText(vi_['states.error.title'])).toBeTruthy();
    });
  });
});
