import { ApiError } from '@machvon/api-client';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import { TENANT, harness, mount, routeOf } from '../doc/test-support';
import { SECOND_TENANT, mountInSession } from './security/test-support';
import SecurityPolicyScreen from './SecurityPolicyScreen';

const ROUTE = routeOf('ADM-14', 'FR-ADM-14');
const OTHER = '00000000-0000-4000-8000-0000000000ee';
const AUTHOR = ['adm.security.manage', 'adm.security.read'];
const APPROVER = ['adm.security.approve', 'adm.security.read'];
const READER = ['adm.security.read'];

const policy = (id: string, revision: number, status: string, createdBy: string, extra: Record<string, unknown> = {}) => ({
  id,
  revision,
  status,
  mfa_required_roles: ['LEADER'],
  session_idle_minutes: 30,
  session_max_hours: 8,
  ip_allowlist: ['10.0.0.0/8'],
  download_ttl_minutes: 15,
  export_watermark: true,
  created_by: createdBy,
  approved_by: status === 'Draft' ? null : OTHER,
  published_at: status === 'Draft' ? null : '2026-10-01T00:00:00Z',
  version: status === 'Draft' ? 1 : 2,
  ...extra,
});

const ITEMS = [policy('p3', 3, 'Draft', OTHER), policy('p2', 2, 'Draft', TENANT.membershipId), policy('p1', 1, 'Published', OTHER, { mfa_required_roles: ['LEADER', 'TENANT_ADMIN'] })];

function withReads(h: ReturnType<typeof harness>, items: unknown[] = ITEMS) {
  (h.client as unknown as { readAll: (operation: string) => Promise<unknown[]> }).readAll = (operation: string) => {
    if (operation === 'get_resources_security_policy_version') return Promise.resolve(items);
    if (operation === 'get_resources_role_definition') return Promise.resolve([{ code: 'LEADER' }, { code: 'TENANT_ADMIN' }, { code: 'AUDITOR' }, { id: 1 }]);
    return Promise.reject(new Error('unexpected read'));
  };
  return h;
}

afterEach(cleanup);

const ready = () => waitFor(() => expect(document.querySelector('[data-policy-id="p1"]')).not.toBeNull());
const rowOf = (id: string): HTMLElement => document.querySelector(`[data-policy-id="${id}"]`) as HTMLElement;
const setNumber = async (user: ReturnType<typeof userEvent.setup>, label: string, value: string): Promise<void> => {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  if (value !== '') await user.type(input, value);
};

