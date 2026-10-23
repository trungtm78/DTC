import { ApiError } from '@machvon/api-client';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import OutgoingDocumentScreen from './OutgoingDocumentScreen';
import { docTypeInForce } from './outgoing/rules';
import SignatureReportScreen from './SignatureReportScreen';
import SigningSessionScreen from './SigningSessionScreen';
import { TENANT, harness, mount, routeOf } from './test-support';
import type { DocType } from './registers/types';

// Pages are followed, the document chosen stays chosen, and what is shown belongs to what was asked for.

afterEach(cleanup);

const DOC_A = '00000000-0000-4000-8000-0000000000a1';
const DOC_B = '00000000-0000-4000-8000-0000000000b2';
const NOW = new Date();
const future = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

const document = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: id === DOC_A ? 'Decision A' : 'Decision B',
  doc_type_code: 'QD',
  status: 'SIGNED',
  signer_user_id: TENANT.membershipId,
  signer_title: 'Chairman',
  register_id: null,
  document_number: null,
  symbol: null,
  issued_on: null,
  current_version_id: `v-${id.slice(-2)}`,
  leader_signed_at: new Date(NOW.getTime() - 60_000).toISOString(),
  created_at: id === DOC_A ? '2026-10-23T03:00:00Z' : '2026-10-23T02:00:00Z',
  version: 2,
  ...overrides,
});

const detail = (id: string, overrides: Record<string, unknown> = {}) => ({
  ...document(id, overrides),
  sessions: [],
  versions: [{ id: `v-${id.slice(-2)}`, version: 1, stage: 'RENDERED_FINAL', checksum: 'ab'.repeat(32), page_count: 1, scan_status: 'CLEAN', created_at: '2026-10-23T02:00:00Z' }],
  certificates: [
    { id: 'c1', kind: 'PERSONAL', subject_dn: 'CN=Nguyen Van A', issuer_dn: 'CN=CA', valid_until: '2027-01-01T00:00:00Z', status: 'Active' },
    { id: 'oc1', kind: 'ORGANIZATION', subject_dn: 'CN=Seal', issuer_dn: 'CN=CA', valid_until: '2027-01-01T00:00:00Z', status: 'Active' },
  ],
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

const type = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  code: 'QD',
  name: 'Decision',
  abbreviation: 'QD',
  symbol_kind: 'DECISION',
  symbol_pattern: '{number}/{type}-{agency}',
  register_code: 'REG',
  effective_from: '2026-01-01',
  effective_until: null,
  status: 'PUBLISHED',
  version: 1,
  ...overrides,
});

const OUTGOING = ['doc.outgoing.read', 'doc.outgoing.number', 'doc.outgoing.seal', 'doc.outgoing.sign', 'doc.register.read'];
const query = (input: unknown): Record<string, string | undefined> => (input as { query?: Record<string, string | undefined> }).query ?? {};
const pathId = (input: unknown): string => (input as { path: { id: string } }).path.id;

