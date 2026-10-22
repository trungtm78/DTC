/**
 * A domain failure that maps to a stable error code from the error registry
 * (Design/MACHVON_Design/03_Engineering/error_codes.json) and an HTTP status.
 * `detail` may name offending fields but must never carry user-supplied values.
 * `extensions` are safe, machine-readable members of the problem body (for example `current_version`)
 * and `headers` are safe response headers (for example `Retry-After`).
 */
export interface DomainErrorOptions {
  extensions?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string | undefined;
  readonly extensions: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: string, status: number, detail?: string, options?: DomainErrorOptions) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.extensions = options?.extensions;
    this.headers = options?.headers;
  }
}
