/**
 * One user intention to change something. Every request that belongs to the same intention (a retry after a lost
 * answer, a second click on the same button) must reuse the attempt so the server executes it once; a new
 * intention starts a new attempt.
 */
export interface CommandAttempt {
  readonly key: string;
}

/** Keys are random UUIDs: 36 visible characters, inside the server rule of 16 to 128. */
export function defaultKeyGenerator(): string {
  return globalThis.crypto.randomUUID();
}

export function newCommandAttempt(generate: () => string = defaultKeyGenerator): CommandAttempt {
  return { key: generate() };
}
