import { ApiError } from '@machvon/api-client';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import vi_ from '../../i18n/vi.json';
import DocumentTypesScreen from './DocumentTypesScreen';
import { CLERK, READER, harness, mount, routeOf } from './test-support';

const ROUTE = routeOf('DOC-21', 'FR-DOC-21');
const UNIT = '00000000-0000-4000-8000-000000000f01';
const TYPES = [
  { id: 't1', code: 'QD', name: 'Decision', abbreviation: 'QD', symbol_kind: 'DECISION', symbol_pattern: '{number}/{type}-{agency}', register_code: 'REG-QD', effective_from: '2026-01-01', effective_until: null, status: 'PUBLISHED', version: 1 },
  { id: 't2', code: 'CV', name: 'Official letter', abbreviation: null, symbol_kind: 'OFFICIAL_LETTER', symbol_pattern: '{number}/{agency}', register_code: 'REG-CV', effective_from: '2026-01-01', effective_until: '2027-01-01', status: 'PUBLISHED', version: 2 },
];

function answer(operation: string): unknown {
  if (operation === 'listDocumentNumberRegisters') return { items: [], next_cursor: null, doc_types: TYPES };
  return new Error('unexpected read');
}

const withUnits = (h: ReturnType<typeof harness>) => {
  (h.client as unknown as { readAll: (operation: string) => Promise<unknown[]> }).readAll = () => Promise.resolve([{ id: UNIT, code: 'U1', name: 'Board' }, { id: 7 }]);
  return h;
};

afterEach(cleanup);

const ready = () => waitFor(() => expect(document.querySelector('[data-type-code="QD"]')).not.toBeNull());

async function fillType(user: ReturnType<typeof userEvent.setup>, overrides: Record<string, string> = {}): Promise<void> {
  const values: Record<string, string> = { code: 'QD2', name: 'Another decision', symbolPattern: '{number}/{type}', registerCode: 'REG-QD2', legalBasis: 'ND 30/2020', effectiveFrom: '2026-02-01', ...overrides };
  await user.type(screen.getByLabelText(vi_['doc.types.code.label']), values.code ?? '');
  await user.type(screen.getByLabelText(vi_['doc.types.name.label']), values.name ?? '');
  // user.type reads braces as key names; the pattern is pasted.
  await user.click(screen.getByLabelText(vi_['doc.types.symbolPattern.label']));
  await user.paste(values.symbolPattern ?? '');
  await user.type(screen.getByLabelText(vi_['doc.types.registerCode.label'], { selector: '#type-registerCode' }), values.registerCode ?? '');
  await user.type(screen.getByLabelText(vi_['doc.types.legalBasis.label']), values.legalBasis ?? '');
  await user.type(screen.getByLabelText(vi_['doc.types.effectiveFrom.label']), values.effectiveFrom ?? '');
}

