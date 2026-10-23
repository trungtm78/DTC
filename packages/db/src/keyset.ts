import { DomainError } from '@machvon/kernel';

const CURSOR_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;

/** SQL form of the microsecond text of a timestamp column: the ordering key of a keyset cursor. */
export function timestampKey(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * A keyset cursor over a timestamp is the microsecond text of the column and the row id. Anything else would reach the
 * `::timestamptz` cast and fail there as a 500, so a cursor that is not such a timestamp is refused as a malformed
 * query parameter, naming it and never echoing its value.
 */
export function assertTimestampCursor(code: string | undefined): void {
  if (code === undefined) return;
  const match = CURSOR_TIMESTAMP.exec(code);
  const [year, month, day, hour, minute, second] = match === null ? [] : match.slice(1, 7).map(Number);
  const date = match === null ? undefined : new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const calendar = date !== undefined && date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 0) - 1 && date.getUTCDate() === day;
  if (!calendar || (hour ?? 99) > 23 || (minute ?? 99) > 59 || (second ?? 99) > 59) throw new DomainError('VALIDATION_FAILED', 422, 'cursor');
}
