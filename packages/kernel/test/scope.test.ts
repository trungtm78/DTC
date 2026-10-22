import { scopeContains, scopeCovers } from '../src/scope';
import type { ResourceRef, Scope } from '../src/scope';

const UNIT_1 = '00000000-0000-4000-8000-000000000001';
const UNIT_12 = '00000000-0000-4000-8000-000000000012';
const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const CONTRACT = '00000000-0000-4000-8000-0000000000c1';

const resourceIn = (ownerUnitPath: string, ownerUnitId: string, extra: Partial<ResourceRef> = {}): ResourceRef => ({
  ownerUnitPath,
  ownerUnitId,
  ...extra,
});

describe('scopeContains', () => {
  it('lets TENANT contain everything', () => {
    expect(scopeContains({ kind: 'TENANT' }, resourceIn('/a/1/', UNIT_1))).toBe(true);
  });

  it('matches UNIT_SUBTREE on whole path segments only', () => {
    const scope: Scope = { kind: 'UNIT_SUBTREE', refIds: [UNIT_1], paths: ['/a/1/'] };
    expect(scopeContains(scope, resourceIn('/a/1/', UNIT_1))).toBe(true);
    expect(scopeContains(scope, resourceIn('/a/1/5/', '5'))).toBe(true);
    expect(scopeContains(scope, resourceIn('/a/12/', UNIT_12))).toBe(false);
    expect(scopeContains(scope, resourceIn('/a/', 'a'))).toBe(false);
  });

  it('normalises a subtree path that lacks the trailing slash to whole segments', () => {
    const scope: Scope = { kind: 'UNIT_SUBTREE', refIds: [UNIT_1], paths: ['/a/1'] };
    expect(scopeContains(scope, resourceIn('/a/12/', UNIT_12))).toBe(false);
    expect(scopeContains(scope, resourceIn('/a/1/5/', '5'))).toBe(true);
  });

  it('contains nothing for a UNIT_SUBTREE without paths', () => {
    expect(scopeContains({ kind: 'UNIT_SUBTREE', refIds: [UNIT_1] }, resourceIn('/a/1/', UNIT_1))).toBe(false);
  });

  it('matches UNIT_ONLY by owner unit id', () => {
    const scope: Scope = { kind: 'UNIT_ONLY', refIds: [UNIT_1] };
    expect(scopeContains(scope, resourceIn('/a/1/', UNIT_1))).toBe(true);
    expect(scopeContains(scope, resourceIn('/a/1/5/', '5'))).toBe(false);
  });

  it('matches PROJECT and CONTRACT by their own ids and not when the resource has none', () => {
    const project: Scope = { kind: 'PROJECT', refIds: [PROJECT] };
    const contract: Scope = { kind: 'CONTRACT', refIds: [CONTRACT] };
    expect(scopeContains(project, resourceIn('/a/1/', UNIT_1, { projectId: PROJECT }))).toBe(true);
    expect(scopeContains(project, resourceIn('/a/1/', UNIT_1))).toBe(false);
    expect(scopeContains(contract, resourceIn('/a/1/', UNIT_1, { contractId: CONTRACT }))).toBe(true);
    expect(scopeContains(contract, resourceIn('/a/1/', UNIT_1, { contractId: PROJECT }))).toBe(false);
  });
});

describe('scopeCovers', () => {
  const tenant: Scope = { kind: 'TENANT' };
  const subtree1: Scope = { kind: 'UNIT_SUBTREE', refIds: [UNIT_1], paths: ['/a/1/'] };
  const subtree12: Scope = { kind: 'UNIT_SUBTREE', refIds: [UNIT_12], paths: ['/a/12/'] };
  const child: Scope = { kind: 'UNIT_SUBTREE', refIds: ['5'], paths: ['/a/1/5/'] };
  const only5: Scope = { kind: 'UNIT_ONLY', refIds: ['5'], paths: ['/a/1/5/'] };

  it('lets TENANT cover everything and nothing but TENANT cover TENANT', () => {
    expect(scopeCovers(tenant, subtree1)).toBe(true);
    expect(scopeCovers(tenant, tenant)).toBe(true);
    expect(scopeCovers(subtree1, tenant)).toBe(false);
  });

  it('covers nested subtrees by path prefix and not a sibling that shares a string prefix', () => {
    expect(scopeCovers(subtree1, child)).toBe(true);
    expect(scopeCovers(child, subtree1)).toBe(false);
    expect(scopeCovers(subtree1, subtree12)).toBe(false);
  });

  it('lets a subtree cover a UNIT_ONLY inside it, but not the reverse', () => {
    expect(scopeCovers(subtree1, only5)).toBe(true);
    expect(scopeCovers(only5, subtree1)).toBe(false);
  });

  it('cannot prove coverage of a unit scope without paths', () => {
    expect(scopeCovers(subtree1, { kind: 'UNIT_ONLY', refIds: ['5'] })).toBe(false);
  });

  it('covers PROJECT and CONTRACT scopes only by subset of ids of the same kind', () => {
    const projects: Scope = { kind: 'PROJECT', refIds: [PROJECT, 'p2'] };
    expect(scopeCovers(projects, { kind: 'PROJECT', refIds: [PROJECT] })).toBe(true);
    expect(scopeCovers(projects, { kind: 'PROJECT', refIds: ['p3'] })).toBe(false);
    expect(scopeCovers(projects, { kind: 'CONTRACT', refIds: [PROJECT] })).toBe(false);
    expect(scopeCovers({ kind: 'UNIT_ONLY', refIds: ['5', '6'] }, { kind: 'UNIT_ONLY', refIds: ['5'] })).toBe(true);
    expect(scopeCovers({ kind: 'UNIT_ONLY', refIds: ['5'] }, { kind: 'UNIT_ONLY', refIds: ['5', '6'] })).toBe(false);
  });
});
