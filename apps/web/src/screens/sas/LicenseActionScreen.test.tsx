import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import LicenseActionScreen from './LicenseActionScreen';
import { PLATFORM_OPERATOR, harness, mount, routeOf } from './test-support';

const ROUTE = routeOf('SAS-15', 'FR-SAS-15');
const LICENSE_ADMIN = ['system.license.manage', 'system.tenant.read'];
const LICENSE = '00000000-0000-4000-8000-0000000000c1';
const TENANT = '00000000-0000-4000-8000-0000000000a1';
const PATH = `/sas/sas-15?license=${LICENSE}`;
const REASON = 'The contract was terminated by the agency.';

let status = 'Active';
let version = 3;

const license = () => ({
  id: LICENSE,
  tenant_id: TENANT,
  serial: 'LIC-20261023-0001',
  revision: 1,
  edition: 'STANDARD',
  status,
  valid_from: '2026-10-01T00:00:00.000Z',
  valid_until: '2027-10-01T00:00:00.000Z',
  grace_until: '2027-10-31T00:00:00.000Z',
  quota: {},
  issuer: 'machvon-platform',
  key_id: 'kid-2026',
  entitlement_version_id: '00000000-0000-4000-8000-0000000000b1',
  signature_check: 'VALID',
  expiring: false,
  version,
});

function answer(operation: string): unknown {
  return operation === 'getSystemLicense' ? license() : new Error('unexpected read');
}

const open = (state: string, permissions: readonly string[] | undefined = LICENSE_ADMIN, command?: (operation: string, input: unknown) => unknown, path = PATH) => {
  status = state;
  version = 3;
  const h = harness(answer, command);
  mount(<LicenseActionScreen route={ROUTE} />, h, permissions, path);
  return h;
};

const submitButton = (action: string): HTMLElement => screen.getByRole('button', { name: vi_['sas.licenseAction.submit.action'].replace('{action}', action) });
const label = (key: keyof typeof vi_): string => vi_[key];

afterEach(cleanup);

