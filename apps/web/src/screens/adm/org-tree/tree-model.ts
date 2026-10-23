import type { OrgUnit } from './types';

export interface TreeNode {
  unit: OrgUnit;
  children: TreeNode[];
  /** 1 for a root, as `aria-level` counts. */
  level: number;
  /** The unit is not valid on the as-of date (not yet, or no longer): the tree shows it dimmed. */
  dimmed: boolean;
  /** The unit that took over a superseded unit, when it is in the list. */
  successor: OrgUnit | undefined;
}

/** A unit is valid on a date when `valid_from <= date < valid_until` (the validity is half open; dates are ISO `YYYY-MM-DD`). */
export function isValidOn(unit: Pick<OrgUnit, 'valid_from' | 'valid_until'>, asOf: string): boolean {
  return unit.valid_from <= asOf && (unit.valid_until === null || asOf < unit.valid_until);
}

const byCode = (a: OrgUnit, b: OrgUnit): number => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds the forest of units. A unit whose parent is not in the list (outside the reader's subtree) becomes a root; a
 * unit that a parent cycle in the data would hide is shown as a root too, so no unit ever disappears. Children and roots
 * are in code order.
 */
export function buildUnitTree(units: readonly OrgUnit[], asOf: string): TreeNode[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const childrenOf = new Map<string, OrgUnit[]>();
  const roots: OrgUnit[] = [];
  for (const unit of units) {
    if (unit.parent_id !== null && byId.has(unit.parent_id) && unit.parent_id !== unit.id) {
      childrenOf.set(unit.parent_id, [...(childrenOf.get(unit.parent_id) ?? []), unit]);
    } else {
      roots.push(unit);
    }
  }

  const placed = new Set<string>();
  const build = (unit: OrgUnit, level: number): TreeNode => {
    placed.add(unit.id);
    const children = (childrenOf.get(unit.id) ?? []).filter((child) => !placed.has(child.id)).sort(byCode);
    return {
      unit,
      level,
      dimmed: !isValidOn(unit, asOf),
      successor: unit.successor_id === null ? undefined : byId.get(unit.successor_id),
      children: children.map((child) => build(child, level + 1)),
    };
  };

  const forest = roots.sort(byCode).map((root) => build(root, 1));
  // Units on a parent cycle have no root above them; surface each as a root so the data problem is visible, not hidden.
  for (const unit of [...units].sort(byCode)) if (!placed.has(unit.id)) forest.push(build(unit, 1));
  return forest;
}

/** The nodes in the order the tree shows them, descending only into the expanded ones. */
export function visibleNodes(forest: readonly TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      if (expanded.has(node.unit.id)) walk(node.children);
    }
  };
  walk(forest);
  return out;
}

/** The ids of every unit with children: the tree opens fully on first display. */
export function expandableIds(forest: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.children.length > 0) ids.add(node.unit.id);
      walk(node.children);
    }
  };
  walk(forest);
  return ids;
}
