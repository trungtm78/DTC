import { resolve } from 'node:path';
import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { DomainError, loadErrorRegistry } from '@machvon/kernel';
import { ProblemFilter } from '../src/problem.filter';

const REGISTRY = loadErrorRegistry(resolve(__dirname, '../../../Design/MACHVON_Design/03_Engineering/error_codes.json'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Captured {
  status: number | undefined;
  headers: Record<string, string>;
  raw: string;
  body: Record<string, unknown>;
}

function run(filter: ProblemFilter, exception: unknown, headers: Record<string, string | string[] | undefined> = {}): Captured {
  const captured: Captured = { status: undefined, headers: {}, raw: '', body: {} };
  const response = {
    status(code: number) {
      captured.status = code;
      return response;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return response;
    },
    send(payload: string) {
      captured.raw = payload;
      captured.body = JSON.parse(payload) as Record<string, unknown>;
      return response;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers }) }) } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return captured;
}

function newFilter(registry = REGISTRY) {
  const logged: unknown[][] = [];
  const filter = new ProblemFilter(registry, { error: (...args: unknown[]) => void logged.push(args) });
  return { filter, logged };
}

describe('ProblemFilter', () => {
  it('renders a DomainError as application/problem+json with the standard members', () => {
    const { filter } = newFilter();
    const result = run(filter, new DomainError('FIELD_NOT_ALLOWED', 400, 'status, tenant_id, role'));
    expect(result.status).toBe(400);
    expect(result.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(result.body).toEqual({
      type: 'urn:machvon:error:FIELD_NOT_ALLOWED',
      title: 'error.FIELD_NOT_ALLOWED.title',
      status: 400,
      code: 'FIELD_NOT_ALLOWED',
      detail: 'status, tenant_id, role',
      correlationId: expect.stringMatching(UUID),
    });
    expect(result.headers['x-correlation-id']).toBe(result.body.correlationId);
  });

  it('omits detail when the DomainError has none', () => {
    const result = run(newFilter().filter, new DomainError('SCOPE_DENIED', 403));
    expect(result.status).toBe(403);
    expect(result.body).not.toHaveProperty('detail');
  });

  it('turns an unknown error into 500 INTERNAL_ERROR without message, stack, SQL text or constraint names', () => {
    const { filter, logged } = newFilter();
    const failure = Object.assign(new Error('select * from secret where email = $1'), {
      constraint: 'users_email_key',
      detail: 'Key (email)=(a@b.c) already exists.',
      table: 'users',
    });
    const result = run(filter, failure);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      type: 'urn:machvon:error:INTERNAL_ERROR',
      title: 'error.INTERNAL_ERROR.title',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'error.INTERNAL_ERROR.detail',
      correlationId: expect.stringMatching(UUID),
    });
    for (const leaked of ['select', 'secret', 'users_email_key', 'a@b.c', 'users', 'problem.filter', 'at ', 'stack']) {
      expect(result.raw).not.toContain(leaked);
    }
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe(failure);
    expect(logged[0]?.[1]).toBe(result.body.correlationId);
  });

  it.each([
    ['a string', 'boom select 1'],
    ['null', null],
    ['undefined', undefined],
    ['an object', { message: 'secret' }],
  ])('turns %s thrown as an exception into 500 INTERNAL_ERROR', (_label, thrown) => {
    const result = run(newFilter().filter, thrown);
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('INTERNAL_ERROR');
    expect(result.raw).not.toContain('secret');
    expect(result.raw).not.toContain('select');
  });

  it('maps Nest HttpException statuses to the nearest registered code and drops the message', () => {
    const { filter } = newFilter();
    const notFound = run(filter, new NotFoundException('Cannot GET /internal/path'));
    expect(notFound.status).toBe(404);
    expect(notFound.body.code).toBe('RESOURCE_NOT_FOUND');
    expect(notFound.raw).not.toContain('internal');
    expect(notFound.body.detail).toBe('error.RESOURCE_NOT_FOUND.detail');

    const bad = run(filter, new BadRequestException('Unexpected token } in JSON at position 4'));
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(bad.raw).not.toContain('token');

    expect(run(filter, new HttpException('x', 403)).body.code).toBe('SCOPE_DENIED');
    expect(run(filter, new HttpException('x', 401)).body.code).toBe('SESSION_EXPIRED');
    expect(run(filter, new HttpException('x', 429)).body.code).toBe('RATE_LIMIT');
    expect(run(filter, new HttpException('x', 413)).body.code).toBe('VALIDATION_FAILED');
  });

  it('maps a 5xx HttpException to 500 INTERNAL_ERROR', () => {
    const result = run(newFilter().filter, new HttpException('upstream said select 1', 503));
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('INTERNAL_ERROR');
    expect(result.raw).not.toContain('select');
  });

  it('falls back to 500 INTERNAL_ERROR when the nearest code is not registered', () => {
    const empty = new Map<string, { status: number; title: string }>();
    const result = run(newFilter(empty).filter, new NotFoundException());
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('INTERNAL_ERROR');
  });

  it('takes the correlation id from a UUID x-correlation-id header', () => {
    const id = '0b7f6c0e-2d52-4c41-9a7e-5d4c3b2a1f00';
    expect(run(newFilter().filter, new Error('x'), { 'x-correlation-id': id }).body.correlationId).toBe(id);
  });

  it.each([
    ['not a UUID', 'abc'],
    ['an injection attempt', 'x\r\nSet-Cookie: a=b'],
    ['a repeated header', ['0b7f6c0e-2d52-4c41-9a7e-5d4c3b2a1f00', '0b7f6c0e-2d52-4c41-9a7e-5d4c3b2a1f01']],
    ['missing', undefined],
  ])('generates a correlation id when the header is %s', (_label, header) => {
    const result = run(newFilter().filter, new Error('x'), { 'x-correlation-id': header });
    expect(result.body.correlationId).toMatch(UUID);
    expect(result.body.correlationId).not.toBe(header);
  });
});
