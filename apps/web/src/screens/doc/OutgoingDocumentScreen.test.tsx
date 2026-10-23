import { ApiError } from '@machvon/api-client';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import OutgoingDocumentScreen from './OutgoingDocumentScreen';
import { vietnamDateOf } from './outgoing/rules';
import { harness, mount, routeOf } from './test-support';

const ROUTE = routeOf('DOC-06', 'FR-DOC-06');
const DOC = '00000000-0000-4000-8000-0000000000d1';
const CLERK = ['doc.outgoing.read', 'doc.outgoing.number', 'doc.outgoing.seal', 'doc.outgoing.sign', 'doc.register.read'];
const NOW = new Date();
const future = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

const row = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  title: 'Decision to assign capital',
  doc_type_code: 'QD',
  status: 'SIGNED',
  document_number: null,
  symbol: null,
  issued_on: null,
  current_version_id: 'v2',
  leader_signed_at: new Date(NOW.getTime() - 60_000).toISOString(),
  numbered_at: null,
  sealed_at: null,
  created_at: '2026-10-23T02:00:00Z',
  version: 2,
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...row(),
  sessions: [],
  versions: [],
  certificates: [{ id: 'oc1', kind: 'ORGANIZATION', subject_dn: 'CN=Cao Bang Seal', issuer_dn: 'CN=CA', valid_until: '2027-01-01T00:00:00Z', status: 'Active' }],
  signatures: [],
  ...overrides,
});

const register = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  register_code: 'UBND',
  name: 'Outgoing',
  direction: 'OUTGOING',
  organization_unit_id: 'u1',
  year: NOW.getFullYear(),
  mode: 'MANAGED',
  last_number: 4,
  next_number: 5,
  status: 'OPEN',
  scope_doc_types: ['QD'],
  version: 1,
  ...overrides,
});

const docType = { id: 't1', code: 'QD', name: 'Decision', abbreviation: 'QD', symbol_kind: 'DECISION', symbol_pattern: '{number}/{type}-{agency}', register_code: 'REG', effective_from: '2026-01-01', effective_until: null, status: 'PUBLISHED', version: 1 };

function answer(current: () => Record<string, unknown>, registers: unknown[] = [register()]) {
  return (operation: string, input: unknown): unknown => {
    if (operation === 'listOutgoingDocuments') {
      const status = (input as { query: { status: string } }).query.status;
      const own = current();
      return { items: own.status === status ? [own] : [], next_cursor: null };
    }
    if (operation === 'getOutgoingDocument') return current();
    if (operation === 'listDocumentNumberRegisters') return { items: registers, doc_types: [docType], next_cursor: null };
    if (operation === 'get_resources_organization_unit') return { items: [{ id: 'u1', code: 'CB', name: 'Unit' }], next_cursor: null };
    return new Error(`unexpected read ${operation}`);
  };
}

afterEach(cleanup);

