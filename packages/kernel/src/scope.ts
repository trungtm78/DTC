export type Scope =
  | { kind: 'TENANT' }
  | { kind: 'UNIT_SUBTREE' | 'UNIT_ONLY' | 'PROJECT' | 'CONTRACT'; refIds: readonly string[]; paths?: readonly string[] };

export interface ResourceRef {
  /** Path of the owning organisation unit: `/<root>/<…>/<id>/`. */
  ownerUnitPath: string;
  ownerUnitId: string;
  projectId?: string;
  contractId?: string;
}

// Paths are compared on whole segments, so every path is closed with a slash before a prefix test.
function closed(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function startsWithAny(path: string, prefixes: readonly string[]): boolean {
  const target = closed(path);
  return prefixes.some((prefix) => target.startsWith(closed(prefix)));
}

function isSubset(inner: readonly string[], outer: readonly string[]): boolean {
  return inner.every((id) => outer.includes(id));
}

/** Whether the scope contains the resource (BR-IAM-04). A subtree scope without paths contains nothing. */
export function scopeContains(scope: Scope, resource: ResourceRef): boolean {
  switch (scope.kind) {
    case 'TENANT':
      return true;
    case 'UNIT_SUBTREE':
      return scope.paths !== undefined && startsWithAny(resource.ownerUnitPath, scope.paths);
    case 'UNIT_ONLY':
      return scope.refIds.includes(resource.ownerUnitId);
    case 'PROJECT':
      return resource.projectId !== undefined && scope.refIds.includes(resource.projectId);
    case 'CONTRACT':
      return resource.contractId !== undefined && scope.refIds.includes(resource.contractId);
  }
}

/**
 * Whether every resource of `inner` is also in `outer`, as far as it can be proved from the scope values.
 * TENANT covers everything; a unit subtree covers unit scopes whose paths all lie below one of its paths;
 * other scopes cover a scope of the same kind with a subset of ids. Anything unprovable is not covered.
 */
export function scopeCovers(outer: Scope, inner: Scope): boolean {
  if (outer.kind === 'TENANT') return true;
  if (inner.kind === 'TENANT') return false;
  if (outer.kind === 'UNIT_SUBTREE') {
    if (inner.kind !== 'UNIT_SUBTREE' && inner.kind !== 'UNIT_ONLY') return false;
    return outer.paths !== undefined && inner.paths !== undefined && inner.paths.every((path) => startsWithAny(path, outer.paths ?? []));
  }
  return outer.kind === inner.kind && isSubset(inner.refIds, outer.refIds);
}