describe('SAS-15 suspend, reinstate and revoke a license', () => {
  it('shows the scope, the state, the effect on the data and the propagation SLO, and sends nothing yet', async () => {
    const h = open('Active');
    expect(await screen.findByText(vi_['sas.licenseAction.scope.text'].replace('{serial}', 'LIC-20261023-0001').replace('{revision}', '1'))).toBeTruthy();
    expect(screen.getByText(vi_['sas.license.status.active'])).toBeTruthy();
    expect(screen.getByText(vi_['sas.licenseAction.effective.text'])).toBeTruthy();
    expect(screen.getByText(vi_['sas.licenseAction.slo.text'])).toBeTruthy();
    expect(document.querySelector('[data-consequence="suspend"]')?.textContent).toContain(vi_['sas.licenseAction.consequence.suspend']);
    expect(screen.getByRole('heading', { level: 1, name: vi_['sas.licenseAction.page.title'] })).toBeTruthy();
    expect(screen.getByText(vi_['sas.licenseAction.footer.reference'].replace('{id}', 'SAS-15').replace('{req}', 'FR-SAS-15'))).toBeTruthy();
    expect(h.command).not.toHaveBeenCalled();
  });

  it.each([
    ['Scheduled', ['sas.licenseAction.action.suspend', 'sas.licenseAction.action.revoke']],
    ['Active', ['sas.licenseAction.action.suspend', 'sas.licenseAction.action.revoke']],
    ['Grace', ['sas.licenseAction.action.suspend', 'sas.licenseAction.action.revoke']],
    ['Suspended', ['sas.licenseAction.action.reinstate', 'sas.licenseAction.action.revoke']],
    ['Revoked', []],
    ['Expired', []],
    ['Superseded', []],
    ['Draft', []],
  ] as const)('offers for a %s license exactly the actions the state machine allows', async (state, keys) => {
    open(state);
    await screen.findByText(vi_['sas.licenseAction.scope.text'].replace('{serial}', 'LIC-20261023-0001').replace('{revision}', '1'));
    expect(screen.queryAllByRole('radio').map((radio) => (radio.parentElement?.textContent ?? '').trim())).toEqual(keys.map((key) => vi_[key]));
    if (keys.length === 0) expect(screen.getByText(vi_['sas.licenseAction.none.notice'].replace('{status}', vi_[`sas.license.status.${state.toLowerCase()}` as keyof typeof vi_]))).toBeTruthy();
  });

  it('explains each action in turn: nothing is deleted, a revocation is for good', async () => {
    const user = userEvent.setup();
    open('Active');
    await screen.findByRole('radio', { name: label('sas.licenseAction.action.revoke') });
    await user.click(screen.getByRole('radio', { name: label('sas.licenseAction.action.revoke') }));
    expect(document.querySelector('[data-consequence="revoke"]')?.textContent).toContain(vi_['sas.licenseAction.consequence.revoke']);
    expect(screen.getByLabelText(vi_['sas.licenseAction.revoke.confirm'])).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: label('sas.licenseAction.action.suspend') }));
    expect(screen.queryByLabelText(vi_['sas.licenseAction.revoke.confirm'])).toBeNull();
    cleanup();
    open('Suspended');
    await screen.findByRole('radio', { name: label('sas.licenseAction.action.reinstate') });
    expect(document.querySelector('[data-consequence="reinstate"]')?.textContent).toContain(vi_['sas.licenseAction.consequence.reinstate']);
  });

  it('refuses a reason that is too short and sends nothing', async () => {
    const user = userEvent.setup();
    const h = open('Active');
    await user.type(await screen.findByLabelText(vi_['sas.licenseAction.field.reason']), 'short');
    await user.click(submitButton(vi_['sas.licenseAction.action.suspend']));
    expect(screen.getByText(vi_['sas.licenseAction.reason.tooShort'])).toBeTruthy();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('suspends with the version the screen showed, one command for a double click, and reports the new version', async () => {
    const user = userEvent.setup();
    const h = open('Active', LICENSE_ADMIN, () => {
      status = 'Suspended';
      version = 4;
      return { operation_id: 'o', status: 'SUSPENDED', resource_version: 4, resource_id: LICENSE };
    });
    await user.type(await screen.findByLabelText(vi_['sas.licenseAction.field.reason']), `  ${REASON}  `);
    await user.dblClick(submitButton(vi_['sas.licenseAction.action.suspend']));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    const [operation, input] = h.command.mock.calls[0] as [string, { path: { id: string }; body: { reason: string }; ifMatchVersion: number }];
    expect(operation).toBe('suspendLicense');
    expect(input.path.id).toBe(LICENSE);
    expect(input.body).toEqual({ reason: REASON });
    expect(input.ifMatchVersion).toBe(3);
    expect(await screen.findByText((content) => content.startsWith(vi_['sas.licenseAction.done.notice'].replace('{action}', vi_['sas.licenseAction.action.suspend']).replace('{version}', '4')))).toBeTruthy();
    expect(screen.getByRole('link', { name: vi_['sas.licenseAction.done.link'] }).getAttribute('href')).toBe(`/sas/sas-13?license=${LICENSE}`);
  });

  it('refreshes the license after the command, so the next action is the one the new state allows', async () => {
    const user = userEvent.setup();
    open('Active', LICENSE_ADMIN, () => {
      status = 'Suspended';
      version = 4;
      return { operation_id: 'o', status: 'SUSPENDED', resource_version: 4, resource_id: LICENSE };
    });
    await user.type(await screen.findByLabelText(vi_['sas.licenseAction.field.reason']), REASON);
    await user.click(submitButton(vi_['sas.licenseAction.action.suspend']));
    expect(await screen.findByRole('radio', { name: label('sas.licenseAction.action.reinstate') })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: label('sas.licenseAction.action.suspend') })).toBeNull();
    expect((screen.getByLabelText(vi_['sas.licenseAction.field.reason']) as HTMLTextAreaElement).value).toBe('');
  });

  it('reinstates a suspended license with the reinstate command and a primary button', async () => {
    const user = userEvent.setup();
    const h = open('Suspended', LICENSE_ADMIN, () => ({ operation_id: 'o', status: 'REINSTATED', resource_version: 4, resource_id: LICENSE }));
    await user.type(await screen.findByLabelText(vi_['sas.licenseAction.field.reason']), REASON);
    const button = submitButton(vi_['sas.licenseAction.action.reinstate']);
    expect(button.className).toBe('primary');
    await user.click(button);
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('reinstateLicense');
  });

  it('revokes only after the person confirmed that it is final, with the revoke command', async () => {
    const user = userEvent.setup();
    const h = open('Active', LICENSE_ADMIN, () => ({ operation_id: 'o', status: 'REVOKED', resource_version: 4, resource_id: LICENSE }));
    await user.click(await screen.findByRole('radio', { name: label('sas.licenseAction.action.revoke') }));
    await user.type(screen.getByLabelText(vi_['sas.licenseAction.field.reason']), REASON);
    const button = submitButton(vi_['sas.licenseAction.action.revoke']);
    expect(button.className).toBe('danger');
    await user.click(button);
    expect(screen.getByText(vi_['sas.licenseAction.revoke.unconfirmed'])).toBeTruthy();
    expect(h.command).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText(vi_['sas.licenseAction.revoke.confirm']));
    await user.click(button);
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('post_licenses_id_revoke');
    expect((h.command.mock.calls[0]?.[1] as { ifMatchVersion: number }).ifMatchVersion).toBe(3);
  });

  it('shows the server refusals in words: a state that changed, a stale version with the current one, and a denial', async () => {
    const user = userEvent.setup();
    let failure = new ApiError({ status: 409, code: 'LICENSE_STATE_INVALID', correlationId: 'c' });
    open('Active', LICENSE_ADMIN, () => failure);
    await user.type(await screen.findByLabelText(vi_['sas.licenseAction.field.reason']), REASON);
    await user.click(submitButton(vi_['sas.licenseAction.action.suspend']));
    expect(await screen.findByText(vi_['sas.license.error.stateInvalid'])).toBeTruthy();
    failure = new ApiError({ status: 409, code: 'VERSION_CONFLICT', correlationId: 'c', extensions: { current_version: 7 } });
    await user.click(submitButton(vi_['sas.licenseAction.action.suspend']));
    expect(await screen.findByText(vi_['sas.license.error.conflict'].replace('{version}', '7'))).toBeTruthy();
    failure = new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' });
    await user.click(submitButton(vi_['sas.licenseAction.action.suspend']));
    expect(await screen.findByText(vi_['sas.license.error.denied'])).toBeTruthy();
  });

  it('gives a registry reader the reading only: a notice and no form', async () => {
    open('Active', PLATFORM_OPERATOR);
    expect(await screen.findByText(vi_['sas.licenseAction.readOnly.notice'])).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText(vi_['sas.licenseAction.field.reason'])).toBeNull();
  });

  it('shows the form when the session does not state its permissions', async () => {
    open('Active', undefined);
    expect(await screen.findByLabelText(vi_['sas.licenseAction.field.reason'])).toBeTruthy();
  });

  it('asks to be opened from a license when the address names none, and reads nothing', () => {
    status = 'Active';
    const h = harness(answer);
    mount(<LicenseActionScreen route={ROUTE} />, h, LICENSE_ADMIN, '/sas/sas-15');
    expect(screen.getByText(vi_['sas.licenseAction.missing.notice'])).toBeTruthy();
    expect(h.read).not.toHaveBeenCalled();
  });

  describe('the seven states', () => {
    const fail = (error: ApiError) => (): unknown => error;
    const mountFailing = (error: ApiError) => mount(<LicenseActionScreen route={ROUTE} />, harness(fail(error)), LICENSE_ADMIN, PATH);

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
      mountFailing(new ApiError({ status: 500, code: 'INTERNAL_ERROR', correlationId: 'c' }));
      expect(await screen.findByText(vi_['states.error.title'])).toBeTruthy();
    });
  });
});
