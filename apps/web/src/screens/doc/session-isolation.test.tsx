import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import DocumentTypesScreen from './DocumentTypesScreen';
import NumberRegistersScreen from './NumberRegistersScreen';
import OutgoingDocumentScreen from './OutgoingDocumentScreen';
import SignatureReportScreen from './SignatureReportScreen';
import SigningSessionScreen from './SigningSessionScreen';
import { CLERK, SECOND_TENANT, TENANT, harness, mountInSession, routeOf } from './test-support';

// A draft belongs to the tenant it was written in, and a suspended tenant (READ_ONLY session) can be read, not changed.

afterEach(cleanup);

const UNIT = '00000000-0000-4000-8000-000000000f01';
const TYPES = [
  { id: 't1', code: 'QD', name: 'Decision', abbreviation: 'QD', symbol_kind: 'DECISION', symbol_pattern: '{number}/{type}-{agency}', register_code: 'REG-QD', effective_from: '2026-01-01', effective_until: null, status: 'PUBLISHED', version: 1 },
];
const REGISTER = {
  id: 'r1',
  register_code: 'UBND',
  name: 'Outgoing',
  direction: 'OUTGOING',
  organization_unit_id: UNIT,
  year: new Date().getFullYear(),
  mode: 'MANAGED',
  last_number: 4,
  next_number: 5,
  status: 'OPEN',
  scope_doc_types: ['QD'],
  version: 3,
};

function withUnits<T extends ReturnType<typeof harness>>(h: T, reads: Array<() => Promise<unknown[]>> = []): T {
  let call = 0;
  (h.client as unknown as { readAll: () => Promise<unknown[]> }).readAll = () => {
    const next = reads[call];
    call += 1;
    return next === undefined ? Promise.resolve([{ id: UNIT, code: 'U1', name: 'Board' }]) : next();
  };
  return h;
}

const registersAnswer = (operation: string): unknown => (operation === 'listDocumentNumberRegisters' ? { items: [REGISTER], next_cursor: null, doc_types: TYPES } : new Error('unexpected read'));

