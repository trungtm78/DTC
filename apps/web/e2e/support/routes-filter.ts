/**
 * Applies the `E2E_ROUTES` selection (comma separated route ids, for a quick run) to the route table. A missing or
 * empty selection walks everything. Ids that are not in the table are returned, never dropped: a mistyped id must
 * not turn into a walk that quietly checks fewer pages (or none) and passes.
 */
export function selectRoutes<T extends { id: string }>(routes: readonly T[], spec: string | undefined): { selected: T[]; unknown: string[] } {
  const wanted = (spec ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '');
  if (wanted.length === 0) return { selected: [...routes], unknown: [] };
  const known = new Set(routes.map((route) => route.id));
  return { selected: routes.filter((route) => wanted.includes(route.id)), unknown: wanted.filter((id) => !known.has(id)) };
}
