import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import type { ApiClient } from '@machvon/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../api/ApiClientContext';
import { ALL_MODULES_VISIBLE } from '../../navigation/model';
import { SessionContext } from '../../session/SessionContext';
import type { SessionValue } from '../../session/SessionContext';
import RolesGrantsScreen from './RolesGrantsScreen';
import type { GrantView, RoleView } from './roles/types';

const UUID_A = '00000000-0000-4000-8000-0000000000a1';
const UUID_B = '00000000-0000-4000-8000-0000000000b1';
const CONTRACT = '00000000-0000-4000-8000-0000000000c1';

function role(over: Partial<RoleView> & Pick<RoleView, 'id' | 'code'>): RoleView {
  return { name: over.code, rank: 40, permissions: ['role_grant.read'], is_system: false, guest_allowed: false, status: 'Active', version: 3, ...over };
}

const OWNER = role({ id: 'r-owner', code: 'TENANT_OWNER', rank: 99, is_system: true, name: 'iam.role.TENANT_OWNER.name', permissions: ['iam.*', 'role_grant.read'] });
const UNIT_ADMIN = role({ id: 'r-unit', code: 'UNIT_ADMIN', rank: 70, is_system: true, name: 'iam.role.UNIT_ADMIN.name', permissions: ['iam.unit.manage', 'iam.role.grant'] });
const READER = role({ id: 'r-reader', code: 'GRANT_READER', rank: 30, permissions: ['role_grant.read'] });
const GUEST = role({ id: 'r-guest', code: 'SITE_GUEST', rank: 10, guest_allowed: true, permissions: ['contract.read'] });

function grant(over: Partial<GrantView> & Pick<GrantView, 'id'>): GrantView {
  return {
    membership_id: UUID_A,
    role_id: 'r-unit',
    role_code: 'UNIT_ADMIN',
    scope_kind: 'UNIT_SUBTREE',
    scope_ref_ids: [UUID_B],
    status: 'Active',
    effective_from: '2026-01-02T00:00:00.000Z',
    effective_until: null,
    granted_by: UUID_B,
    grant_reason: 'Initial assignment of the unit administrator',
    version: 7,
    ...over,
  };
}

const ACTIVE_GRANT = grant({ id: 'g-active' });
const REVOKED_GRANT = grant({ id: 'g-revoked', status: 'Revoked', role_code: 'GRANT_READER', effective_until: '2026-02-03T00:00:00.000Z' });

function problem(code: string, status: number, detail?: string): ApiError {
  return new ApiError({ status, code, detail, correlationId: 'c1' });
}

interface Fixture {
  roles?: RoleView[] | Promise<RoleView[]> | Error;
  grantable?: RoleView[];
  grants?: GrantView[];
  command?: ReturnType<typeof vi.fn>;
  permissions?: readonly string[];
}

function renderScreen(fixture: Fixture = {}) {
  const readAll = vi.fn((operation: string, input?: { query?: { grantable?: boolean } }) => {
    if (operation === 'get_resources_role_grant') return Promise.resolve(fixture.grants ?? [ACTIVE_GRANT, REVOKED_GRANT]);
    if (input?.query?.grantable === true) return Promise.resolve(fixture.grantable ?? [UNIT_ADMIN, READER, GUEST]);
    const roles = fixture.roles ?? [OWNER, UNIT_ADMIN, READER, GUEST];
    return roles instanceof Error ? Promise.reject(roles) : Promise.resolve(roles);
  });
  const command = fixture.command ?? vi.fn(() => Promise.resolve({ operation_id: 'o', status: 'OK', resource_version: 1, resource_id: 'x' }));
  const client = { readAll, command, read: vi.fn() } as unknown as ApiClient;
  const requestStepUp = vi.fn(() => Promise.resolve());
  const session: SessionValue = {
    tenant: undefined,
    tenants: [],
    user: undefined,
    access: ALL_MODULES_VISIBLE,
    switchTenant: () => undefined,
    getSession: () => Promise.resolve({ token: 't' }),
    permissions: fixture.permissions,
    requestStepUp,
  };
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <SessionContext.Provider value={session}>
        <ApiClientProvider client={client}>
          <RolesGrantsScreen />
        </ApiClientProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return { readAll, command, requestStepUp };
}

