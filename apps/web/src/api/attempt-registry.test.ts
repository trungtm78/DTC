import { ApiError } from '@machvon/api-client';
import type { CommandAttempt } from '@machvon/api-client';
import { describe, expect, it } from 'vitest';
import { AttemptRegistry, isDefinitiveRefusal } from './attempt-registry';

const refusal = (status: number, code: string): ApiError => new ApiError({ status, code, correlationId: 'c' });
const counter = (): (() => CommandAttempt) => {
  let n = 0;
  return () => ({ key: `key-${(n += 1)}` });
};

describe('isDefinitiveRefusal', () => {
  it.each([
    [refusal(409, 'PLAN_NOT_PUBLISHED'), true],
    [refusal(422, 'VALIDATION_FAILED'), true],
    [refusal(403, 'SCOPE_DENIED'), true],
    [refusal(408, 'REQUEST_TIMEOUT'), false],
    [refusal(429, 'RATE_LIMIT'), false],
    [refusal(409, 'IDEMPOTENCY_IN_PROGRESS'), false],
    [refusal(500, 'INTERNAL_ERROR'), false],
    [refusal(0, 'NETWORK_ERROR'), false],
    [new Error('boom'), false],
  ])('classifies %#', (failure, expected) => {
    expect(isDefinitiveRefusal(failure)).toBe(expected);
  });
});

describe('AttemptRegistry', () => {
  it('hands out one attempt per payload until the intention ends', () => {
    const registry = new AttemptRegistry(counter());
    const first = registry.forPayload({ a: 1 });
    expect(registry.forPayload({ a: 1 })).toBe(first);
    expect(registry.forPayload({ a: 2 })).not.toBe(first);
    registry.done();
    expect(registry.forPayload({ a: 2 }).key).toBe('key-3');
  });

  it('drops the attempt after a definitive refusal, so the unchanged form is a new request, and keeps it after a lost answer', () => {
    const registry = new AttemptRegistry(counter());
    const first = registry.forPayload({ a: 1 });
    registry.ended(refusal(500, 'INTERNAL_ERROR'));
    expect(registry.forPayload({ a: 1 })).toBe(first);
    registry.ended(refusal(409, 'PLAN_NOT_PUBLISHED'));
    expect(registry.forPayload({ a: 1 })).not.toBe(first);
  });
});