describe('OutgoingDocumentScreen (DOC-06)', () => {
  it('shows the seven step cards, the next number of the register and the expected symbol', async () => {
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(answer(() => detail())), CLERK);
    expect(await screen.findByText(vi_['doc.outgoing.step.void.title'])).toBeTruthy();
    expect(document.querySelectorAll('[data-step]')).toHaveLength(7);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(vi_['doc.outgoing.page.title']);
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.symbol.label']) as HTMLInputElement).value).toBe('05/QD-UBND'));
    expect(screen.getByText(vi_['doc.outgoing.register.next'].replace('{number}', '05'))).toBeTruthy();
    expect(screen.getByText(vi_['doc.outgoing.version.pill'].replace('{version}', '2'))).toBeTruthy();
  });

  it('numbers the document from the chosen register on the issue date, with the version it saw', async () => {
    const h = harness(answer(() => detail()), () => ({ status: 'NUMBERED', resource_id: DOC, resource_version: 3 }));
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, CLERK);
    const user = userEvent.setup();
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.register.label']) as HTMLSelectElement).value).toBe('r1'));
    await user.click(screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('assignOutgoingDocumentNumber');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { id: DOC }, ifMatchVersion: 2, body: { register_id: 'r1' } });
  });

  it('refuses an issue date in the future in the browser and names the problem the server gives', async () => {
    const h = harness(answer(() => detail()), () => new ApiError({ status: 409, code: 'REGISTER_NOT_OPEN', correlationId: 'c' }));
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, CLERK);
    const user = userEvent.setup();
    const date = await screen.findByLabelText(vi_['doc.outgoing.date.label']);
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.register.label']) as HTMLSelectElement).value).toBe('r1'));
    await user.clear(date);
    await user.type(date, '2999-01-01');
    await user.click(screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }));
    expect((await screen.findByRole('alert')).textContent).toBe(vi_['doc.outgoing.date.problem.future']);
    expect(h.command).not.toHaveBeenCalled();
    await user.clear(date);
    // The screen judges the issue date in Vietnam time: the UTC date is the day before for seven hours of every day.
    await user.type(date, vietnamDateOf(NOW));
    await user.click(screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(vi_['doc.outgoing.problem.registerNotOpen']));
  });

  it('says there is no open register and keeps the number button off', async () => {
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(answer(() => detail(), [register({ status: 'CLOSED' })])), CLERK);
    expect(await screen.findByText(vi_['doc.outgoing.register.none'])).toBeTruthy();
    expect((screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a later page of registers could not be read, keeps the number button off and reads the page again on request', async () => {
    let pageTwoFails = true;
    const base = answer(() => detail(), [register({ status: 'CLOSED' })]);
    const reads = (operation: string, input: unknown): unknown => {
      if (operation === 'listDocumentNumberRegisters') {
        const cursor = (input as { query?: { cursor?: string } }).query?.cursor;
        if (cursor === undefined) return { items: [register({ status: 'CLOSED' })], doc_types: [docType], next_cursor: 'p2' };
        if (pageTwoFails) return new ApiError({ status: 503, code: 'UNAVAILABLE', correlationId: 'c' });
        return { items: [register({ id: 'r2', register_code: 'LATE' })], doc_types: [docType], next_cursor: null };
      }
      return base(operation, input);
    };
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(reads), CLERK);
    const user = userEvent.setup();
    expect((await screen.findByText(vi_['doc.outgoing.register.error.text'])).closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText(vi_['doc.outgoing.register.none'])).toBeNull();
    expect((screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }) as HTMLButtonElement).disabled).toBe(true);
    pageTwoFails = false;
    await user.click(screen.getByRole('button', { name: vi_['doc.outgoing.register.retry.action'] }));
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.register.label']) as HTMLSelectElement).value).toBe('r2'));
    expect(screen.queryByText(vi_['doc.outgoing.register.error.text'])).toBeNull();
  });

  it('starts the seal with the organisation certificate once the document is numbered', async () => {
    const numbered = detail({ status: 'NUMBERED', document_number: 5, symbol: '05/QD-UBND', issued_on: '2026-10-23', numbered_at: NOW.toISOString(), version: 3 });
    const h = harness(answer(() => numbered), () => ({ status: 'AWAITING_SIGNER', resource_id: 's2', resource_version: 1 }));
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, CLERK);
    const user = userEvent.setup();
    expect(await screen.findByText(vi_['doc.outgoing.numbered.notice'].replace('{number}', '05').replace('{symbol}', '05/QD-UBND'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: vi_['doc.outgoing.seal.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('startOrganizationSeal');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { id: DOC }, ifMatchVersion: 3, body: { certificate_id: 'oc1' } });
  });

  it('completes an open seal session', async () => {
    const withSession = detail({
      status: 'NUMBERED',
      document_number: 5,
      symbol: '05/QD-UBND',
      numbered_at: NOW.toISOString(),
      version: 3,
      sessions: [{ id: 's2', role: 'ORGANIZATION', status: 'AWAITING_SIGNER', adapter_code: 'MOCK', adapter_status: 'MOCK', expires_at: future(10), created_at: NOW.toISOString(), version: 1 }],
    });
    const h = harness(answer(() => withSession), () => ({ status: 'SEALED', resource_id: 's2', resource_version: 2 }));
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, CLERK);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.outgoing.sealComplete.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('completeSigningSession');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { id: 's2' }, ifMatchVersion: 1, body: {} });
  });

  it('links a sealed document to the verification of both signatures', async () => {
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(answer(() => detail({ status: 'SEALED', document_number: 5, symbol: '05/QD-UBND', sealed_at: NOW.toISOString() }))), CLERK, '/?doc=' + DOC);
    expect((await screen.findByText(vi_['doc.outgoing.sealed.verify.link'])).getAttribute('href')).toBe('/doc/doc-07?version=v2');
  });

  it('hides the actions from someone without the numbering or the seal permission', async () => {
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(answer(() => detail())), ['doc.outgoing.read']);
    expect(await screen.findByText(vi_['doc.outgoing.denied.number'])).toBeTruthy();
    cleanup();
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(answer(() => detail({ status: 'NUMBERED', document_number: 5 }))), ['doc.outgoing.read']);
    expect(await screen.findByText(vi_['doc.outgoing.denied.seal'])).toBeTruthy();
  });

  it('shows the empty queue and the error state', async () => {
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(answer(() => detail({ status: 'SUBMITTED' }))), CLERK);
    expect(await screen.findByText(vi_['states.empty.title'])).toBeTruthy();
    cleanup();
    mount(<OutgoingDocumentScreen route={ROUTE} />, harness(() => new ApiError({ status: 500, code: 'INTERNAL_ERROR', correlationId: 'c' })), CLERK);
    expect(await screen.findByText(vi_['states.error.title'])).toBeTruthy();
  });
});