/** The submit button of the role form (the page header has a button with the same name). */
function submitOfRoleForm(): HTMLElement {
  const button = screen.getAllByRole('button', { name: 'Tạo vai trò' }).find((candidate) => candidate.getAttribute('type') === 'submit');
  if (button === undefined) throw new Error('role form submit button not found');
  return button;
}

async function openGrantDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Cấp vai trò' }));
  return screen.getByRole('dialog', { name: 'Cấp vai trò' });
}

async function fillGrant(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, roleCode: string, guest = false) {
  await user.type(within(dialog).getByLabelText('Thành viên nhận (ID)'), UUID_A);
  if (guest) await user.selectOptions(within(dialog).getByLabelText('Loại thành viên'), 'guest');
  await user.selectOptions(within(dialog).getByLabelText('Vai trò'), within(dialog).getByRole('option', { name: roleCode }));
  await user.type(within(dialog).getByLabelText('Đối tượng của scope (mỗi dòng một ID)'), guest ? CONTRACT : UUID_B);
  await user.type(within(dialog).getByLabelText('Lý do'), 'Cấp quyền theo quyết định số 12');
}

describe('ADM-03 states', () => {
  it('shows the roles, the grants and the preview in the default state', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { level: 1, name: 'Vai trò và quyền' })).toBeInTheDocument();
    expect(await screen.findByText('Xem trước')).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('UNIT_ADMIN')).toBeInTheDocument();
    expect(within(table).getByText('Đang hiệu lực')).toBeInTheDocument();
    expect(within(table).getByText('Đã thu hồi')).toBeInTheDocument();
    expect(within(table).getByText('2026-01-02 đến không giới hạn')).toBeInTheDocument();
    expect(within(table).getByText('2026-01-02 đến 2026-02-03')).toBeInTheDocument();
  });

  it('shows the loading state while the lists are being read', () => {
    renderScreen({ roles: new Promise<RoleView[]>(() => undefined) });
    expect(screen.getByRole('status', { name: 'Đang tải' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no roles and no grants', async () => {
    renderScreen({ roles: [], grants: [] });
    expect(await screen.findByText('Chưa có dữ liệu')).toBeInTheDocument();
  });

  it.each([
    ['error', problem('INTERNAL_ERROR', 500), 'Chưa thể tải dữ liệu'],
    ['denied', problem('SCOPE_DENIED', 403), 'Bạn chưa có quyền truy cập'],
    ['expired', problem('SESSION_EXPIRED', 401), 'Phiên làm việc đã hết hạn'],
    ['offline', problem(NETWORK_ERROR_CODE, 0), 'Bạn đang ngoại tuyến'],
  ])('shows the %s state when the server answers that way', async (_name, failure, title) => {
    renderScreen({ roles: failure });
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it('is denied, not empty, for a user without role_grant.read, and asks the server for nothing', async () => {
    const { readAll } = renderScreen({ permissions: ['iam.unit.manage'] });
    expect(await screen.findByText('Bạn chưa có quyền truy cập')).toBeInTheDocument();
    expect(readAll).not.toHaveBeenCalled();
  });

  it('is read-only without iam.role.grant and iam.role.manage: no commands, disabled matrix', async () => {
    renderScreen({ permissions: ['role_grant.read'] });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Cấp vai trò' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo vai trò' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thu hồi' })).not.toBeInTheDocument();
    const user = userEvent.setup({ delay: null });
    await user.selectOptions(screen.getByLabelText('Vai trò'), 'r-reader');
    expect(screen.getByText('Bạn chỉ có quyền xem vai trò và quyền đã cấp.')).toBeInTheDocument();
    expect(screen.getByLabelText('role_grant.read')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu cấu hình' })).not.toBeInTheDocument();
  });
});

// These tests mount the matrix of several hundred checkboxes, which is slow under coverage instrumentation.
const HEAVY_DOM_TIMEOUT_MS = 30_000;

describe('the role editor', { timeout: HEAVY_DOM_TIMEOUT_MS }, () => {
  it('shows a system role read-only with its note and never lists system permissions', async () => {
    renderScreen();
    const user = userEvent.setup({ delay: null });
    await user.selectOptions(await screen.findByLabelText('Vai trò'), 'r-owner');
    expect(screen.getByText('Vai trò hệ thống là bất biến; chỉ có thể xem.')).toBeInTheDocument();
    expect(screen.getByLabelText('iam.*')).toBeChecked();
    expect(screen.getByLabelText('iam.*')).toBeDisabled();
    expect(screen.queryByLabelText(/^system\./)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu cấu hình' })).not.toBeInTheDocument();
  });

  it('creates a custom role with the ticked permissions and a fresh idempotency attempt', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole('button', { name: 'Tạo vai trò' }));
    await user.type(screen.getByLabelText('Mã vai trò'), 'site_reviewer');
    await user.type(screen.getByLabelText('Tên vai trò'), 'Site reviewer');
    await user.type(screen.getByLabelText('Hạng (rank)'), '30');
    await user.click(screen.getByLabelText('role_grant.read'));
    await user.click(submitOfRoleForm());
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenCalledWith(
      'createCustomRole',
      expect.objectContaining({ body: { code: 'SITE_REVIEWER', name: 'Site reviewer', permissions: ['role_grant.read'], rank: 30, guest_allowed: false } }),
    );
    expect(await screen.findByText('Đã tạo vai trò.')).toBeInTheDocument();
  });

  it('does not send a role whose code, rank or permissions are invalid, and marks the fields', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole('button', { name: 'Tạo vai trò' }));
    await user.type(screen.getByLabelText('Mã vai trò'), 'x');
    await user.type(screen.getByLabelText('Hạng (rank)'), '95');
    await user.click(submitOfRoleForm());
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mã vai trò')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Hạng (rank)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('updates a custom role with its version as If-Match and a reason of at least ten characters', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    await user.selectOptions(await screen.findByLabelText('Vai trò'), 'r-reader');
    expect(screen.getByText('Phiên bản 3')).toBeInTheDocument();
    await user.click(screen.getByLabelText('iam.unit.manage'));
    await user.type(screen.getByLabelText('Lý do'), 'short');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Lý do')).toHaveAttribute('aria-invalid', 'true');
    await user.clear(screen.getByLabelText('Lý do'));
    await user.type(screen.getByLabelText('Lý do'), 'Add the unit management right');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenCalledWith(
      'updateCustomRole',
      expect.objectContaining({
        path: { roleId: 'r-reader' },
        ifMatchVersion: 3,
        body: { name: 'GRANT_READER', permissions: ['iam.unit.manage', 'role_grant.read'], rank: 30, reason: 'Add the unit management right' },
      }),
    );
  });

  it('shows the reason of a refused update (system role) without losing the edit', async () => {
    const { command } = renderScreen({ command: vi.fn(() => Promise.reject(problem('SYSTEM_ROLE_IMMUTABLE', 409))) });
    const user = userEvent.setup({ delay: null });
    await user.selectOptions(await screen.findByLabelText('Vai trò'), 'r-reader');
    await user.type(screen.getByLabelText('Lý do'), 'Add the unit management right');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vai trò hệ thống không thể sửa.');
    expect(screen.getByLabelText('Lý do')).toHaveValue('Add the unit management right');
    expect(command).toHaveBeenCalledTimes(1);
  });
});

describe('the grant dialog', () => {
  it('offers only the roles the server lists as grantable', async () => {
    const { readAll } = renderScreen({ grantable: [UNIT_ADMIN] });
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    expect(readAll).toHaveBeenCalledWith('get_resources_role_definition', { query: { grantable: true } });
    const options = within(within(dialog).getByLabelText('Vai trò')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Chọn vai trò', 'UNIT_ADMIN']);
    expect(options).not.toContain('TENANT_OWNER');
  });

  it('limits a guest recipient to the CONTRACT scope and to roles marked for guests', async () => {
    renderScreen();
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Loại thành viên'), 'guest');
    const scopes = within(within(dialog).getByLabelText('Loại scope')).getAllByRole('option').map((option) => option.textContent);
    expect(scopes).toEqual(['Hợp đồng']);
    const roles = within(within(dialog).getByLabelText('Vai trò')).getAllByRole('option').map((option) => option.textContent);
    expect(roles).toEqual(['Chọn vai trò', 'SITE_GUEST']);
  });

  it('sends the grant with one idempotency attempt even when the button is pressed twice', async () => {
    let release: (value: unknown) => void = () => undefined;
    const command = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderScreen({ command });
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog, 'UNIT_ADMIN');
    const submit = within(dialog).getByRole('button', { name: 'Cấp vai trò' });
    await user.click(submit);
    await user.click(submit);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith('grantRole', expect.objectContaining({ body: expect.objectContaining({ membership_id: UUID_A, role_id: 'r-unit', scope_kind: 'UNIT_SUBTREE', scope_ref_ids: [UUID_B] }) }));
    release({ operation_id: 'o', status: 'GRANTED', resource_version: 1, resource_id: 'g' });
    expect(await screen.findByText('Đã cấp vai trò.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Cấp vai trò' })).not.toBeInTheDocument();
  });

  it('asks for the second factor on MFA_REQUIRED and reruns the same attempt after it', async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(problem('MFA_REQUIRED', 403))
      .mockResolvedValueOnce({ operation_id: 'o', status: 'GRANTED', resource_version: 1, resource_id: 'g' });
    const { requestStepUp } = renderScreen({ command });
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog, 'UNIT_ADMIN');
    await user.click(within(dialog).getByRole('button', { name: 'Cấp vai trò' }));
    const prompt = await screen.findByRole('alertdialog', { name: 'Cần xác thực lần hai' });
    await user.click(within(prompt).getByRole('button', { name: 'Xác thực' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(requestStepUp).toHaveBeenCalledTimes(1);
    const [first, second] = command.mock.calls.map((call) => (call[1] as { attempt: { key: string } }).attempt.key);
    expect(second).toBe(first);
    expect(await screen.findByText('Đã cấp vai trò.')).toBeInTheDocument();
  });

  it('drops the attempt when the step-up is cancelled, so the next try is a new intention', async () => {
    const command = vi.fn().mockRejectedValue(problem('MFA_REQUIRED', 403));
    renderScreen({ command });
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog, 'UNIT_ADMIN');
    await user.click(within(dialog).getByRole('button', { name: 'Cấp vai trò' }));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'Hủy' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Cấp vai trò' })).getByRole('button', { name: 'Cấp vai trò' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    const keys = command.mock.calls.map((call) => (call[1] as { attempt: { key: string } }).attempt.key);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it.each([
    ['ROLE_ESCALATION_DENIED', 'Bạn không được cấp vai trò có hạng hoặc quyền vượt quá quyền của chính bạn.'],
    ['SELF_GRANT_DENIED', 'Bạn không thể tự cấp vai trò cho chính mình.'],
    ['SCOPE_OUT_OF_GRANTOR_RANGE', 'Phạm vi yêu cầu nằm ngoài phạm vi quản trị của bạn.'],
    ['SYSTEM_PERMISSION_NOT_GRANTABLE', 'Quyền hệ thống không thể cấp trong tenant.'],
    ['GUEST_SCOPE_INVALID', 'Khách nhà thầu chỉ nhận vai trò dành cho khách trên hợp đồng của nhà thầu đó.'],
    ['CONTRACT_NOT_ACTIVE', 'Hợp đồng không còn hiệu lực để cấp quyền.'],
    ['ROLE_GRANT_EXISTS', 'Quyền này đã được cấp cho thành viên trên cùng phạm vi.'],
    ['VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ; hãy kiểm tra lại các trường.'],
    ['SOMETHING_NEW', 'Không thực hiện được thao tác; hãy thử lại sau.'],
  ])('shows %s in its own words and keeps the dialog and the typed values', async (code, message) => {
    const command = vi.fn(() => Promise.reject(problem(code, code === 'VALIDATION_FAILED' ? 422 : 403, 'reason')));
    renderScreen({ command });
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await fillGrant(user, dialog, 'UNIT_ADMIN');
    await user.click(within(dialog).getByRole('button', { name: 'Cấp vai trò' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('dialog', { name: 'Cấp vai trò' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Thành viên nhận (ID)')).toHaveValue(UUID_A);
    if (code === 'VALIDATION_FAILED') expect(within(dialog).getByLabelText('Lý do')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not send an incomplete grant and marks what is missing', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cấp vai trò' }));
    expect(command).not.toHaveBeenCalled();
    for (const label of ['Thành viên nhận (ID)', 'Vai trò', 'Đối tượng của scope (mỗi dòng một ID)', 'Lý do']) {
      expect(within(dialog).getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
  });

  it('accepts a tenant-wide scope without targets, and rejects an end before the start', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    const dialog = await openGrantDialog(user);
    await user.type(within(dialog).getByLabelText('Thành viên nhận (ID)'), UUID_A);
    await user.selectOptions(within(dialog).getByLabelText('Vai trò'), 'r-unit');
    await user.selectOptions(within(dialog).getByLabelText('Loại scope'), 'TENANT');
    expect(within(dialog).queryByLabelText('Đối tượng của scope (mỗi dòng một ID)')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Lý do'), 'Cấp quyền toàn tenant theo văn bản');
    await user.type(within(dialog).getByLabelText('Hiệu lực từ'), '2026-05-02T10:00');
    await user.type(within(dialog).getByLabelText('Hiệu lực đến'), '2026-05-01T10:00');
    await user.click(within(dialog).getByRole('button', { name: 'Cấp vai trò' }));
    expect(command).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Hiệu lực đến')).toHaveAttribute('aria-invalid', 'true');
    await user.clear(within(dialog).getByLabelText('Hiệu lực đến'));
    await user.type(within(dialog).getByLabelText('Hiệu lực đến'), '2026-06-01T10:00');
    await user.click(within(dialog).getByRole('button', { name: 'Cấp vai trò' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    const body = (command.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }])[1].body;
    expect(body).toMatchObject({ scope_kind: 'TENANT' });
    expect(body).not.toHaveProperty('scope_ref_ids');
    expect(body.effective_from).toEqual(expect.stringMatching(/^2026-05-02T/));
    expect(body.effective_until).toEqual(expect.stringMatching(/^2026-06-01T/));
  });

  it('closes on Escape without sending anything', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    await openGrantDialog(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Cấp vai trò' })).not.toBeInTheDocument();
    expect(command).not.toHaveBeenCalled();
  });
});

describe('the revoke dialog', () => {
  async function openRevoke(user: ReturnType<typeof userEvent.setup>) {
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Thu hồi' }));
    return screen.getByRole('dialog', { name: 'Thu hồi quyền đã cấp' });
  }

  it('offers revoking only for an active grant', async () => {
    renderScreen();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('button', { name: 'Thu hồi' })).toHaveLength(1);
  });

  it('needs a reason of at least ten characters and sends the grant version as If-Match', async () => {
    const { command } = renderScreen();
    const user = userEvent.setup({ delay: null });
    const dialog = await openRevoke(user);
    await user.type(within(dialog).getByLabelText('Lý do thu hồi'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi' }));
    expect(command).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Lý do thu hồi')).toHaveAttribute('aria-invalid', 'true');
    await user.clear(within(dialog).getByLabelText('Lý do thu hồi'));
    await user.type(within(dialog).getByLabelText('Lý do thu hồi'), 'Người dùng đã chuyển công tác');
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenCalledWith(
      'revokeRoleGrant',
      expect.objectContaining({ path: { grantId: 'g-active' }, body: { reason: 'Người dùng đã chuyển công tác' }, ifMatchVersion: 7 }),
    );
    expect(await screen.findByText('Đã thu hồi quyền.')).toBeInTheDocument();
  });

  it.each([
    ['LAST_TENANT_OWNER', 'Không thể thu hồi quyền của chủ tenant cuối cùng.'],
    ['SELF_ACTION_DENIED', 'Bạn không thể thu hồi quyền của chính mình.'],
    ['VERSION_CONFLICT', 'Dữ liệu đã được người khác thay đổi; hãy tải lại rồi thử lại.'],
    ['RESOURCE_NOT_FOUND', 'Không tìm thấy đối tượng; có thể nó đã bị thay đổi.'],
    ['SCOPE_DENIED', 'Bạn không có quyền thực hiện thao tác này.'],
    ['NETWORK_ERROR', 'Không kết nối được máy chủ; hãy thử lại.'],
  ])('shows %s in the dialog', async (code, message) => {
    renderScreen({ command: vi.fn(() => Promise.reject(problem(code, 409))) });
    const user = userEvent.setup({ delay: null });
    const dialog = await openRevoke(user);
    await user.type(within(dialog).getByLabelText('Lý do thu hồi'), 'Người dùng đã chuyển công tác');
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  });

  it('runs the step-up for a revoke too, with the same attempt', async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(problem('MFA_REQUIRED', 403))
      .mockResolvedValueOnce({ operation_id: 'o', status: 'REVOKED', resource_version: 8, resource_id: 'g-active' });
    renderScreen({ command });
    const user = userEvent.setup({ delay: null });
    const dialog = await openRevoke(user);
    await user.type(within(dialog).getByLabelText('Lý do thu hồi'), 'Người dùng đã chuyển công tác');
    await user.click(within(dialog).getByRole('button', { name: 'Thu hồi' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xác thực' }));
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    const keys = command.mock.calls.map((call) => (call[1] as { attempt: { key: string } }).attempt.key);
    expect(keys[1]).toBe(keys[0]);
  });
});
