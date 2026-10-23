import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import vi from '../src/i18n/vi.json' with { type: 'json' };
import fixtures from './support/e2e-fixtures.json' with { type: 'json' };
import { membershipOf, sql, stackInfo } from './support/stack.ts';

/**
 * The ADM-02 and ADM-17 flows in a real browser against the real API and database (apps/api/test/e2e-stack): the
 * fixture users are picked with `?devUser=`, every request is authorised by the policy guard, and what the screens
 * changed is looked up in the database. Accepting an invitation needs an identity bound to the invited address; that
 * path is proved against the API (apps/api/test/members.test.ts, guest-contractors.test.ts), here the flow ends at the
 * stored invitation and the one-time data the development session shows.
 */

const LIFECYCLE_MEMBER = fixtures.lifecycleMembershipId;
const unique = (): string => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

function unitOf(code: string): string {
  const unit = stackInfo().units.A[code];
  if (unit === undefined) throw new Error(`seeded unit ${code} is missing`);
  return unit;
}

async function openScreen(page: Page, screen: 'adm-02' | 'adm-17', user: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/adm/${screen}?devUser=${user}`);
  await page.waitForSelector('[data-screen-id], [role="alert"], [role="status"]');
}

const statusOf = async (membershipId: string): Promise<string | undefined> =>
  (await sql<{ status: string }>('select status from machvon.membership where id = $1', [membershipId]))[0]?.status;

test.describe('ADM-02 members', () => {
  test('the tenant owner suspends a member with a reason and reactivates them', async ({ page }) => {
    await openScreen(page, 'adm-02', 'owner');
    await expect(page.getByRole('heading', { level: 1, name: vi['adm.members.page.title'] })).toBeVisible();
    const row = page.locator(`tr[data-member-id="${LIFECYCLE_MEMBER}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByText(vi['adm.members.status.active'])).toBeVisible();

    await row.getByRole('button', { name: vi['adm.members.suspend.action'] }).click();
    await page.getByRole('dialog').getByRole('button', { name: vi['adm.members.suspend.action'] }).click();
    await expect(page.getByText(vi['adm.members.problem.required'])).toBeVisible();
    await page.locator('#member-reason').fill('tạm khóa để kiểm thử luồng e2e');
    await page.getByRole('dialog').getByRole('button', { name: vi['adm.members.suspend.action'] }).click();
    await expect(page.getByRole('status').filter({ hasText: 'đã tạm khóa' }).or(page.getByRole('status').filter({ hasText: 'Đã tạm khóa' }))).toBeVisible();
    expect(await statusOf(LIFECYCLE_MEMBER)).toBe('Suspended');
    await expect(row.getByText(vi['adm.members.status.suspended'])).toBeVisible();

    await row.getByRole('button', { name: vi['adm.members.reactivate.action'] }).click();
    await page.locator('#member-reason').fill('kích hoạt lại sau khi kiểm thử');
    await page.getByRole('dialog').getByRole('button', { name: vi['adm.members.reactivate.action'] }).click();
    await expect(row.getByText(vi['adm.members.status.active'])).toBeVisible();
    expect(await statusOf(LIFECYCLE_MEMBER)).toBe('Active');
  });

  test('the owner invites a member into a unit and the list shows the pending invitation with the development acceptance data', async ({ page }) => {
    const email = `moi-${unique()}@example.test`;
    await openScreen(page, 'adm-02', 'owner');
    await page.getByRole('button', { name: vi['adm.members.invite.action'] }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(vi['adm.members.invite.email.label']).fill(email);
    await dialog.getByLabel(vi['adm.members.invite.name.label']).fill('Người được mời');
    await dialog.getByLabel(vi['adm.members.invite.unit.label']).selectOption(unitOf('CB-SKHDT-VP'));
    await dialog.getByRole('button', { name: vi['adm.members.invite.submit.action'] }).click();
    await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();
    await expect(page.locator('[data-dev-acceptance]')).toBeVisible();
    await expect(page.locator('[data-dev-token]')).not.toBeEmpty();

    const stored = await sql<{ status: string; invitation: string }>(
      `select m.status, i.status as invitation from machvon.membership m join machvon.user_account u on u.id = m.user_id
         join machvon.membership_invitation i on i.membership_id = m.id where u.email_normalized = $1`,
      [email],
    );
    expect(stored).toEqual([{ status: 'Invited', invitation: 'Pending' }]);
    const row = page.locator('tr', { hasText: email });
    await expect(row.getByText(vi['adm.members.invitation.pending'])).toBeVisible();
    await expect(row.getByText(vi['adm.members.status.invited'])).toBeVisible();
  });

  test('a form that is not valid is refused on the field and sends nothing', async ({ page }) => {
    await openScreen(page, 'adm-02', 'owner');
    await page.getByRole('button', { name: vi['adm.members.invite.action'] }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(vi['adm.members.invite.email.label']).fill('khong-hop-le');
    await dialog.getByRole('button', { name: vi['adm.members.invite.submit.action'] }).click();
    await expect(dialog.getByText(vi['adm.members.problem.email'])).toBeVisible();
    await expect(dialog.getByText(vi['adm.members.problem.required'])).toBeVisible();
  });

  test('a unit administrator sees only the members of their subtree and may act on them', async ({ page }) => {
    await openScreen(page, 'adm-02', 'unitAdmin');
    await expect(page.locator(`tr[data-member-id="${LIFECYCLE_MEMBER}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-member-id="${membershipOf('unitAdmin')}"]`)).toBeVisible();
    // The owner and the other fixture people sit in the root unit, outside the subtree of the administrator.
    await expect(page.locator(`tr[data-member-id="${membershipOf('owner')}"]`)).toHaveCount(0);
    await expect(page.locator(`tr[data-member-id="${LIFECYCLE_MEMBER}"]`).getByRole('button', { name: vi['adm.members.suspend.action'] })).toBeVisible();
    // Nobody acts on themselves.
    await expect(page.locator(`tr[data-member-id="${membershipOf('unitAdmin')}"]`).getByRole('button')).toHaveCount(0);
  });

  test('an auditor reads the list and has no control', async ({ page }) => {
    await openScreen(page, 'adm-02', 'auditor');
    await expect(page.locator(`tr[data-member-id="${LIFECYCLE_MEMBER}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: vi['adm.members.invite.action'] })).toHaveCount(0);
    await expect(page.locator('tbody').getByRole('button')).toHaveCount(0);
  });
});

test.describe('ADM-17 guest contractors', () => {
  test('the owner invites a guest of a contractor for two contracts and the list shows them', async ({ page }) => {
    const email = `khach-${unique()}@example.test`;
    await openScreen(page, 'adm-17', 'owner');
    await expect(page.getByRole('heading', { level: 1, name: vi['adm.guests.page.title'] })).toBeVisible();
    await page.getByRole('button', { name: vi['adm.guests.invite.action'] }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(vi['adm.members.invite.email.label']).fill(email);
    await dialog.getByLabel(vi['adm.guests.invite.contractor.label']).selectOption({ label: 'Nhà thầu Cao Bằng' });
    for (const box of await dialog.getByRole('checkbox').all()) await box.check();
    await dialog.getByLabel(vi['adm.guests.invite.role.label']).selectOption({ label: 'GUEST_CONTRACTOR' });

    // The bound is 365 days after the latest completion (2027-03-31): a later end is refused on the field.
    await dialog.getByLabel(vi['adm.guests.invite.until.label']).fill('2029-01-01T10:00');
    await dialog.getByRole('button', { name: vi['adm.guests.invite.submit.action'] }).click();
    await expect(dialog.getByText(/^Không được muộn hơn/)).toBeVisible();

    await dialog.getByLabel(vi['adm.guests.invite.until.label']).fill('2027-01-15T10:00');
    await dialog.getByRole('button', { name: vi['adm.guests.invite.submit.action'] }).click();
    await expect(page.getByRole('status').filter({ hasText: email })).toBeVisible();
    await expect(page.locator('[data-dev-acceptance]')).toBeVisible();

    const stored = await sql<{ membership_type: string; status: string; scope_kind: string; code: string; ends: string }>(
      `select m.membership_type, m.status, g.scope_kind, r.code, to_char(g.effective_until at time zone 'UTC', 'YYYY') as ends
         from machvon.membership m join machvon.user_account u on u.id = m.user_id
         join machvon.role_grant g on g.membership_id = m.id join machvon.role_definition r on r.id = g.role_id
        where u.email_normalized = $1`,
      [email],
    );
    expect(stored).toEqual([{ membership_type: 'GUEST_CONTRACTOR', status: 'Invited', scope_kind: 'CONTRACT', code: 'GUEST_CONTRACTOR', ends: '2027' }]);
    const row = page.locator('tr', { hasText: email });
    await expect(row.getByText('Nhà thầu Cao Bằng')).toBeVisible();
    await expect(row.getByText('HD-01, HD-02')).toBeVisible();
    await expect(row.getByText(vi['adm.members.status.invited'])).toBeVisible();
  });

  test('a unit administrator, who may not invite guests, sees no invitation button', async ({ page }) => {
    await openScreen(page, 'adm-17', 'unitAdmin');
    await expect(page.getByRole('heading', { level: 1, name: vi['adm.guests.page.title'] })).toBeVisible();
    await expect(page.getByRole('button', { name: vi['adm.guests.invite.action'] })).toHaveCount(0);
  });
});
