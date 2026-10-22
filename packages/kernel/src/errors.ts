/**
 * A domain failure that maps to a stable error code from the error registry
 * (Design/MACHVON_Design/03_Engineering/error_codes.json) and an HTTP status.
 * `detail` may name offending fields but must never carry user-supplied values.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string | undefined;

  constructor(code: string, status: number, detail?: string) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