describe('OutgoingDocumentScreen (DOC-06): paging', () => {
  const ROUTE = routeOf('DOC-06', 'FR-DOC-06');

  it('loads the next page of the queue when asked, so an older document can be chosen', async () => {
    const h = harness((operation, input) => {
      if (operation === 'listOutgoingDocuments') {
        const { status, cursor } = query(input);
        if (status !== 'SIGNED') return { items: [], next_cursor: null };
        return cursor === undefined ? { items: [document(DOC_A)], next_cursor: 'second' } : { items: [document(DOC_B)], next_cursor: null };
      }
      if (operation === 'getOutgoingDocument') return detail(pathId(input));
      if (operation === 'listDocumentNumberRegisters') return { items: [register()], doc_types: [type()], next_cursor: null };
      if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
      return new Error(`unexpected read ${operation}`);
    });
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, OUTGOING);
    const select = (await screen.findByLabelText(vi_['doc.outgoing.queue.label'])) as HTMLSelectElement;
    expect(within(select).queryByText(/Decision B/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.outgoing.queue.more.action'] }));
    await waitFor(() => expect(within(select).getByText(/Decision B/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: vi_['doc.outgoing.queue.more.action'] })).toBeNull();
  });

  it('reads every page of registers before it offers the choice: an open register on a later page is found', async () => {
    const h = harness((operation, input) => {
      if (operation === 'listOutgoingDocuments') return { items: query(input).status === 'SIGNED' ? [document(DOC_A)] : [], next_cursor: null };
      if (operation === 'getOutgoingDocument') return detail(pathId(input));
      if (operation === 'listDocumentNumberRegisters') {
        return query(input).cursor === undefined
          ? { items: [register({ id: 'r0', register_code: 'OLD', status: 'CLOSED' })], doc_types: [type()], next_cursor: 'second' }
          : { items: [register({ id: 'r2', register_code: 'LATER' })], doc_types: [], next_cursor: null };
      }
      if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
      return new Error(`unexpected read ${operation}`);
    });
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, OUTGOING);
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.register.label']) as HTMLSelectElement).value).toBe('r2'));
    expect(screen.queryByText(vi_['doc.outgoing.register.none'])).toBeNull();
    expect((screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reads the registers again after a number was taken, so the next number is the next one', async () => {
    let reads = 0;
    const h = harness(
      (operation, input) => {
        if (operation === 'listOutgoingDocuments') return { items: query(input).status === 'SIGNED' ? [document(DOC_A)] : [], next_cursor: null };
        if (operation === 'getOutgoingDocument') return detail(pathId(input));
        if (operation === 'listDocumentNumberRegisters') {
          reads += 1;
          return { items: [register({ next_number: 4 + reads, last_number: 3 + reads })], doc_types: [type()], next_cursor: null };
        }
        if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
        return new Error(`unexpected read ${operation}`);
      },
      () => ({ status: 'NUMBERED', resource_id: DOC_A, resource_version: 3 }),
    );
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, OUTGOING);
    expect(await screen.findByText(vi_['doc.outgoing.register.next'].replace('{number}', '05'))).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.outgoing.assign.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reads).toBeGreaterThan(1));
  });

  it('plans the symbol with the revision of the type that is in force on the issue date, not the first one listed', async () => {
    const old = type({ id: 't-old', symbol_pattern: '{number}/OLD-{agency}', effective_from: '2026-01-01', effective_until: '2026-06-01' });
    const current = type({ id: 't-new', symbol_pattern: '{number}/NEW-{agency}', effective_from: '2026-06-01', effective_until: null });
    const h = harness((operation, input) => {
      if (operation === 'listOutgoingDocuments') return { items: query(input).status === 'SIGNED' ? [document(DOC_A)] : [], next_cursor: null };
      if (operation === 'getOutgoingDocument') return detail(pathId(input));
      if (operation === 'listDocumentNumberRegisters') return { items: [register()], doc_types: [old, current], next_cursor: null };
      if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
      return new Error(`unexpected read ${operation}`);
    });
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, OUTGOING);
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.symbol.label']) as HTMLInputElement).value).toBe('05/NEW-UBND'));
    const date = screen.getByLabelText(vi_['doc.outgoing.date.label']);
    const user = userEvent.setup();
    await user.clear(date);
    await user.type(date, '2026-03-01');
    await waitFor(() => expect((screen.getByLabelText(vi_['doc.outgoing.symbol.label']) as HTMLInputElement).value).toBe('05/OLD-UBND'));
  });

  it('shows the register a numbered document took its number from, not the first open one', async () => {
    const numbered = { status: 'NUMBERED', register_id: 'r9', document_number: 5, symbol: '05/QD-OLD', issued_on: '2026-10-23', numbered_at: NOW.toISOString(), version: 3 };
    const h = harness((operation, input) => {
      if (operation === 'listOutgoingDocuments') return { items: query(input).status === 'NUMBERED' ? [document(DOC_A, numbered)] : [], next_cursor: null };
      if (operation === 'getOutgoingDocument') return detail(pathId(input), numbered);
      if (operation === 'listDocumentNumberRegisters') return { items: [register({ id: 'r1', register_code: 'OPEN-ONE' })], doc_types: [type()], next_cursor: null };
      if (operation === 'listDocumentRegisterEntries') return { register: register({ id: 'r9', register_code: 'CLOSED-NINE', status: 'CLOSED', year: 2025 }), items: [], next_cursor: null };
      if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
      return new Error(`unexpected read ${operation}`);
    });
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, OUTGOING);
    const select = (await screen.findByLabelText(vi_['doc.outgoing.register.label'])) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('r9'));
    expect(select.disabled).toBe(true);
    expect(within(select).getByText('CLOSED-NINE')).toBeTruthy();
    expect(within(select).queryByText(/OPEN-ONE/)).toBeNull();
    expect(screen.getByText(vi_['doc.outgoing.register.used'])).toBeTruthy();
  });

  it('stays on the document whose seal was completed, instead of moving to another one', async () => {
    let sealed = false;
    const numbered = { status: 'NUMBERED', document_number: 5, symbol: '05/QD-UBND', numbered_at: NOW.toISOString(), version: 3 };
    const session = { id: 's2', role: 'ORGANIZATION', status: 'AWAITING_SIGNER', adapter_code: 'MOCK', adapter_status: 'MOCK', expires_at: future(10), created_at: NOW.toISOString(), version: 1 };
    const h = harness(
      (operation, input) => {
        if (operation === 'listOutgoingDocuments') {
          const { status } = query(input);
          if (!sealed) return { items: status === 'NUMBERED' ? [document(DOC_A, numbered)] : [], next_cursor: null };
          return { items: status === 'NUMBERED' ? [document(DOC_B, numbered)] : [], next_cursor: null };
        }
        if (operation === 'getOutgoingDocument') return sealed && pathId(input) === DOC_A ? detail(DOC_A, { ...numbered, status: 'SEALED', sealed_at: NOW.toISOString() }) : detail(pathId(input), { ...numbered, sessions: [session] });
        if (operation === 'listDocumentNumberRegisters') return { items: [register()], doc_types: [type()], next_cursor: null };
        if (operation === 'get_resources_organization_unit') return { items: [], next_cursor: null };
        return new Error(`unexpected read ${operation}`);
      },
      () => {
        sealed = true;
        return { status: 'SEALED', resource_id: 's2', resource_version: 2 };
      },
    );
    mount(<OutgoingDocumentScreen route={ROUTE} />, h, OUTGOING);
    await userEvent.setup().click(await screen.findByRole('button', { name: vi_['doc.outgoing.sealComplete.action'] }));
    expect(await screen.findByText(vi_['doc.outgoing.sealed.notice'])).toBeTruthy();
    expect(document_(`[data-document-id="${DOC_A}"]`)).not.toBeNull();
  });
});

