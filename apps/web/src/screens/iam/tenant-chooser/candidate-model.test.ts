import { describe, expect, it } from 'vitest';
import type { TenantCandidate } from '../../../session/SessionContext';
import { safeNext, selectability } from './candidate-model';

const NOW = Date.parse('2026-10-23T00:00:00Z');
const BASE: TenantCandidate = {
  tenant_id: 't',
  tenant_name: 'Cao Bằng',
  tenant_status: 'Active',
  membership_id: 'm',
  membership_type: 'STAFF',
  status: 'Active',
  valid_from: '2026-01-01T00:00:00.000Z',
  valid_until: null,
};

describe('selectability', () => {
  it('lets an Active membership of an Active tenant be chosen', () => {
    expect(selectability(BASE, NOW)).toBe('selectable');
  });

  it('offers a suspended tenant in read-only mode', () => {
    expect(selectability({ ...BASE, tenant_status: 'Suspended' }, NOW)).toBe('readOnly');
  });

  it.each(['Requested', 'Provisioning', 'Failed', 'Offboarding', 'Archived'] as const)('cannot choose a tenant that is %s', (tenant_status) => {
    expect(selectability({ ...BASE, tenant_status }, NOW)).toBe('unavailable');
  });

  it.each([['Ended'], ['Suspended'], ['Invited']])('cannot choose a membership that is %s', (status) => {
    expect(selectability({ ...BASE, status }, NOW)).toBe('inactive');
  });

  it('cannot choose a membership outside its validity window (the end is exclusive)', () => {
    expect(selectability({ ...BASE, valid_until: '2026-10-22T23:59:59.999Z' }, NOW)).toBe('inactive');
    expect(selectability({ ...BASE, valid_until: '2026-10-23T00:00:00.000Z' }, NOW)).toBe('inactive');
    expect(selectability({ ...BASE, valid_until: '2026-10-23T00:00:00.001Z' }, NOW)).toBe('selectable');
    expect(selectability({ ...BASE, valid_from: '2026-10-23T00:00:00.001Z' }, NOW)).toBe('inactive');
    expect(selectability({ ...BASE, valid_from: '2026-10-23T00:00:00.000Z' }, NOW)).toBe('selectable');
  });

  it('puts an inactive membership before the state of its tenant', () => {
    expect(selectability({ ...BASE, status: 'Ended', tenant_status: 'Provisioning' }, NOW)).toBe('inactive');
  });
});

describe('safeNext', () => {
  it.each([
    ['/adm/adm-01', '/adm/adm-01'],
    ['/adm/adm-01?x=1#y', '/adm/adm-01?x=1#y'],
    ['/', '/'],
  ])('keeps the local address %s', (value, expected) => {
    expect(safeNext(value, '/home/home-01')).toBe(expected);
  });

  it.each([['//evil.test/x'], ['https://evil.test/'], ['javascript:alert(1)'], ['/\\evil.test'], [''], ['adm/adm-01'], [null]])('replaces %s with the fallback', (value) => {
    expect(safeNext(value, '/home/home-01')).toBe('/home/home-01');
  });
});
