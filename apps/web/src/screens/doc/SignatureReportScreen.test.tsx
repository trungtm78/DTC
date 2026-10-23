import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import SignatureReportScreen from './SignatureReportScreen';
import { harness, mount, routeOf } from './test-support';

const ROUTE = routeOf('DOC-07', 'FR-DOC-07');
const VERSION = '00000000-0000-4000-8000-0000000000a1';
const OPEN = `/doc/doc-07?version=${VERSION}`;
const VERIFIER = ['doc.signature.verify', 'doc.signature.read'];
const READER = ['doc.signature.read'];

const signature = (index: number, overrides: Record<string, unknown> = {}) => ({
  index,
  role: index === 0 ? 'LEADER' : 'ORGANIZATION',
  verification_no: 1,
  subject_dn: index === 0 ? 'CN=Nguyen Van A' : 'CN=Cao Bang Seal',
  issuer_dn: 'CN=Test CA',
  serial: '0A',
  fingerprint_sha256: 'a'.repeat(64),
  registered_certificate_id: null,
  trust_regime: 'PUBLIC_CA',
  profile: 'PADES_B_T',
  docmdp_level: null,
  byte_range: [0, 1, 2, 3],
  covers_end_offset: 100,
  signed_at: '2026-10-23T08:00:00.000Z',
  timestamp_at: '2026-10-23T08:00:01.000Z',
  status: 'VALID',
  chain_status: 'TRUSTED',
  revocation_status: 'GOOD',
  incremental_changes_allowed: true,
  findings: [],
  verified_at: '2026-10-23T09:00:00.000Z',
  ...overrides,
});

const version = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: n === 1 ? VERSION : `00000000-0000-4000-8000-0000000000b${n}`,
  document_id: '00000000-0000-4000-8000-0000000000d1',
  version: n,
  stage: 'LEADER_SIGNED',
  mime: 'application/pdf',
  page_count: 2,
  checksum: 'abcdef0123456789'.repeat(4),
  scan_status: 'CLEAN',
  created_at: '2026-10-23T07:00:00.000Z',
  ...overrides,
});

interface Fixture {
  report?: unknown;
  versionRead?: unknown;
  versions?: (cursor: string | undefined) => unknown;
}

function answer(fixture: Fixture) {
  return (operation: string, input: unknown): unknown => {
    if (operation === 'getDocumentSignatureReport') return fixture.report ?? { version_id: VERSION, overall: 'VALID', signatures: [signature(0), signature(1)] };
    if (operation === 'get_resources_document_version_id') return fixture.versionRead ?? version(1);
    if (operation === 'get_resources_document_version') return (fixture.versions ?? (() => ({ items: [version(1), version(2, { mime: 'text/plain' })], next_cursor: null })))((input as { query?: { cursor?: string } }).query?.cursor);
    return new Error('unexpected read');
  };
}

afterEach(cleanup);