function document_(selector: string): Element | null {
  return globalThis.document.querySelector(selector);
}

describe('SigningSessionScreen (DOC-05): paging and selection', () => {
  const ROUTE = routeOf('DOC-05', 'FR-DOC-05');
  const SIGNER = ['doc.outgoing.read', 'doc.outgoing.sign'];
  const submitted = (id: string) => document(id, { status: 'SUBMITTED', leader_signed_at: null });
  const openSession = { id: 's1', role: 'LEADER', status: 'AWAITING_SIGNER', adapter_code: 'MOCK', adapter_status: 'MOCK', expires_at: future(10), created_at: NOW.toISOString(), version: 1, error_code: null };

  it('loads the next page of the queue when asked', async () => {
    const h = harness((operation, input) => {
      if (operation === 'listOutgoingDocuments') return query(input).cursor === undefined ? { items: [submitted(DOC_A)], next_cursor: 'second' } : { items: [submitted(DOC_B)], next_cursor: null };
      if (operation === 'getOutgoingDocument') return detail(pathId(input), { status: 'SUBMITTED', leader_signed_at: null });
      return new Error(`unexpected read ${operation}`);
    });
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const select = (await screen.findByLabelText(vi_['doc.signing.queue.label'])) as HTMLSelectElement;
    expect(within(select).queryByText(/Decision B/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.signing.queue.more.action'] }));
    await waitFor(() => expect(within(select).getByText(/Decision B/)).toBeTruthy());
  });

  it('stays on the document that was signed, whichever document the queue lists first afterwards', async () => {
    let signed = false;
    const h = harness(
      (operation, input) => {
        if (operation === 'listOutgoingDocuments') return { items: signed ? [submitted(DOC_B)] : [submitted(DOC_A)], next_cursor: null };
        if (operation === 'getOutgoingDocument') {
          const id = pathId(input);
          return id === DOC_A && signed
            ? detail(id, { status: 'SIGNED', leader_signed_at: new Date().toISOString(), sessions: [{ ...openSession, status: 'EMBEDDED' }] })
            : detail(id, { status: 'SUBMITTED', leader_signed_at: null, sessions: [openSession] });
        }
        return new Error(`unexpected read ${operation}`);
      },
      () => {
        signed = true;
        return { status: 'SIGNED', resource_id: 's1', resource_version: 2 };
      },
    );
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    await userEvent.setup().click(await screen.findByRole('button', { name: vi_['doc.signing.complete.action'] }));
    expect(await screen.findByText(vi_['doc.signing.signed.notice'])).toBeTruthy();
    expect(globalThis.document.querySelector(`[data-document-id="${DOC_A}"]`)).not.toBeNull();
    expect(globalThis.document.querySelector(`[data-document-id="${DOC_B}"]`)).toBeNull();
  });

  it('shows the address of a file only next to the version it was asked for, also when it arrives after another document was chosen', async () => {
    let arrive: () => void = () => undefined;
    const arrival = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const h = harness((operation, input) => {
      if (operation === 'listOutgoingDocuments') return { items: [submitted(DOC_A), submitted(DOC_B)], next_cursor: null };
      if (operation === 'getOutgoingDocument') return detail(pathId(input), { status: 'SUBMITTED', leader_signed_at: null });
      if (operation === 'getDocumentVersionDownload') return arrival.then(() => ({ url: `https://files.example/${pathId(input)}.pdf` }));
      return new Error(`unexpected read ${operation}`);
    });
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.signing.preview.open.action'] }));
    await user.selectOptions(screen.getByLabelText(vi_['doc.signing.queue.label']), DOC_B);
    await waitFor(() => expect(globalThis.document.querySelector(`[data-document-id="${DOC_B}"]`)).not.toBeNull());
    arrive();
    await waitFor(() => expect(h.read.mock.calls.some((call) => call[0] === 'getDocumentVersionDownload')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('link', { name: vi_['doc.signing.preview.link'] })).toBeNull();
    await user.selectOptions(screen.getByLabelText(vi_['doc.signing.queue.label']), DOC_A);
    await user.click(await screen.findByRole('button', { name: vi_['doc.signing.preview.open.action'] }));
    expect((await screen.findByRole('link', { name: vi_['doc.signing.preview.link'] })).getAttribute('href')).toBe('https://files.example/v-a1.pdf');
  });
});

describe('SignatureReportScreen (DOC-07): the list of versions and the notice of a verification', () => {
  const ROUTE = routeOf('DOC-07', 'FR-DOC-07');
  const VERSION_A = '00000000-0000-4000-8000-0000000000c1';
  const VERSION_B = '00000000-0000-4000-8000-0000000000c2';
  const PDF_VERSION = (id: string, n: number) => ({ id, document_id: DOC_A, version: n, stage: 'LEADER_SIGNED', mime: 'application/pdf', page_count: 1, checksum: 'abcdef0123456789'.repeat(4), scan_status: 'CLEAN', created_at: '2026-10-23T07:00:00.000Z' });
  const NOT_PDF = (n: number) => ({ ...PDF_VERSION(`00000000-0000-4000-8000-00000000f${n}00`, n), mime: 'text/plain' });
  const VERIFIER = ['doc.signature.verify', 'doc.signature.read'];

  it('keeps reading pages while the ones read hold no PDF, and lists the PDF that comes later', async () => {
    const h = harness((operation, input) => {
      if (operation !== 'get_resources_document_version') return new Error(`unexpected read ${operation}`);
      return query(input).cursor === undefined ? { items: [NOT_PDF(1), NOT_PDF(2)], next_cursor: 'second' } : { items: [PDF_VERSION(VERSION_A, 3)], next_cursor: null };
    });
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER);
    expect(await screen.findByText(vi_['doc.signatureReport.pick.version.text'].replace('{version}', '3'))).toBeTruthy();
    expect(screen.queryByText(vi_['states.empty.title'])).toBeNull();
  });

  it('keeps the button to read more when the next page could not be read, instead of showing an empty list', async () => {
    const h = harness((operation, input) => {
      if (operation !== 'get_resources_document_version') return new Error(`unexpected read ${operation}`);
      return query(input).cursor === undefined ? { items: [NOT_PDF(1)], next_cursor: 'second' } : new ApiError({ status: 500, code: 'INTERNAL_ERROR', correlationId: 'c' });
    });
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER);
    const more = await screen.findByRole('button', { name: vi_['doc.signatureReport.pick.more.action'] });
    expect(more).toBeTruthy();
    expect(screen.queryByText(vi_['states.empty.title'])).toBeNull();
  });

  it('shows the empty state when no page holds a PDF at all', async () => {
    const h = harness((operation) => (operation === 'get_resources_document_version' ? { items: [NOT_PDF(1)], next_cursor: null } : new Error(`unexpected read ${operation}`)));
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER);
    expect(await screen.findByText(vi_['states.empty.title'])).toBeTruthy();
  });

  it('shows the notice of a verification with the version it was made for, not with the next one', async () => {
    const h = harness(
      (operation, input) => {
        if (operation === 'getDocumentSignatureReport') return { version_id: pathId(input), overall: 'VALID', signatures: [] };
        if (operation === 'get_resources_document_version_id') return PDF_VERSION(pathId(input), 1);
        return new Error(`unexpected read ${operation}`);
      },
      () => ({ overall: 'VALID' }),
    );
    function WithSwitch() {
      const [, setParams] = useSearchParams();
      return (
        <>
          <button type="button" onClick={() => setParams({ version: VERSION_B })}>
            switch version
          </button>
          <SignatureReportScreen route={ROUTE} />
        </>
      );
    }
    mount(<WithSwitch />, h, VERIFIER, `/?version=${VERSION_A}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.signatureReport.verify.action'] }));
    const notice = vi_['doc.signatureReport.verified.notice'].replace('{result}', vi_['doc.signatureReport.overall.valid']);
    expect(await screen.findByText(notice)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'switch version' }));
    await waitFor(() => expect(globalThis.document.querySelector(`[data-version-id="${VERSION_B}"]`)).not.toBeNull());
    expect(screen.queryByText(notice)).toBeNull();
  });

  it('shows the problem of a verification with the version it was made for, not with the next one', async () => {
    const h = harness(
      (operation, input) => {
        if (operation === 'getDocumentSignatureReport') return { version_id: pathId(input), overall: 'VALID', signatures: [] };
        if (operation === 'get_resources_document_version_id') return PDF_VERSION(pathId(input), 1);
        return new Error(`unexpected read ${operation}`);
      },
      () => new ApiError({ status: 500, code: 'INTERNAL_ERROR', correlationId: 'c' }),
    );
    function WithSwitch() {
      const [, setParams] = useSearchParams();
      return (
        <>
          <button type="button" onClick={() => setParams({ version: VERSION_B })}>
            switch version
          </button>
          <SignatureReportScreen route={ROUTE} />
        </>
      );
    }
    mount(<WithSwitch />, h, VERIFIER, `/?version=${VERSION_A}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.signatureReport.verify.action'] }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'switch version' }));
    await waitFor(() => expect(globalThis.document.querySelector(`[data-version-id="${VERSION_B}"]`)).not.toBeNull());
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });
});

describe('docTypeInForce', () => {
  const revision = (from: string, until: string | null, status = 'PUBLISHED', code = 'QD'): DocType => ({
    id: `${code}-${from}`,
    code,
    name: code,
    abbreviation: code,
    symbolKind: 'DECISION',
    symbolPattern: '{number}',
    registerCode: 'REG',
    effectiveFrom: from,
    effectiveUntil: until,
    status,
    version: 1,
  });

  it('takes the published revision whose period holds the date, the end of the period being exclusive', () => {
    const list = [revision('2026-01-01', '2026-06-01'), revision('2026-06-01', null)];
    expect(docTypeInForce(list, 'QD', '2026-05-31')?.effectiveFrom).toBe('2026-01-01');
    expect(docTypeInForce(list, 'QD', '2026-06-01')?.effectiveFrom).toBe('2026-06-01');
    expect(docTypeInForce(list, 'QD', '2025-12-31')).toBeUndefined();
  });

  it('prefers the revision that started last when two periods overlap, and ignores other codes and unpublished ones', () => {
    const list = [revision('2026-01-01', null), revision('2026-03-01', null), revision('2026-05-01', null, 'DRAFT'), revision('2026-02-01', null, 'PUBLISHED', 'CV')];
    expect(docTypeInForce(list, 'QD', '2026-10-01')?.effectiveFrom).toBe('2026-03-01');
  });
});
