const WILDCARD_SUFFIX = '.*';

/**
 * Whether a held permission (an exact name or a `prefix.*` pattern) grants the required one (also an exact name or a
 * pattern). `iam.*` matches every name below `iam.` but not `iam` itself or `iamx.y`; a bare `*` never matches, so a
 * stored role can never hold everything by accident. A pattern is granted by a broader or equal pattern only.
 */
export function permissionMatches(held: string, required: string): boolean {
  if (held === '' || held === '*') return false;
  if (held === required) return true;
  if (!held.endsWith(WILDCARD_SUFFIX)) return false;
  const prefix = held.slice(0, -1);
  return required.startsWith(prefix) && required.length > prefix.length;
}
