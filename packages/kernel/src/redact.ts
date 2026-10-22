const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key/i;

function redact(value: unknown, extra: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => redact(item, extra));
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) || extra.has(key) ? REDACTED : redact(member, extra);
  }
  return result;
}

/**
 * A deep copy of an audit diff in which every value under a sensitive key (secrets, tokens,
 * passwords, keys, or a key the caller lists) is replaced by `[REDACTED]`, at every depth.
 */
export function safeDiff(diff: Record<string, unknown>, options: { sensitiveKeys?: readonly string[] } = {}): Record<string, unknown> {
  return redact(diff, new Set(options.sensitiveKeys ?? [])) as Record<string, unknown>;
}
