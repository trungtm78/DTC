import { describe, expect, it } from 'vitest';
import { businessToday } from './business-date';
import { AttemptRegistry } from './hooks';
import { changedFields, initialValues } from './UnitForm';
import type { OrgUnit } from './types';

const UNIT: OrgUnit = {
  id: 'u',
  code: 'U1',
  name: 'Unit one',
  parent_id: 'p',
  valid_from: '2025-01-01',
  valid_until: null,
  unit_type: 'COMMUNE',
  administrative_code: '123',
  is_investor: false,
  legal_basis_ref: 'QD 1',
  status: 'Active',
  successor_id: null,
  depth: 1,
  version: 4,
};

describe('businessToday', () => {
  it('uses the Vietnam calendar date, not the date of the browser zone', () => {
    // 18:30 UTC on 1 March is 01:30 on 2 March in Vietnam.
    expect(businessToday(new Date('2026-03-01T18:30:00Z'))).toBe('2026-03-02');
    expect(businessToday(new Date('2026-03-01T16:59:00Z'))).toBe('2026-03-01');
  });
});

describe('AttemptRegistry', () => {
  const counting = () => {
    let n = 0;
    return { start: () => ({ key: `key-${(n += 1)}` }) };
  };

  it('reuses the attempt for the same payload and starts a new one for another payload', () => {
    const registry = new AttemptRegistry(counting().start);
    const first = registry.forPayload({ a: 1 });
    expect(registry.forPayload({ a: 1 })).toBe(first);
    expect(registry.forPayload({ a: 2 })).not.toBe(first);
  });

  it('ends the intention on success, so the same payload afterwards is a new intention', () => {
    const registry = new AttemptRegistry(counting().start);
    const first = registry.forPayload({ a: 1 });
    registry.done();
    expect(registry.forPayload({ a: 1 })).not.toBe(first);
  });

  it('draws real keys by default', () => {
    expect(new AttemptRegistry().forPayload({}).key.length).toBeGreaterThanOrEqual(16);
  });
});

describe('form values', () => {
  it('starts a new unit empty under the chosen parent with today as the effective date', () => {
    expect(initialValues(undefined, 'parent', '2026-05-05')).toMatchObject({ code: '', name: '', parent_id: 'parent', valid_from: '2026-05-05', unit_type: 'DEPARTMENT', is_investor: false });
    expect(initialValues(undefined, undefined, '2026-05-05').parent_id).toBe('');
  });

  it('starts an existing unit from its own values and maps an unknown type to OTHER', () => {
    expect(initialValues(UNIT, undefined)).toMatchObject({ code: 'U1', parent_id: 'p', unit_type: 'COMMUNE', administrative_code: '123', legal_basis_ref: 'QD 1' });
    expect(initialValues({ ...UNIT, unit_type: 'MYSTERY', parent_id: null, administrative_code: null, legal_basis_ref: null }, undefined)).toMatchObject({ unit_type: 'OTHER', parent_id: '', administrative_code: '', legal_basis_ref: '' });
  });

  it('reports only changed fields, and treats an emptied optional text as unchanged', () => {
    const values = initialValues(UNIT, undefined);
    expect(changedFields(UNIT, values)).toEqual({});
    expect(changedFields(UNIT, { ...values, name: 'New name', is_investor: true, administrative_code: '999', legal_basis_ref: 'QD 2', code: 'U2' })).toEqual({
      name: 'New name',
      is_investor: true,
      administrative_code: '999',
      legal_basis_ref: 'QD 2',
      code: 'U2',
    });
    expect(changedFields(UNIT, { ...values, administrative_code: '', legal_basis_ref: '' })).toEqual({});
  });
});
