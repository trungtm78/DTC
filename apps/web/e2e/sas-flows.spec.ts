import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import vi from '../src/i18n/vi.json' with { type: 'json' };
import { sql, stackInfo } from './support/stack.ts';

/**
 * The control-plane screens (SAS-01, SAS-02, SAS-03, SAS-25) in a real browser against the real API and database
 * (apps/api/test/e2e-stack): fixture control users are picked with `?devUser=`, their tokens carry the control
 * audience and realm roles, and the saga runs behind the outbox relay over mock infrastructure ports. Steps 6 to 11 of
 * the provisioning are M2f, so a new tenant stays `Provisioning` with its run `Running` at ENTITLEMENT_V1.
 */

const unique = (): string => Date.now().toString(36);

async function openScreen(page: Page, screen: 'sas-01' | 'sas-02' | 'sas-03' | 'sas-25', user: string, extraQuery = ''): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/sas/${screen}?devUser=${user}${extraQuery}`);
  await page.waitForSelector('[data-screen-id], [role="alert"], [role="status"]');
}

const tenantRow = (code: string): Promise<{ id: string; status: string }[]> => sql('select id, status from machvon.tenant where code = $1', [code]);

test.describe('SAS-02 tenant creation and SAS-01 tenant list', () => {
  test('a system administrator requests a tenant and sees the saga stop at the entitlement step', async ({ page }) => {
    const code = `e2e-${unique()}`;
    await openScreen(page, 'sas-02', 'sysAdmin');
    await expect(page.getByRole('heading', { level: 1, name: vi['sas.tenantCreate.page.title'] })).toBeVisible();

    // A code that breaks BR-SAS-01 never leaves the browser.
    await page.getByLabel(vi['sas.tenantCreate.code.label'], { exact: true }).fill('Bad_Code');
    await page.getByRole('button', { name: vi['sas.tenantCreate.submit.action'] }).click();
    await expect(page.getByText(vi['sas.tenantCreate.problem.pattern'])).toBeVisible();
    expect(await tenantRow('Bad_Code')).toHaveLength(0);

    await page.getByLabel(vi['sas.tenantCreate.name.label'], { exact: true }).fill('Tenant kiểm thử e2e');
    await page.getByLabel(vi['sas.tenantCreate.owner.label'], { exact: true }).fill('owner@example.org');
    await page.getByLabel(vi['sas.tenantCreate.plan.label'], { exact: true }).fill(stackInfo().planVersionId);
    await page.getByLabel(vi['sas.tenantCreate.code.label'], { exact: true }).fill(code);
    await page.getByLabel(vi['sas.tenantCreate.rootUnit.label'], { exact: true }).fill('Ủy ban nhân dân kiểm thử');
    await page.getByLabel(vi['sas.tenantCreate.subdomain.label'], { exact: true }).fill(code);
    await page.getByRole('button', { name: vi['sas.tenantCreate.submit.action'] }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Requested' })).toBeVisible();

    // The relay hands the event to the saga: steps 1 to 5 run on the mock ports and the run waits at step 6 (M2f).
    await expect
      .poll(async () => (await sql<{ current_step: string; status: string }>("select r.current_step, r.status from machvon.tenant_provisioning_run r join machvon.tenant t on t.id = r.tenant_id where t.code = $1", [code]))[0], { timeout: 60_000 })
      .toMatchObject({ current_step: 'ENTITLEMENT_V1', status: 'Running' });
    expect((await tenantRow(code))[0]?.status).toBe('Provisioning');

    await page.goto('/sas/sas-01?devUser=sysAdmin');
    const row = page.locator('tr', { hasText: code });
    await expect(row).toBeVisible();
    await expect(row.getByText(vi['sas.tenants.status.provisioning'])).toBeVisible();
    await expect(row.getByText(vi['sas.tenants.run.at'].replace('{step}', vi['sas.tenants.step.entitlementV1']))).toBeVisible();
  });

  test('the registered tenant is listed with its status and the code is refused a second time', async ({ page }) => {
    await openScreen(page, 'sas-01', 'sysAdmin');
    const row = page.locator('tr', { hasText: 'cao-bang' });
    await expect(row.getByText(vi['sas.tenants.status.active'])).toBeVisible();

    await openScreen(page, 'sas-02', 'sysAdmin');
    await page.getByLabel(vi['sas.tenantCreate.name.label'], { exact: true }).fill('Cao Bằng lần hai');
    await page.getByLabel(vi['sas.tenantCreate.owner.label'], { exact: true }).fill('second@example.org');
    await page.getByLabel(vi['sas.tenantCreate.plan.label'], { exact: true }).fill(stackInfo().planVersionId);
    await page.getByLabel(vi['sas.tenantCreate.code.label'], { exact: true }).fill('cao-bang');
    await page.getByLabel(vi['sas.tenantCreate.rootUnit.label'], { exact: true }).fill('Ủy ban nhân dân');
    await page.getByLabel(vi['sas.tenantCreate.subdomain.label'], { exact: true }).fill(`second-${unique()}`);
    await page.getByRole('button', { name: vi['sas.tenantCreate.submit.action'] }).click();
    const taken = page.getByText(vi['sas.tenantCreate.error.codeTaken']);
    await expect(taken).toBeVisible();
    await expect(page.getByLabel(vi['sas.tenantCreate.owner.label'], { exact: true })).toHaveValue('second@example.org');
    expect(await sql("select count(*)::int as n from machvon.tenant where lower(code) = 'cao-bang'")).toEqual([{ n: 1 }]);
  });

  test('a platform operator can read the registry but has no way to create a tenant', async ({ page }) => {
    await openScreen(page, 'sas-01', 'operator');
    await expect(page.locator('tr', { hasText: 'cao-bang' })).toBeVisible();
    await expect(page.getByRole('link', { name: vi['sas.tenants.create.action'] })).toHaveCount(0);

    await openScreen(page, 'sas-02', 'operator');
    await expect(page.getByText(vi['sas.tenantCreate.readOnly.notice'])).toBeVisible();
    await expect(page.getByRole('button', { name: vi['sas.tenantCreate.submit.action'] })).toHaveCount(0);
  });

  test('a tenant administrator is refused the control plane: the registry shows the denied state', async ({ page }) => {
    await openScreen(page, 'sas-01', 'owner');
    await expect(page.getByText(vi['states.denied.title'])).toBeVisible();
  });
});

test.describe('SAS-25 entitlements', () => {
  test('the control plane reads the entitlements of a registered tenant', async ({ page }) => {
    await openScreen(page, 'sas-25', 'sysAdmin', `&tenant=${stackInfo().tenants.A}`);
    await expect(page.getByRole('heading', { level: 1, name: vi['sas.entitlements.page.title'] })).toBeVisible();
    const reporting = page.locator('tr[data-feature="reporting"]');
    await expect(reporting.getByText(vi['sas.entitlements.feature.reporting'])).toBeVisible();
    const hash = await page.locator('[data-entitlements-hash]').textContent();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const stored = await sql<{ entitlements_hash: string }>('select entitlements_hash from machvon.entitlement_version where tenant_id = $1 order by version_no desc limit 1', [stackInfo().tenants.A]);
    expect(stored[0]?.entitlements_hash).toBe(hash);
    await expect(page.locator('tr[data-feature="ai.analysis"]').getByText(vi['sas.entitlements.mode.denied'])).toBeVisible();
  });

  test('a tenant user reads the table of the own tenant', async ({ page }) => {
    await openScreen(page, 'sas-25', 'owner');
    await expect(page.locator('tr[data-feature="reporting"]')).toBeVisible();
  });
});

test.describe('SAS-03 tenant lifecycle', () => {
  const REASON = 'The invoice of September is 45 days overdue.';

  /** A tenant of its own in state Active, so the flows never touch the fixture tenants the other specs use. */
  async function activeTenant(): Promise<string> {
    const code = `life-${unique()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const rows = await sql<{ id: string }>(
      "insert into machvon.tenant (id, code, name, status, placement_id, region) select gen_random_uuid(), $1, $1, 'Active', id, 'vn-north' from machvon.placement limit 1 returning id",
      [code],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('no placement to put the tenant on');
    return id;
  }

  const stateOf = (id: string): Promise<{ status: string; lifecycle_reason: string | null; version: string }[]> =>
    sql('select status, lifecycle_reason, version::text as version from machvon.tenant where id = $1', [id]);

  test('a system administrator suspends a tenant with a reason and resumes it, and every step is on record', async ({ page }) => {
    const id = await activeTenant();
    await openScreen(page, 'sas-03', 'sysAdmin', `&tenant=${id}`);
    await expect(page.getByRole('heading', { level: 1, name: vi['sas.tenantDetail.page.title'] })).toBeVisible();
    await expect(page.locator('[data-tenant-status="Active"]')).toBeVisible();
    await expect(page.getByRole('button', { name: vi['sas.tenantDetail.resume.action'] })).toHaveCount(0);

    await page.getByRole('button', { name: vi['sas.tenantDetail.suspend.action'] }).click();
    const dialog = page.getByRole('dialog');
    // A reason that is too short never leaves the browser.
    await dialog.getByLabel(vi['sas.tenantDetail.reason.label']).fill('too short');
    await dialog.getByRole('button', { name: vi['sas.tenantDetail.suspend.confirm'] }).click();
    await expect(dialog.getByText(vi['sas.tenantDetail.reason.tooShort'])).toBeVisible();
    expect((await stateOf(id))[0]?.status).toBe('Active');

    await dialog.getByLabel(vi['sas.tenantDetail.reason.label']).fill(REASON);
    await dialog.getByRole('button', { name: vi['sas.tenantDetail.suspend.confirm'] }).click();
    await expect(page.getByRole('status').filter({ hasText: vi['sas.tenantDetail.done.suspended'].replace('{version}', '2') })).toBeVisible();
    await expect(page.locator('[data-tenant-status="Suspended"]')).toBeVisible();
    expect((await stateOf(id))[0]).toMatchObject({ status: 'Suspended', lifecycle_reason: 'NON_PAYMENT', version: '2' });
    expect(await sql("select reason from machvon.audit_event where tenant_id = $1 and action = 'tenant.suspended' and outcome = 'SUCCESS'", [id])).toEqual([{ reason: REASON }]);
    expect(await sql("select payload from machvon.outbox_event where tenant_id = $1 and type = 'sas.tenant.status_changed.v1'", [id])).toEqual([
      { payload: { tenant_id: id, from: 'Active', to: 'Suspended', reason_code: 'NON_PAYMENT' } },
    ]);

    await page.getByRole('button', { name: vi['sas.tenantDetail.resume.action'] }).click();
    await page.getByRole('dialog').getByLabel(vi['sas.tenantDetail.reason.label']).fill('The invoice was paid on 2026-10-20.');
    await page.getByRole('dialog').getByRole('button', { name: vi['sas.tenantDetail.resume.confirm'] }).click();
    await expect(page.locator('[data-tenant-status="Active"]')).toBeVisible();
    expect((await stateOf(id))[0]).toMatchObject({ status: 'Active', lifecycle_reason: null, version: '3' });
    expect(await sql("select count(*)::int as n from machvon.audit_event where tenant_id = $1 and action = 'tenant.resumed'", [id])).toEqual([{ n: 1 }]);
  });

  test('a suspension for a security incident names no access, and the dialog of a stale version tells the current one', async ({ page }) => {
    const id = await activeTenant();
    await openScreen(page, 'sas-03', 'sysAdmin', `&tenant=${id}`);
    await page.getByRole('button', { name: vi['sas.tenantDetail.suspend.action'] }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(vi['sas.tenantDetail.reasonCode.label']).selectOption('SECURITY_INCIDENT');
    await expect(dialog.getByText(vi['sas.tenantDetail.policy.noAccess'])).toBeVisible();
    await dialog.getByLabel(vi['sas.tenantDetail.reason.label']).fill(REASON);

    // Another operator changed the tenant while this dialog was open.
    await sql('update machvon.tenant set version = version + 1 where id = $1', [id]);
    await dialog.getByRole('button', { name: vi['sas.tenantDetail.suspend.confirm'] }).click();
    await expect(dialog.getByText(vi['sas.tenantCreate.error.conflict'].replace('{version}', '2'))).toBeVisible();
    await expect(dialog.getByLabel(vi['sas.tenantDetail.reason.label'])).toHaveValue(REASON);
    expect((await stateOf(id))[0]?.status).toBe('Active');
  });

  test('a platform operator reads the tenant and has no lifecycle control', async ({ page }) => {
    const id = await activeTenant();
    await openScreen(page, 'sas-03', 'operator', `&tenant=${id}`);
    await expect(page.locator('[data-tenant-status="Active"]')).toBeVisible();
    await expect(page.getByRole('button', { name: vi['sas.tenantDetail.suspend.action'] })).toHaveCount(0);
    await expect(page.getByText(vi['sas.tenantDetail.lifecycle.readOnly.notice'])).toBeVisible();
  });
});