describe('DocumentTypesScreen (DOC-21)', () => {
  it('shows the defined types next to the forms', async () => {
    mount(<DocumentTypesScreen route={ROUTE} />, withUnits(harness(answer)));
    await ready();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(vi_['doc.types.page.title']);
    expect(document.querySelector('[data-type-code="CV"]')?.textContent).toContain('Official letter');
    expect(screen.getByText(vi_['doc.types.list.period'].replace('{from}', '2026-01-01').replace('{until}', '2027-01-01'))).toBeTruthy();
    expect(screen.getByLabelText('QD')).toBeTruthy();
  });

  it('defines a type once and empties the form', async () => {
    const h = withUnits(harness(answer, () => ({ status: 'DEFINED', resource_version: 1, resource_id: 't9' })));
    mount(<DocumentTypesScreen route={ROUTE} />, h);
    await ready();
    const user = userEvent.setup();
    await fillType(user);
    await user.click(screen.getByRole('button', { name: vi_['doc.types.type.submit.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('defineDocumentType');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({
      body: { code: 'QD2', name: 'Another decision', symbol_kind: 'DECISION', symbol_pattern: '{number}/{type}', register_code: 'REG-QD2', legal_basis: 'ND 30/2020', effective_from: '2026-02-01' },
    });
    expect(await screen.findByText(vi_['doc.types.type.accepted.notice'])).toBeTruthy();
    expect((screen.getByLabelText(vi_['doc.types.code.label']) as HTMLInputElement).value).toBe('');
  });

  it('refuses an empty form and a bad pattern before anything is sent', async () => {
    const h = withUnits(harness(answer));
    mount(<DocumentTypesScreen route={ROUTE} />, h);
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: vi_['doc.types.type.submit.action'] }));
    expect((await screen.findAllByText(vi_['doc.form.problem.required'])).length).toBeGreaterThanOrEqual(5);
    await fillType(user, { symbolPattern: '{number}a/{type}' });
    await user.click(screen.getByRole('button', { name: vi_['doc.types.type.submit.action'] }));
    expect(await screen.findByText(vi_['doc.form.problem.pattern'])).toBeTruthy();
    expect(h.command).not.toHaveBeenCalled();
  });

  it('shows what the server refused for a type', async () => {
    const h = withUnits(harness(answer, () => new ApiError({ status: 409, code: 'DOC_TYPE_RANGE_OVERLAP', correlationId: 'c' })));
    mount(<DocumentTypesScreen route={ROUTE} />, h);
    await ready();
    const user = userEvent.setup();
    await fillType(user);
    await user.click(screen.getByRole('button', { name: vi_['doc.types.type.submit.action'] }));
    expect(await screen.findByText(vi_['doc.problem.rangeOverlap.text'])).toBeTruthy();
  });

  it('opens a register for a unit with the document types that use it', async () => {
    const h = withUnits(harness(answer, () => ({ status: 'OPEN', resource_version: 1, resource_id: 'r9' })));
    mount(<DocumentTypesScreen route={ROUTE} />, h);
    await ready();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(vi_['doc.types.registerCode.label'], { selector: '#register-registerCode' }), 'REG-NEW');
    await user.type(screen.getByLabelText(vi_['doc.types.registerName.label']), 'New register');
    await screen.findByRole('option', { name: /U1/ });
    await user.selectOptions(screen.getByLabelText(vi_['doc.types.unit.label']), UNIT);
    await user.type(screen.getByLabelText(vi_['doc.types.year.label']), '2027');
    await user.selectOptions(screen.getByLabelText(vi_['doc.types.mode.label']), 'MIRRORED');
    await user.selectOptions(screen.getByLabelText(vi_['doc.types.direction.label']), 'INCOMING');
    await user.click(screen.getByLabelText('QD'));
    await user.click(screen.getByLabelText('CV'));
    await user.click(screen.getByLabelText('CV'));
    await user.click(screen.getByRole('button', { name: vi_['doc.types.register.submit.action'] }));
    await waitFor(() => expect(h.command).toHaveBeenCalledTimes(1));
    expect(h.command.mock.calls[0]?.[0]).toBe('openDocumentNumberRegister');
    expect(h.command.mock.calls[0]?.[1]).toMatchObject({
      body: { register_code: 'REG-NEW', name: 'New register', direction: 'INCOMING', organization_unit_id: UNIT, year: 2027, mode: 'MIRRORED', scope_doc_types: ['QD'] },
    });
    expect(await screen.findByText(vi_['doc.types.register.accepted.notice'])).toBeTruthy();
  });

  it('refuses an incomplete register form and shows the refusal of the server', async () => {
    const h = withUnits(harness(answer, () => new ApiError({ status: 409, code: 'REGISTER_ALREADY_EXISTS', correlationId: 'c' })));
    mount(<DocumentTypesScreen route={ROUTE} />, h);
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: vi_['doc.types.register.submit.action'] }));
    expect((await screen.findAllByText(vi_['doc.form.problem.required'])).length).toBeGreaterThanOrEqual(3);
    expect(h.command).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(vi_['doc.types.registerCode.label'], { selector: '#register-registerCode' }), 'REG-NEW');
    await user.type(screen.getByLabelText(vi_['doc.types.registerName.label']), 'New register');
    await screen.findByRole('option', { name: /U1/ });
    await user.selectOptions(screen.getByLabelText(vi_['doc.types.unit.label']), UNIT);
    await user.type(screen.getByLabelText(vi_['doc.types.year.label']), '2027');
    await user.click(screen.getByRole('button', { name: vi_['doc.types.register.submit.action'] }));
    expect(await screen.findByText(vi_['doc.problem.registerExists.text'])).toBeTruthy();
  });

  it('is read-only without the permissions', async () => {
    mount(<DocumentTypesScreen route={ROUTE} />, withUnits(harness(answer)), READER);
    await ready();
    expect(screen.getByText(vi_['doc.types.readOnly.notice'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.types.registerReadOnly.notice'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['doc.types.type.submit.action'] })).toBeNull();
    expect(screen.queryByRole('button', { name: vi_['doc.types.register.submit.action'] })).toBeNull();
  });

  it('keeps the forms when no type or register exists yet, and tells the register has no types to choose', async () => {
    mount(<DocumentTypesScreen route={ROUTE} />, withUnits(harness(() => ({ items: [], next_cursor: null, doc_types: [] }))), CLERK);
    expect(await screen.findByText(vi_['doc.types.list.empty'])).toBeTruthy();
    expect(screen.getByText(vi_['doc.types.scope.empty'])).toBeTruthy();
  });

  it('shows the denied state when the registers cannot be read', async () => {
    mount(<DocumentTypesScreen route={ROUTE} />, withUnits(harness(() => new ApiError({ status: 403, code: 'SCOPE_DENIED', correlationId: 'c' }))));
    expect(await screen.findByText(vi_['states.denied.title'])).toBeTruthy();
  });
});