describe('DocumentTypesScreen (DOC-21): tenants, suspension and the units', () => {
  const ROUTE = routeOf('DOC-21', 'FR-DOC-21');
  const ready = () => waitFor(() => expect(document.querySelector('[data-type-code="QD"]')).not.toBeNull());

  it('starts over when the person switches tenant: neither form carries its draft into the other tenant', async () => {
    const h = withUnits(harness(registersAnswer, () => ({ status: 'DEFINED', resource_version: 1, resource_id: 'x' })));
    const view = mountInSession(<DocumentTypesScreen route={ROUTE} />, h, { permissions: CLERK });
    await ready();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(vi_['doc.types.code.label']), 'QD2');
    await user.type(screen.getByLabelText(vi_['doc.types.registerName.label']), 'Draft register');
    view.rerenderWith({ permissions: CLERK, tenant: SECOND_TENANT });
    await ready();
    expect((screen.getByLabelText(vi_['doc.types.code.label']) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(vi_['doc.types.registerName.label']) as HTMLInputElement).value).toBe('');
    expect(h.command).not.toHaveBeenCalled();
  });

  it('forgets an accepted notice of the other tenant too', async () => {
    const h = withUnits(harness(registersAnswer, () => ({ status: 'DEFINED', resource_version: 1, resource_id: 'x' })));
    const view = mountInSession(<DocumentTypesScreen route={ROUTE} />, h, { permissions: CLERK });
    await ready();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(vi_['doc.types.code.label']), 'QD2');
    await user.type(screen.getByLabelText(vi_['doc.types.name.label']), 'Another');
    await user.click(screen.getByLabelText(vi_['doc.types.symbolPattern.label']));
    await user.paste('{number}/{type}');
    await user.type(screen.getByLabelText(vi_['doc.types.registerCode.label'], { selector: '#type-registerCode' }), 'REG');
    await user.type(screen.getByLabelText(vi_['doc.types.legalBasis.label']), 'ND 30/2020');
    await user.type(screen.getByLabelText(vi_['doc.types.effectiveFrom.label']), '2026-02-01');
    await user.click(screen.getByRole('button', { name: vi_['doc.types.type.submit.action'] }));
    expect(await screen.findByText(vi_['doc.types.type.accepted.notice'])).toBeTruthy();
    view.rerenderWith({ permissions: CLERK, tenant: SECOND_TENANT });
    await ready();
    expect(screen.queryByText(vi_['doc.types.type.accepted.notice'])).toBeNull();
  });

  it('is read-only in a suspended tenant: no definition and no register opening, whatever the grants say', async () => {
    const h = withUnits(harness(registersAnswer));
    mountInSession(<DocumentTypesScreen route={ROUTE} />, h, { permissions: CLERK, mode: 'READ_ONLY' });
    await ready();
    expect(screen.getAllByText(vi_['doc.types.frozen.notice'])).toHaveLength(2);
    expect(screen.queryByRole('button', { name: vi_['doc.types.type.submit.action'] })).toBeNull();
    expect(screen.queryByRole('button', { name: vi_['doc.types.register.submit.action'] })).toBeNull();
  });

  it('refuses a submission from a form that was filled before the tenant was suspended', async () => {
    const h = withUnits(harness(registersAnswer, () => ({ status: 'DEFINED', resource_version: 1, resource_id: 'x' })));
    const view = mountInSession(<DocumentTypesScreen route={ROUTE} />, h, { permissions: CLERK });
    await ready();
    await userEvent.setup().type(screen.getByLabelText(vi_['doc.types.code.label']), 'QD2');
    view.rerenderWith({ permissions: CLERK, mode: 'READ_ONLY' });
    await ready();
    expect(screen.queryByRole('button', { name: vi_['doc.types.type.submit.action'] })).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('says when the units could not be read and lets the person read them again', async () => {
    const h = withUnits(harness(registersAnswer), [() => Promise.reject(new Error('units down'))]);
    mountInSession(<DocumentTypesScreen route={ROUTE} />, h, { permissions: CLERK });
    await ready();
    expect((await screen.findAllByText(vi_['doc.types.unit.failed'])).length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.types.unit.retry.action'] }));
    expect(await screen.findByRole('option', { name: 'U1 · Board' })).toBeTruthy();
    expect(screen.queryByText(vi_['doc.types.unit.failed'])).toBeNull();
  });
});

describe('NumberRegistersScreen (DOC-10): filters, tenants and suspension', () => {
  const ROUTE = routeOf('DOC-10', 'FR-DOC-10');
  const thisYear = String(new Date().getFullYear());

  it('keeps the filters when the chosen year has no register, so the person can pick another year', async () => {
    const h = harness((operation, input) => {
      if (operation !== 'listDocumentNumberRegisters') return new Error('unexpected read');
      const year = (input as { query: { year?: string } }).query.year;
      return year === thisYear ? { items: [], next_cursor: null, doc_types: [] } : { items: [REGISTER], next_cursor: null, doc_types: TYPES };
    });
    mountInSession(<NumberRegistersScreen route={ROUTE} />, h, { permissions: CLERK });
    expect(await screen.findByText(vi_['states.empty.title'])).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(vi_['doc.registers.year.label']), '');
    await user.click(screen.getByRole('button', { name: vi_['doc.registers.filter.action'] }));
    expect(await screen.findByText('UBND')).toBeTruthy();
    expect(screen.queryByText(vi_['states.empty.title'])).toBeNull();
  });

  it('keeps the filters on screen when the registers cannot be read, with the retry in the state', async () => {
    mountInSession(<NumberRegistersScreen route={ROUTE} />, harness(() => new Error('down')), { permissions: CLERK });
    expect(await screen.findByText(vi_['states.error.title'])).toBeTruthy();
    expect(screen.getByLabelText(vi_['doc.registers.year.label'])).toBeTruthy();
  });

  it('starts over when the person switches tenant: the closing in progress is not carried along', async () => {
    const h = harness(registersAnswer, () => ({ status: 'CLOSED', resource_version: 4, resource_id: 'r1' }));
    const view = mountInSession(<NumberRegistersScreen route={ROUTE} />, h, { permissions: CLERK });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.registers.close.label'].replace('{code}', 'UBND') }));
    await user.type(screen.getByLabelText(vi_['doc.registers.close.reason.label']), 'Year ended and the register is audited');
    view.rerenderWith({ permissions: CLERK, tenant: SECOND_TENANT });
    expect(await screen.findByText('UBND')).toBeTruthy();
    expect(screen.queryByLabelText(vi_['doc.registers.close.reason.label'])).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
    expect(TENANT.id).not.toBe(SECOND_TENANT.id);
  });

  it('is read-only in a suspended tenant: no closing, and a closing that was open is withdrawn', async () => {
    const h = harness(registersAnswer, () => ({ status: 'CLOSED', resource_version: 4, resource_id: 'r1' }));
    const view = mountInSession(<NumberRegistersScreen route={ROUTE} />, h, { permissions: CLERK });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.registers.close.label'].replace('{code}', 'UBND') }));
    await user.type(screen.getByLabelText(vi_['doc.registers.close.reason.label']), 'Year ended and the register is audited');
    view.rerenderWith({ permissions: CLERK, mode: 'READ_ONLY' });
    expect(await screen.findByText(vi_['doc.registers.frozen.notice'])).toBeTruthy();
    expect(screen.queryByLabelText(vi_['doc.registers.close.reason.label'])).toBeNull();
    expect(screen.queryByRole('button', { name: vi_['doc.registers.close.label'].replace('{code}', 'UBND') })).toBeNull();
    expect(h.command).not.toHaveBeenCalled();
  });
});