describe('SignatureReportScreen (DOC-07)', () => {
  it('shows the six checks, the signatures with their reasons and the facts of the related file', async () => {
    const report = {
      version_id: VERSION,
      overall: 'INVALID',
      signatures: [signature(0), signature(1, { status: 'INVALID', chain_status: 'UNTRUSTED', revocation_status: 'NOT_CHECKED', incremental_changes_allowed: false, findings: ['CHAIN_UNTRUSTED', 'INCREMENTAL_CHANGES_NOT_ALLOWED', 'SOMETHING_NEW'], timestamp_at: null, trust_regime: null, profile: null })],
    };
    const h = harness(answer({ report }));
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER, OPEN);
    expect(await screen.findByText('CN=Nguyen Van A')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(vi_['doc.signatureReport.page.title']);
    expect(h.read).toHaveBeenCalledWith('getDocumentSignatureReport', { path: { id: VERSION } });
    const states = Object.fromEntries([...document.querySelectorAll('[data-check]')].map((row) => [row.getAttribute('data-check'), row.getAttribute('data-state')]));
    expect(states).toEqual({ order: 'pass', chain: 'fail', revocation: 'none', incremental: 'fail', timestamp: 'none', conclusion: 'fail' });
    const row = document.querySelector('[data-signature-index="1"]') as HTMLElement;
    expect(within(row).getByText('CHAIN_UNTRUSTED')).toBeTruthy();
    expect(row.textContent).toContain(vi_['doc.signatureReport.finding.chainUntrusted']);
    expect(row.textContent).toContain(vi_['doc.signatureReport.finding.incrementalChanges']);
    expect(within(row).getAllByText('SOMETHING_NEW')).toHaveLength(2);
    expect(row.textContent).toContain(vi_['doc.signatureReport.time.declared']);
    expect(row.textContent).toContain(vi_['doc.signatureReport.chain.untrusted']);
    expect(await screen.findByText(vi_['doc.signatureReport.related.title'])).toBeTruthy();
    expect(await screen.findByText('abcdef012345')).toBeTruthy();
    expect(screen.getByText(vi_['doc.signatureReport.note.text'])).toBeTruthy();
  });

  it('shows a valid verification with every check passed and the proven time of each signature', async () => {
    mount(<SignatureReportScreen route={ROUTE} />, harness(answer({})), VERIFIER, OPEN);
    await screen.findByText('CN=Nguyen Van A');
    expect([...document.querySelectorAll('[data-check]')].map((row) => row.getAttribute('data-state'))).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(screen.getAllByText(vi_['doc.signatureReport.overall.valid']).length).toBe(2);
  });

  it('has no signatures to show: the empty state, with the verify action still there', async () => {
    mount(<SignatureReportScreen route={ROUTE} />, harness(answer({ report: { version_id: VERSION, overall: 'INDETERMINATE', signatures: [] } })), VERIFIER, OPEN);
    expect(await screen.findByText(vi_['states.empty.title'])).toBeTruthy();
    expect(screen.getByRole('button', { name: vi_['doc.signatureReport.verify.action'] })).toBeTruthy();
  });

  it('verifies again with the policy and the revocation choice, reads the report again and says the result', async () => {
    const h = harness(answer({}), () => ({ operation_id: 'o', status: 'INDETERMINATE', resource_version: 1, resource_id: VERSION, overall: 'INDETERMINATE' }));
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER, OPEN);
    await screen.findByText('CN=Nguyen Van A');
    const reads = () => h.read.mock.calls.filter(([operation]) => operation === 'getDocumentSignatureReport').length;
    const before = reads();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(vi_['doc.signatureReport.policy.label']), 'LENIENT_TIME');
    await user.click(screen.getByLabelText(vi_['doc.signatureReport.revalidate.label']));
    await user.click(screen.getByRole('button', { name: vi_['doc.signatureReport.verify.action'] }));
    expect(await screen.findByText(vi_['doc.signatureReport.verified.notice'].replace('{result}', vi_['doc.signatureReport.overall.indeterminate']))).toBeTruthy();
    expect(h.command.mock.calls[0]?.[0]).toBe('verifyDocumentSignatures');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { id: VERSION }, body: { policy: 'LENIENT_TIME', revalidate_revocation: true } });
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('says VALID or INVALID for the other results of a verification', async () => {
    for (const overall of ['VALID', 'INVALID']) {
      const h = harness(answer({}), () => ({ overall }));
      const view = mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER, OPEN);
      await screen.findByText('CN=Nguyen Van A');
      await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.signatureReport.verify.action'] }));
      const key = overall === 'VALID' ? 'doc.signatureReport.overall.valid' : 'doc.signatureReport.overall.invalid';
      expect(await screen.findByText(vi_['doc.signatureReport.verified.notice'].replace('{result}', vi_[key]))).toBeTruthy();
      view.unmount();
    }
  });

  it('reads an answer without a result as undecided', async () => {
    const h = harness(answer({}), () => null);
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER, OPEN);
    await screen.findByText('CN=Nguyen Van A');
    await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.signatureReport.verify.action'] }));
    expect(await screen.findByText(vi_['doc.signatureReport.verified.notice'].replace('{result}', vi_['doc.signatureReport.overall.indeterminate']))).toBeTruthy();
  });

  it.each([
    ['DOCUMENT_VERSION_NOT_PDF', 422, 'doc.signatureReport.problem.notPdf.text'],
    ['SCAN_PENDING', 409, 'doc.signatureReport.problem.scanPending.text'],
    ['SCOPE_DENIED', 403, 'doc.signatureReport.problem.denied.text'],
    ['RESOURCE_NOT_FOUND', 404, 'doc.signatureReport.problem.notFound.text'],
    ['VALIDATION_FAILED', 422, 'doc.signatureReport.problem.invalid.text'],
    ['SESSION_EXPIRED', 401, 'doc.signatureReport.problem.session.text'],
    ['INTERNAL_ERROR', 500, 'doc.signatureReport.problem.general.text'],
  ] as const)('shows why a verification was refused: %s', async (code, status, key) => {
    const h = harness(answer({}), () => new ApiError({ status, code, correlationId: 'c' }));
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER, OPEN);
    await screen.findByText('CN=Nguyen Van A');
    await userEvent.setup().click(screen.getByRole('button', { name: vi_['doc.signatureReport.verify.action'] }));
    expect((await screen.findByRole('alert')).textContent).toBe(vi_[key]);
  });

  it('offers no verification to a reader', async () => {
    mount(<SignatureReportScreen route={ROUTE} />, harness(answer({})), READER, OPEN);
    await screen.findByText('CN=Nguyen Van A');
    expect(screen.queryByRole('button', { name: vi_['doc.signatureReport.verify.action'] })).toBeNull();
  });

  it('says so when the facts of the version cannot be read, and shows unread signer and authority names as unknown', async () => {
    const report = { version_id: VERSION, overall: 'INVALID', signatures: [signature(0, { subject_dn: null, issuer_dn: null, signed_at: null, timestamp_at: null, status: 'INVALID', findings: ['SIGNATURE_MALFORMED'] })] };
    const h = harness((operation, input) => (operation === 'get_resources_document_version_id' ? new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }) : answer({ report })(operation, input)));
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER, OPEN);
    expect(await screen.findByText(vi_['doc.signatureReport.signer.unknown'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.signatureReport.authority.unknown'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.signatureReport.time.unknown'])).toBeTruthy();
    expect(await screen.findByText(vi_['doc.signatureReport.related.unavailable'])).toBeTruthy();
  });

  it('lists the PDF versions when no version is chosen, opens one and loads more on request', async () => {
    const h = harness(
      answer({
        versions: (cursor) => (cursor === undefined ? { items: [version(1), version(2, { mime: 'text/plain' })], next_cursor: 'p2' } : { items: [version(3)], next_cursor: null }),
      }),
    );
    mount(<SignatureReportScreen route={ROUTE} />, h, VERIFIER);
    expect(await screen.findByText(vi_['doc.signatureReport.pick.title'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.signatureReport.pick.version.text'].replace('{version}', '1'))).toBeTruthy();
    expect(screen.queryByText(vi_['doc.signatureReport.pick.version.text'].replace('{version}', '2'))).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: vi_['doc.signatureReport.pick.more.action'] }));
    expect(await screen.findByText(vi_['doc.signatureReport.pick.version.text'].replace('{version}', '3'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: vi_['doc.signatureReport.pick.open.label'].replace('{version}', '1') }));
    expect(await screen.findByText('CN=Nguyen Van A')).toBeTruthy();
    expect(h.read).toHaveBeenCalledWith('getDocumentSignatureReport', { path: { id: VERSION } });
  });

  it.each([
    ['empty', { items: [], next_cursor: null }, vi_['states.empty.title']],
    ['denied', new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }), vi_['states.denied.title']],
    ['offline', new ApiError({ status: 0, code: NETWORK_ERROR_CODE, correlationId: 'c' }), vi_['states.offline.title']],
    ['error', new ApiError({ status: 500, code: 'INTERNAL_ERROR', correlationId: 'c' }), vi_['states.error.title']],
    ['signed out', new ApiError({ status: 401, code: 'SESSION_EXPIRED', correlationId: 'c' }), vi_['states.signedOut.title']],
  ])('shows the %s state of the version list', async (_name, reply, title) => {
    mount(<SignatureReportScreen route={ROUTE} />, harness((operation) => (operation === 'get_resources_document_version' ? reply : new Error('unexpected read'))), VERIFIER);
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it.each([
    ['denied', new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }), vi_['states.denied.title']],
    ['error', new ApiError({ status: 500, code: 'INTERNAL_ERROR', correlationId: 'c' }), vi_['states.error.title']],
  ])('shows the %s state of the report', async (_name, reply, title) => {
    mount(<SignatureReportScreen route={ROUTE} />, harness((operation, input) => (operation === 'getDocumentSignatureReport' ? reply : answer({})(operation, input))), VERIFIER, OPEN);
    expect(await screen.findByText(title)).toBeTruthy();
  });

  it('shows the loading state first', () => {
    mount(<SignatureReportScreen route={ROUTE} />, harness(() => new Promise(() => undefined)), VERIFIER, OPEN);
    expect(screen.getAllByRole('status', { name: vi_['states.loading.label'] }).length).toBeGreaterThan(0);
  });

  it('links back to the leader signing screen', async () => {
    mount(<SignatureReportScreen route={ROUTE} />, harness(answer({})), VERIFIER, OPEN);
    await screen.findByText('CN=Nguyen Van A');
    expect(screen.getByRole('link', { name: new RegExp(vi_['doc.signatureReport.back.link']) }).getAttribute('href')).toBe('/doc/doc-05');
  });
});
