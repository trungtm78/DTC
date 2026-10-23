import type { Overall, SignatureRow } from './types';

/** The six checks of the screen (DOC-07), in the order the mockup lists them. */
export const CHECK_IDS = ['order', 'chain', 'revocation', 'incremental', 'timestamp', 'conclusion'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** `pass` is checked and fine, `review` could not be settled, `fail` is wrong, `none` was not checked or has nothing to check. */
export type CheckState = 'pass' | 'review' | 'fail' | 'none';

export interface Check {
  id: CheckId;
  state: CheckState;
}

const ORDER_FAILURES: readonly string[] = [
  'BYTE_RANGE_INVALID',
  'SIGNATURE_MALFORMED',
  'DIGEST_MISMATCH',
  'SIGNATURE_INVALID',
  'ALGORITHM_NOT_ALLOWED',
  'SIGNER_CERTIFICATE_MISMATCH',
  'SIGNING_ORDER_INVALID',
];
const TIME_FAILURES: readonly string[] = ['TIMESTAMP_INVALID', 'CERTIFICATE_EXPIRED_AT_SIGNING'];

const hasAny = (signature: SignatureRow, codes: readonly string[]): boolean => signature.findings.some((finding) => codes.includes(finding));

function orderState(signatures: readonly SignatureRow[]): CheckState {
  return signatures.some((signature) => hasAny(signature, ORDER_FAILURES)) ? 'fail' : 'pass';
}

function chainState(signatures: readonly SignatureRow[]): CheckState {
  if (signatures.some((signature) => signature.chainStatus === 'UNTRUSTED' || signature.findings.includes('CHAIN_UNTRUSTED'))) return 'fail';
  if (signatures.some((signature) => signature.chainStatus === 'INCOMPLETE')) return 'review';
  return signatures.every((signature) => signature.chainStatus === 'TRUSTED') ? 'pass' : 'none';
}

function revocationState(signatures: readonly SignatureRow[]): CheckState {
  if (signatures.some((signature) => signature.revocationStatus === 'REVOKED')) return 'fail';
  if (signatures.some((signature) => signature.revocationStatus === 'UNKNOWN')) return 'review';
  return signatures.every((signature) => signature.revocationStatus === 'GOOD') ? 'pass' : 'none';
}

function incrementalState(signatures: readonly SignatureRow[]): CheckState {
  if (signatures.some((signature) => signature.incrementalChangesAllowed === false)) return 'fail';
  return signatures.every((signature) => signature.incrementalChangesAllowed === true) ? 'pass' : 'none';
}

function timestampState(signatures: readonly SignatureRow[]): CheckState {
  if (signatures.some((signature) => hasAny(signature, TIME_FAILURES))) return 'fail';
  if (signatures.some((signature) => signature.findings.includes('SIGNING_TIME_UNPROVEN'))) return 'review';
  return signatures.every((signature) => signature.timestampAt !== null) ? 'pass' : 'none';
}

const CONCLUSION: Readonly<Record<Overall, CheckState>> = { VALID: 'pass', INVALID: 'fail', INDETERMINATE: 'review' };

/**
 * The state of each check from the signatures of the latest verification. With no signature nothing was checked, so
 * every row is `none` and the conclusion follows the overall result (INDETERMINATE: nothing vouches for the file).
 */
export function checksOf(overall: Overall, signatures: readonly SignatureRow[]): Check[] {
  const empty = signatures.length === 0;
  const states: Readonly<Record<CheckId, CheckState>> = {
    order: empty ? 'none' : orderState(signatures),
    chain: empty ? 'none' : chainState(signatures),
    revocation: empty ? 'none' : revocationState(signatures),
    incremental: empty ? 'none' : incrementalState(signatures),
    timestamp: empty ? 'none' : timestampState(signatures),
    conclusion: CONCLUSION[overall],
  };
  return CHECK_IDS.map((id) => ({ id, state: states[id] }));
}

/** The class of the pill that shows a state: the prototype's green, amber, red and grey. */
export const PILL_CLASS: Readonly<Record<CheckState, string>> = { pass: 'pill', review: 'pill warn', fail: 'pill red', none: 'pill gray' };
