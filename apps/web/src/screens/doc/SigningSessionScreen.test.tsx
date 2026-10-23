import { ApiError } from '@machvon/api-client';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import SigningSessionScreen from './SigningSessionScreen';
import { TENANT, harness, mount, routeOf } from './test-support';

const ROUTE = routeOf('DOC-05', 'FR-DOC-05');
const DOC = '00000000-0000-4000-8000-0000000000d1';
const SIGNER = ['doc.outgoing.read', 'doc.outgoing.sign'];
const future = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

const row = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  document_id: '00000000-0000-4000-8000-0000000000d2',
  title: 'Decision to assign capital',
  doc_type_code: 'QD',
  status: 'SUBMITTED',
  signer_user_id: TENANT.membershipId,
  signer_title: 'Chairman',
  current_version_id: 'v1',
  leader_signed_at: null,
  created_at: '2026-10-23T02:00:00Z',
  version: 1,
  ...overrides,
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...row(),
  sessions: [],
  versions: [{ id: 'v1', version: 1, stage: 'RENDERED_FINAL', checksum: 'ab'.repeat(32), page_count: 2, scan_status: 'CLEAN', created_at: '2026-10-23T02:00:00Z' }],
  certificates: [{ id: 'c1', kind: 'PERSONAL', subject_dn: 'CN=Nguyen Van A', issuer_dn: 'CN=CA', valid_until: '2027-01-01T00:00:00Z', status: 'Active' }],
  signatures: [],
  ...overrides,
});

const openSession = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  role: 'LEADER',
  status: 'AWAITING_SIGNER',
  adapter_code: 'MOCK',
  adapter_status: 'MOCK',
  expires_at: future(10),
  created_at: new Date().toISOString(),
  version: 1,
  error_code: null,
  ...overrides,
});

function answer(current: () => Record<string, unknown>, queue: unknown[] = [row()]) {
  return (operation: string): unknown => {
    if (operation === 'listOutgoingDocuments') return { items: queue, next_cursor: null };
    if (operation === 'getOutgoingDocument') return current();
    if (operation === 'getDocumentVersionDownload') return { url: 'https://files.example/v1.pdf' };
    return new Error(`unexpected read ${operation}`);
  };
}

afterEach(cleanup);

describe('SigningSessionScreen (DOC-05)', () => {
  it('shows the six checks of the chosen document and the preview facts', async () => {
    const h = harness(answer(() => detail()));
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    expect(await screen.findByText(vi_['doc.signing.check.viewer.title'])).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(vi_['doc.signing.page.title']);
    for (const id of ['viewer', 'box', 'certificate', 'session', 'adapter', 'reject']) expect(document.querySelector(`[data-check="${id}"]`)).not.toBeNull();
    expect(document.querySelector('[data-check="certificate"]')?.getAttribute('data-state')).toBe('pass');
    expect(screen.getByText(vi_['doc.signing.queue.mine.badge'])).toBeTruthy();
    expect(screen.getByText(/mã băm abababababab/)).toBeTruthy();
  });

  it('opens a signing session with the chosen certificate, adapter and DocMDP, with the version it saw', async () => {
    const h = harness(answer(() => detail()), () => ({ status: 'AWAITING_SIGNER', resource_id: 's1', resource_version: 1 }));
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(vi_['doc.signing.adapter.label']), 'REMOTE_CA');
    await user.click(screen.getByLabelText(vi_['doc.signing.docmdp.label']));
    await user.click(screen.getByRole('button', { name: vi_['doc.signing.start.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('startLeaderSigning');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { id: DOC }, ifMatchVersion: 1, body: { certificate_id: 'c1', adapter_code: 'REMOTE_CA', certify_docmdp: true } });
  });

  it('completes an open session and offers the verification and the numbering afterwards', async () => {
    let state = detail({ sessions: [openSession()] });
    const h = harness(answer(() => state), () => {
      state = detail({ status: 'SIGNED', leader_signed_at: new Date().toISOString(), sessions: [openSession({ status: 'EMBEDDED' })] });
      return { status: 'SIGNED', resource_id: 's1', resource_version: 2 };
    });
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(vi_['doc.signing.otp.label']), ' 123456 ');
    await user.click(screen.getByRole('button', { name: vi_['doc.signing.complete.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('completeSigningSession');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({ path: { id: 's1' }, ifMatchVersion: 1, body: { otp_confirmation: '123456' } });
    expect(await screen.findByText(vi_['doc.signing.signed.notice'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.signing.signed.verify.link']).getAttribute('href')).toBe('/doc/doc-07?version=v1');
    expect(screen.getByText(vi_['doc.signing.signed.number.link']).getAttribute('href')).toBe(`/doc/doc-06?doc=${DOC}`);
  });

  it('tells the person when the signer has not confirmed yet and when the provider is down', async () => {
    const failures = [new ApiError({ status: 409, code: 'SIGNING_SESSION_OPEN', correlationId: 'c' }), new ApiError({ status: 503, code: 'PROVIDER_UNAVAILABLE', correlationId: 'c' })];
    const h = harness(answer(() => detail({ sessions: [openSession()] })), () => failures.shift() ?? {});
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.signing.complete.action'] }));
    expect((await screen.findByRole('alert')).textContent).toBe(vi_['doc.outgoing.problem.pending']);
    await user.click(screen.getByRole('button', { name: vi_['doc.signing.complete.action'] }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(vi_['doc.outgoing.problem.provider']));
  });

  it('does not offer the start to someone who is not the signer, nor the actions without the permission', async () => {
    const h = harness(answer(() => detail({ signer_user_id: '00000000-0000-4000-8000-0000000000ff' })));
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const start = await screen.findByRole('button', { name: vi_['doc.signing.start.action'] });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(vi_['doc.signing.start.notSigner'])).toBeTruthy();
    cleanup();
    mount(<SigningSessionScreen route={ROUTE} />, harness(answer(() => detail())), ['doc.outgoing.read']);
    expect(await screen.findByText(vi_['doc.signing.denied.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['doc.signing.start.action'] })).toBeNull();
  });

  it('explains why a session cannot be opened and shows the empty queue', async () => {
    mount(<SigningSessionScreen route={ROUTE} />, harness(answer(() => detail({ certificates: [] }))), SIGNER);
    expect(await screen.findByText(vi_['doc.signing.start.blocked'])).toBeTruthy();
    cleanup();
    mount(<SigningSessionScreen route={ROUTE} />, harness(answer(() => detail(), [])), SIGNER);
    expect(await screen.findByText(vi_['states.empty.title'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.signing.preview.empty'])).toBeTruthy();
  });

  it('asks the API for the address of the file and links to it', async () => {
    const h = harness(answer(() => detail()));
    mount(<SigningSessionScreen route={ROUTE} />, h, SIGNER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: vi_['doc.signing.preview.open.action'] }));
    expect((await screen.findByText(vi_['doc.signing.preview.link'])).getAttribute('href')).toBe('https://files.example/v1.pdf');
  });

  it('shows the denied state when the list is refused', async () => {
    mount(<SigningSessionScreen route={ROUTE} />, harness(() => new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' })), SIGNER);
    expect(await screen.findByText(vi_['states.denied.title'])).toBeTruthy();
  });
});
