import { ApiError } from '@machvon/api-client';
import { describe, expect, it } from 'vitest';
import { describeProblem } from './problems';
import { buildUnitTree, expandableIds, isValidOn, visibleNodes } from './tree-model';
import { toOrgUnits } from './types';
import type { OrgUnit } from './types';

function unit(id: string, code: string, parent: string | null, extra: Partial<OrgUnit> = {}): OrgUnit {
  return {
    id,
    code,
    name: `Unit ${code}`,
    parent_id: parent,
    valid_from: '2025-01-01',
    valid_until: null,
    unit_type: 'DEPARTMENT',
    administrative_code: null,
    is_investor: false,
    legal_basis_ref: null,
    status: 'Active',
    successor_id: null,
    depth: 0,
    version: 1,
    ...extra,
  };
}

const THREE_LEVELS = [unit('c', 'C', 'b'), unit('a', 'A', null), unit('b', 'B', 'a'), unit('d', 'D', 'a')];

describe('buildUnitTree', () => {
  it('builds a three level tree with children in code order and aria levels', () => {
    const forest = buildUnitTree(THREE_LEVELS, '2026-06-01');
    expect(forest).toHaveLength(1);
    const root = forest[0];
    expect(root?.unit.id).toBe('a');
    expect(root?.level).toBe(1);
    expect(root?.children.map((node) => node.unit.id)).toEqual(['b', 'd']);
    expect(root?.children[0]?.children.map((node) => [node.unit.id, node.level])).toEqual([['c', 3]]);
  });

  it('dims a superseded unit on a later date and links its successor, but not on an earlier date', () => {
    const units = [
      unit('old', 'OLD', null, { valid_until: '2025-03-01', successor_id: 'new', status: 'Superseded' }),
      unit('new', 'NEW', null, { valid_from: '2025-03-01' }),
    ];
    const later = buildUnitTree(units, '2025-06-01');
    expect(later.map((node) => [node.unit.id, node.dimmed])).toEqual([
      ['new', false],
      ['old', true],
    ]);
    expect(later.find((node) => node.unit.id === 'old')?.successor?.id).toBe('new');
    const earlier = buildUnitTree(units, '2025-02-01');
    expect(earlier.map((node) => [node.unit.id, node.dimmed])).toEqual([
      ['new', true],
      ['old', false],
    ]);
  });

  it('treats validity as half open: valid on its first day, gone on its end date', () => {
    const range = { valid_from: '2025-01-01', valid_until: '2025-03-01' };
    expect(isValidOn(range, '2025-01-01')).toBe(true);
    expect(isValidOn(range, '2025-02-28')).toBe(true);
    expect(isValidOn(range, '2025-03-01')).toBe(false);
    expect(isValidOn(range, '2024-12-31')).toBe(false);
  });

  it('makes a unit whose parent is outside the list a root', () => {
    const forest = buildUnitTree([unit('x', 'X', 'outside'), unit('y', 'Y', 'x')], '2026-01-01');
    expect(forest.map((node) => node.unit.id)).toEqual(['x']);
    expect(forest[0]?.children.map((node) => node.unit.id)).toEqual(['y']);
  });

  it('keeps units on a parent cycle visible as roots and never loops', () => {
    const forest = buildUnitTree([unit('p', 'P', 'q'), unit('q', 'Q', 'p'), unit('s', 'S', 's')], '2026-01-01');
    const ids = (nodes: typeof forest): string[] => nodes.flatMap((node) => [node.unit.id, ...ids(node.children)]);
    expect(ids(forest).sort()).toEqual(['p', 'q', 's']);
  });

  it('orders equal codes by id so the order is stable', () => {
    const forest = buildUnitTree([unit('2', 'SAME', null), unit('1', 'SAME', null)], '2026-01-01');
    expect(forest.map((node) => node.unit.id)).toEqual(['1', '2']);
  });

  it('lists the visible nodes only below expanded parents, and every expandable id', () => {
    const forest = buildUnitTree(THREE_LEVELS, '2026-06-01');
    expect(visibleNodes(forest, new Set()).map((node) => node.unit.id)).toEqual(['a']);
    expect(visibleNodes(forest, new Set(['a'])).map((node) => node.unit.id)).toEqual(['a', 'b', 'd']);
    expect(visibleNodes(forest, expandableIds(forest)).map((node) => node.unit.id)).toEqual(['a', 'b', 'c', 'd']);
    expect([...expandableIds(forest)].sort()).toEqual(['a', 'b']);
  });
});