describe('the signing, numbering and verification screens in a suspended tenant', () => {
  const DOC = '00000000-0000-4000-8000-0000000000d1';
  const SIGNING = ['doc.outgoing.read', 'doc.outgoing.sign', 'doc.outgoing.number', 'doc.outgoing.seal', 'doc.register.read'];
  const document = (status: string) => ({
    id: DOC,
    title: 'Decision to assign capital',
    doc_type_code: 'QD',
    status,
    signer_user_id: TENANT.membershipId,
    signer_title: 'Chairman',
    current_version_id: 'v1',
    leader_signed_at: status === 'SUBMITTED' ? null : new Date(Date.now() - 60_000).toISOString(),
    created_at: '2026-10-23T02:00:00Z',
    version: 1,
    sessions: [],
    versions: [{ id: 'v1', version: 1, stage: 'RENDERED_FINAL', checksum: 'ab'.repeat(32), page_count: 1, scan_status: 'CLEAN', created_at: '2026-10-23T02:00:00Z' }],
    certificates: [
      { id: 'c1', kind: 'PERSONAL', subject_dn: 'CN=Nguyen Van A', issuer_dn: 'CN=CA', valid_until: '2027-01-01T00:00:00Z', status: 'Active' },
      { id: 'oc1', kind: 'ORGANIZATION', subject_dn: 'CN=Seal', issuer_dn: 'CN=CA', valid_until: '2027-01-01T00:00:00Z', status: 'Active' },
    ],
    signatures: [],
  });
  const outgoing =
    (status: string) =>
    (operation: string, input: unknown): unknown => {
      if (operation === 'listOutgoingDocuments') return { items: (input as { query: { status: string } }).query.status === status ? [document(status)] : [], next_cursor: null };
      if (operation === 'getOutgoingDocument') return document(status);
      if (operation === 'listDocumentNumberRegisters') return { items: [REGISTER], next_cursor: null, doc_types: TYPES };
      if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
      return new Error(`unexpected read ${operation}`);
    };

  it('offers no numbering of a signed document, with the reason', async () => {
    mountInSession(<OutgoingDocumentScreen route={routeOf('DOC-06', 'FR-DOC-06')} />, harness(outgoing('SIGNED')), { permissions: SIGNING, mode: 'READ_ONLY' });
    expect(await screen.findByText(vi_['doc.outgoing.frozen.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['doc.outgoing.assign.action'] })).toBeNull();
  });

  it('offers no seal of a numbered document, with the reason', async () => {
    mountInSession(<OutgoingDocumentScreen route={routeOf('DOC-06', 'FR-DOC-06')} />, harness(outgoing('NUMBERED')), { permissions: SIGNING, mode: 'READ_ONLY' });
    expect(await screen.findByText(vi_['doc.outgoing.frozen.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['doc.outgoing.seal.action'] })).toBeNull();
  });

  it('offers no signing of a submitted document, with the reason', async () => {
    mountInSession(<SigningSessionScreen route={routeOf('DOC-05', 'FR-DOC-05')} />, harness(outgoing('SUBMITTED')), { permissions: SIGNING, mode: 'READ_ONLY' });
    expect(await screen.findByText(vi_['doc.signing.frozen.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['doc.signing.start.action'] })).toBeNull();
  });

  it('shows the report without the form to verify again, with the reason', async () => {
    const version = '00000000-0000-4000-8000-0000000000a1';
    const h = harness((operation) => {
      if (operation === 'getDocumentSignatureReport') return { version_id: version, overall: 'VALID', signatures: [] };
      if (operation === 'get_resources_document_version_id') return { id: version, version: 1, stage: 'LEADER_SIGNED', page_count: 1, checksum: 'ab'.repeat(32), created_at: '2026-10-23T07:00:00Z' };
      return new Error(`unexpected read ${operation}`);
    });
    mountInSession(<SignatureReportScreen route={routeOf('DOC-07', 'FR-DOC-07')} />, h, { permissions: ['doc.signature.verify', 'doc.signature.read'], mode: 'READ_ONLY' }, `/?version=${version}`);
    expect(await screen.findByText(vi_['doc.signatureReport.frozen.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['doc.signatureReport.verify.action'] })).toBeNull();
  });
});