describe('SecurityPolicyScreen (ADM-14)', () => {
  it('shows the version in force, the history newest first, and says what is not enforced yet (AC-ST-ADM-009-2)', async () => {
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read'))), AUTHOR);
    await ready();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(vi_['adm.securityPolicy.page.title']);
    expect(within(screen.getByTestId('policy-in-force')).getByText('LEADER, TENANT_ADMIN')).toBeTruthy();
    const rows = [...document.querySelectorAll('[data-policy-id]')].map((row) => row.getAttribute('data-policy-id'));
    expect(rows).toEqual(['p3', 'p2', 'p1']);
    expect(screen.getByText(vi_['adm.securityPolicy.enforcement.note'])).toBeTruthy();
  });

  it('says so when the tenant has published nothing', async () => {
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read')), [policy('p2', 2, 'Draft', OTHER)]), AUTHOR);
    expect(await screen.findByTestId('no-policy')).toBeTruthy();
  });

  it('refuses limits outside the schema and an idle time longer than the session before anything is sent', async () => {
    const h = withReads(harness(() => new Error('no read')));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, AUTHOR);
    await ready();
    const user = userEvent.setup();
    await setNumber(user, vi_['adm.securityPolicy.idle.label'], '2');
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }));
    expect(await screen.findByText(vi_['adm.securityPolicy.field.range'])).toBeTruthy();
    await setNumber(user, vi_['adm.securityPolicy.idle.label'], '180');
    await setNumber(user, vi_['adm.securityPolicy.hours.label'], '2');
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }));
    expect(await screen.findByText(vi_['adm.securityPolicy.field.order'])).toBeTruthy();
    await setNumber(user, vi_['adm.securityPolicy.hours.label'], '');
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }));
    expect(await screen.findByText(vi_['adm.securityPolicy.field.required'])).toBeTruthy();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('saves a draft with the chosen roles, limits and allowlist, once', async () => {
    const h = withReads(harness(() => new Error('no read'), () => ({ status: 'DRAFTED', resource_version: 1, resource_id: 'p9' })));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, AUTHOR);
    await ready();
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('AUDITOR'));
    await user.click(screen.getByLabelText('LEADER'));
    await setNumber(user, vi_['adm.securityPolicy.idle.label'], '45');
    await setNumber(user, vi_['adm.securityPolicy.hours.label'], '10');
    await setNumber(user, vi_['adm.securityPolicy.ttl.label'], '20');
    await user.click(screen.getByLabelText(vi_['adm.securityPolicy.ip.label']));
    await user.paste('10.1.0.0/16\n\n  203.0.113.7  \n');
    await user.click(screen.getByLabelText(vi_['adm.securityPolicy.watermark.label']));
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('createSecurityPolicyVersion');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({
      body: { mfa_required_roles: ['AUDITOR', 'LEADER'], session_idle_minutes: 45, session_max_hours: 10, ip_allowlist: ['10.1.0.0/16', '203.0.113.7'], download_ttl_minutes: 20, export_watermark: true },
    });
    expect(await screen.findByText(vi_['adm.securityPolicy.draft.accepted.notice'])).toBeTruthy();
  });

  it('starts a draft from the version in force', async () => {
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read'))), AUTHOR);
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.copy.action'] }));
    expect((screen.getByLabelText('TENANT_ADMIN') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(vi_['adm.securityPolicy.ip.label']) as HTMLTextAreaElement).value).toBe('10.0.0.0/8');
    expect((screen.getByLabelText(vi_['adm.securityPolicy.ttl.label']) as HTMLInputElement).value).toBe('15');
  });

  it.each([
    ['POLICY_INVALID', 422, 'mfa_required_roles', 'adm.securityPolicy.error.roles'],
    ['POLICY_INVALID', 422, 'ip_allowlist', 'adm.securityPolicy.error.allowlist'],
    ['POLICY_INVALID', 422, 'session_idle_minutes', 'adm.securityPolicy.error.limits'],
    ['SCOPE_DENIED', 403, undefined, 'adm.securityPolicy.error.denied'],
  ] as const)('shows what the server refused for a draft: %s %s', async (code, status, detail, key) => {
    const h = withReads(harness(() => new Error('no read'), () => new ApiError({ status, code, correlationId: 'c', detail })));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, AUTHOR);
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }));
    expect(await screen.findByText(vi_[key])).toBeTruthy();
  });

  it('lets the second person publish a draft, with a reason and the version of the row', async () => {
    const h = withReads(harness(() => new Error('no read'), () => ({ status: 'PUBLISHED', resource_version: 2, resource_id: 'p3' })));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, APPROVER);
    await ready();
    const user = userEvent.setup();
    expect(within(rowOf('p1')).queryByRole('button', { name: vi_['adm.securityPolicy.publish.action'] })).toBeNull();
    await user.click(within(rowOf('p3')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }));
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.publish.confirm.action'] }));
    expect(await screen.findByText(vi_['adm.securityPolicy.field.required'])).toBeTruthy();
    expect(h.command).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(vi_['adm.securityPolicy.publish.reason.label']), 'Second reviewer approves');
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.publish.confirm.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('publishSecurityPolicy');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { policyId: 'p3' }, ifMatchVersion: 1, body: { reason: 'Second reviewer approves' } });
    expect(await screen.findByText(vi_['adm.securityPolicy.publish.accepted.notice'])).toBeTruthy();
  });

  it('does not let the author publish their own draft: the button is disabled and explains why', async () => {
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read'))), [...AUTHOR, ...APPROVER]);
    await ready();
    const own = within(rowOf('p2')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }) as HTMLButtonElement;
    expect(own.disabled).toBe(true);
    expect(own.title).toBe(vi_['adm.securityPolicy.publish.selfApproval.hint']);
    expect((within(rowOf('p3')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['SELF_APPROVAL_DENIED', 403, 'adm.securityPolicy.error.selfApproval'],
    ['VERSION_CONFLICT', 409, 'adm.securityPolicy.error.conflict'],
    ['STAGE_TRANSITION_DENIED', 409, 'adm.securityPolicy.error.stage'],
  ] as const)('shows what the server refused for a publication: %s', async (code, status, key) => {
    const h = withReads(harness(() => new Error('no read'), () => new ApiError({ status, code, correlationId: 'c' })));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, APPROVER);
    await ready();
    const user = userEvent.setup();
    await user.click(within(rowOf('p3')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }));
    await user.type(screen.getByLabelText(vi_['adm.securityPolicy.publish.reason.label']), 'Second reviewer approves');
    await user.click(screen.getByRole('button', { name: vi_['adm.securityPolicy.publish.confirm.action'] }));
    expect(await screen.findByText(vi_[key])).toBeTruthy();
  });

  it('offers a reader the versions without the draft or publish actions', async () => {
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read'))), READER);
    await ready();
    expect(screen.getByText(vi_['adm.securityPolicy.readOnly.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] })).toBeNull();
    expect(screen.queryByRole('button', { name: vi_['adm.securityPolicy.publish.action'] })).toBeNull();
  });

  it('starts over when the person switches tenant: a draft typed for one tenant is never saved into another', async () => {
    const h = withReads(harness(() => new Error('no read')));
    const view = mountInSession(<SecurityPolicyScreen route={ROUTE} />, h, { permissions: [...AUTHOR, ...APPROVER] });
    await ready();
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('AUDITOR'));
    await setNumber(user, vi_['adm.securityPolicy.idle.label'], '45');
    await user.click(screen.getByLabelText(vi_['adm.securityPolicy.watermark.label']));
    await user.click(within(rowOf('p3')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }));
    await user.type(screen.getByLabelText(vi_['adm.securityPolicy.publish.reason.label']), 'Second reviewer');
    view.rerenderWith({ permissions: [...AUTHOR, ...APPROVER], tenant: SECOND_TENANT });
    await ready();
    expect((screen.getByLabelText('AUDITOR') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(vi_['adm.securityPolicy.idle.label']) as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText(vi_['adm.securityPolicy.watermark.label']) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText(vi_['adm.securityPolicy.publish.reason.label'])).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('is read-only in a suspended tenant: no draft, no publication, whatever the grants say', async () => {
    mountInSession(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read'))), { permissions: [...AUTHOR, ...APPROVER], mode: 'READ_ONLY' });
    await ready();
    expect(screen.getByText(vi_['adm.securityPolicy.frozen.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] })).toBeNull();
    expect(screen.queryByRole('button', { name: vi_['adm.securityPolicy.publish.action'] })).toBeNull();
  });

  it('stops a publication that was opened before the tenant was suspended', async () => {
    const h = withReads(harness(() => new Error('no read'), () => ({ status: 'PUBLISHED', resource_version: 2, resource_id: 'p3' })));
    const view = mountInSession(<SecurityPolicyScreen route={ROUTE} />, h, { permissions: APPROVER });
    await ready();
    const user = userEvent.setup();
    await user.click(within(rowOf('p3')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }));
    await user.type(screen.getByLabelText(vi_['adm.securityPolicy.publish.reason.label']), 'Second reviewer approves');
    view.rerenderWith({ permissions: APPROVER, mode: 'READ_ONLY' });
    await ready();
    expect(screen.queryByRole('button', { name: vi_['adm.securityPolicy.publish.confirm.action'] })).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('does not create a second revision from a draft that was just accepted, until the form is edited', async () => {
    const h = withReads(harness(() => new Error('no read'), () => ({ status: 'DRAFTED', resource_version: 1, resource_id: 'p9' })));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, AUTHOR);
    await ready();
    const user = userEvent.setup();
    const save = (): HTMLButtonElement => screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }) as HTMLButtonElement;
    await user.click(save());
    await screen.findByText(vi_['adm.securityPolicy.draft.accepted.notice']);
    expect(save().disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: vi_['adm.securityPolicy.form.title'] }));
    expect(h.command).toHaveBeenCalledTimes(1);
    // Any edit makes it a different policy: it can be saved as a new draft.
    await setNumber(user, vi_['adm.securityPolicy.idle.label'], '45');
    expect(save().disabled).toBe(false);
    await user.click(save());
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(2));
    // Back to the text that was accepted first: only the last accepted text is guarded.
    await setNumber(user, vi_['adm.securityPolicy.idle.label'], '30');
    expect(save().disabled).toBe(false);
  });

  it('shows every persisted field of a draft before it is published', async () => {
    const other = policy('p4', 4, 'Draft', OTHER, { mfa_required_roles: ['AUDITOR'], session_idle_minutes: 20, session_max_hours: 6, ip_allowlist: ['192.0.2.0/24', '203.0.113.7'], download_ttl_minutes: 45, export_watermark: false });
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read')), [other, ...ITEMS]), APPROVER);
    await ready();
    const user = userEvent.setup();
    await user.click(within(rowOf('p4')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }));
    const preview = screen.getByTestId('publish-preview');
    expect(preview.textContent).toContain('AUDITOR');
    expect(preview.textContent).toContain('192.0.2.0/24, 203.0.113.7');
    expect(preview.textContent).toContain('45');
    expect(preview.textContent).toContain(vi_['adm.securityPolicy.preview.watermark.off']);
    expect(preview.textContent).toContain(vi_['adm.securityPolicy.session.summary'].replace('{idle}', '20').replace('{hours}', '6'));
  });

  it('says so in the preview when a draft leaves the optional fields empty', async () => {
    const bare = policy('p5', 5, 'Draft', OTHER, { ip_allowlist: [], download_ttl_minutes: null, export_watermark: true });
    mount(<SecurityPolicyScreen route={ROUTE} />, withReads(harness(() => new Error('no read')), [bare, ITEMS[2]]), APPROVER);
    await waitFor(() => expect(document.querySelector('[data-policy-id="p5"]')).not.toBeNull());
    await userEvent.setup().click(within(rowOf('p5')).getByRole('button', { name: vi_['adm.securityPolicy.publish.action'] }));
    const preview = screen.getByTestId('publish-preview');
    expect(preview.textContent).toContain(vi_['adm.securityPolicy.preview.none']);
    expect(preview.textContent).toContain(vi_['adm.securityPolicy.preview.watermark.on']);
  });

  it('says when the roles cannot be read and does not let a draft be saved without them', async () => {
    const h = harness(() => new Error('no read'));
    (h.client as unknown as { readAll: (operation: string) => Promise<unknown[]> }).readAll = (operation: string) =>
      operation === 'get_resources_security_policy_version' ? Promise.resolve(ITEMS) : Promise.reject(new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, AUTHOR);
    await ready();
    expect(await screen.findByText(vi_['adm.securityPolicy.roles.error'])).toBeTruthy();
    const save = screen.getByRole('button', { name: vi_['adm.securityPolicy.draft.submit.action'] }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: vi_['adm.securityPolicy.form.title'] }));
    expect(h.command).not.toHaveBeenCalled();
  });

  it('shows the denied state when the policy may not be read (AC-ST-ADM-009-2)', async () => {
    const h = harness(() => new Error('no read'));
    (h.client as unknown as { readAll: () => Promise<unknown[]> }).readAll = () => Promise.reject(new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }));
    mount(<SecurityPolicyScreen route={ROUTE} />, h, READER);
    expect(await screen.findByText(vi_['states.denied.title'])).toBeTruthy();
  });
});
