import { GUEST_GRACE_DAYS, MAX_NAME_LENGTH, MAX_REASON_LENGTH, MIN_REASON_LENGTH } from './types';
import type { ContractOption } from './types';

const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_CONTRACTS = 50;

/** What a form field can be wrong with; the dialog words each in the active language. */
export type FieldProblem = 'required' | 'email' | 'tooLong' | 'tooShort' | 'past' | 'beyond' | 'date';

export function emailProblem(value: string): FieldProblem | undefined {
  const email = value.trim();
  if (email === '') return 'required';
  return email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email) ? 'email' : undefined;
}

export function nameProblem(value: string): FieldProblem | undefined {
  return value.trim().length > MAX_NAME_LENGTH ? 'tooLong' : undefined;
}

export function reasonProblem(value: string): FieldProblem | undefined {
  const reason = value.trim();
  if (reason.length < MIN_REASON_LENGTH) return reason === '' ? 'required' : 'tooShort';
  return reason.length > MAX_REASON_LENGTH ? 'tooLong' : undefined;
}

/** The ISO instant of the text of a `datetime-local` field, or undefined for an empty or unreadable one. */
export function isoOf(local: string): string | undefined {
  if (local === '') return undefined;
  const time = Date.parse(local);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** The value of a `datetime-local` field for an instant, in the browser's time zone (what the field itself would show). */
export function localInputOf(instant: Date): string {
  const shifted = new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** `valid_until` of a staff invitation is optional; when given it must lie in the future. */
export function staffValidUntilProblem(local: string, now: Date): FieldProblem | undefined {
  if (local === '') return undefined;
  const iso = isoOf(local);
  if (iso === undefined) return 'date';
  return Date.parse(iso) <= now.getTime() ? 'past' : undefined;
}

/**
 * The latest moment a guest may be given for these contracts (BR-IAM-08, as the server computes it): 365 days after the
 * latest completion among them, counted from today when none has a completion date or the latest has passed.
 */
export function guestMaxUntil(contracts: readonly ContractOption[], now: Date): Date {
  const ends = contracts.flatMap((contract) => (contract.completionDue === null ? [] : [Date.parse(`${contract.completionDue}T00:00:00Z`)])).filter((time) => !Number.isNaN(time));
  const base = Math.max(now.getTime(), ...ends);
  return new Date(base + GUEST_GRACE_DAYS * DAY_MS);
}

/** `valid_until` of a guest is required, in the future and not beyond the bound of the chosen contracts. */
export function guestValidUntilProblem(local: string, contracts: readonly ContractOption[], now: Date): FieldProblem | undefined {
  if (local === '') return 'required';
  const iso = isoOf(local);
  if (iso === undefined) return 'date';
  const time = Date.parse(iso);
  if (time <= now.getTime()) return 'past';
  return time > guestMaxUntil(contracts, now).getTime() ? 'beyond' : undefined;
}

export function contractsProblem(selected: readonly string[]): FieldProblem | undefined {
  if (selected.length === 0) return 'required';
  return selected.length > MAX_CONTRACTS ? 'tooLong' : undefined;
}