describe('toOrgUnits', () => {
  it('keeps complete rows, fills optional fields and drops rows without an identity', () => {
    const rows = [
      { id: 'u1', code: 'U1', name: 'One', valid_from: '2025-01-01', unit_type: 'COMMUNE', status: 'Active', parent_id: null, version: 4, depth: 2, is_investor: true },
      { id: 'u2', code: 'U2' },
      'not a row',
      null,
    ];
    const units = toOrgUnits(rows);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ id: 'u1', parent_id: null, version: 4, depth: 2, is_investor: true, valid_until: null, successor_id: null, administrative_code: null });
  });

  it('defaults a missing version and depth', () => {
    const [only] = toOrgUnits([{ id: 'u', code: 'U', name: 'N', valid_from: '2025-01-01', unit_type: 'OTHER', status: 'Planned' }]);
    expect(only).toMatchObject({ version: 1, depth: 0, is_investor: false });
  });
});

function problem(code: string, init: { status?: number; detail?: string; extensions?: Record<string, unknown> } = {}): ApiError {
  return new ApiError({ status: init.status ?? 422, code, detail: init.detail, extensions: init.extensions, correlationId: 'c' });
}

describe('describeProblem', () => {
  it.each([
    ['UNIT_CYCLE', undefined, 'cycle', 'new_parent_id'],
    ['UNIT_DEPTH_EXCEEDED', undefined, 'depth', 'parent_id'],
    ['UNIT_CODE_TAKEN', undefined, 'codeTaken', 'code'],
    ['UNIT_VALIDITY_INVALID', undefined, 'validity', 'valid_from'],
    ['VALIDATION_FAILED', 'administrative_code', 'invalid', 'administrative_code'],
    ['FIELD_NOT_ALLOWED', 'unit_type', 'fieldNotAllowed', 'unit_type'],
    ['INVALID_REQUEST', 'name', 'invalid', 'name'],
  ])('shows %s with detail %s as %s on %s', (code, detail, key, field) => {
    expect(describeProblem(problem(code, { detail }))).toMatchObject({ reason: key, field, kind: 'field' });
  });

  it('prefers the field the server names over the default field of the code', () => {
    expect(describeProblem(problem('UNIT_CODE_TAKEN', { detail: 'name' })).field).toBe('name');
  });

  it('ignores a detail that is not a form field', () => {
    expect(describeProblem(problem('VALIDATION_FAILED', { detail: 'something odd' }))).toMatchObject({ field: undefined, kind: 'general' });
  });

  it('reports a version conflict with the current version', () => {
    expect(describeProblem(problem('VERSION_CONFLICT', { status: 409, extensions: { current_version: 8 } }))).toMatchObject({ kind: 'conflict', currentVersion: 8 });
    expect(describeProblem(problem('VERSION_CONFLICT', { status: 409 }))).toMatchObject({ kind: 'conflict', currentVersion: undefined });
  });

  it('recognises step-up, an expired session, a refusal, a missing unit and unknown failures', () => {
    expect(describeProblem(problem('MFA_REQUIRED', { status: 403 })).kind).toBe('stepUp');
    expect(describeProblem(problem('SESSION_EXPIRED', { status: 401 })).kind).toBe('session');
    expect(describeProblem(problem('SCOPE_DENIED', { status: 403 })).reason).toBe('scopeDenied');
    expect(describeProblem(problem('RESOURCE_NOT_FOUND', { status: 404 })).reason).toBe('notFound');
    expect(describeProblem(problem('SOMETHING_ELSE', { status: 500 }))).toMatchObject({ reason: 'general', kind: 'general' });
    expect(describeProblem(new Error('boom'))).toMatchObject({ reason: 'general', kind: 'general' });
  });
});
