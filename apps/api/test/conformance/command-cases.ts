import { listOperations } from '@machvon/contracts';
import type { OpenApiDocument } from '@machvon/contracts';
import { newKey } from '../command-harness';
import type { Reply } from '../command-harness';

const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const IF_MATCH_PARAMETER = /^if-match$/i;

export interface WriteOperation {
  operationId: string;
  method: string;
  path: string;
  /** The operation declares an `If-Match` header parameter. */
  versioned: boolean;
}

/** How a generated case reaches one concrete command: it creates a target, sends requests, and has two distinct bodies. */
export interface CommandSubject {
  /** Creates a fresh target and returns its current version (null when the command has no version). */
  prepare(): Promise<{ version: number | null }>;
  send(request: { key: string | null; ifMatch?: string; body: unknown }): Promise<Reply>;
  body(variant: 'a' | 'b'): unknown;
}

export interface CommandCase {
  /** `<operationId>:<case>`, stable so a failing case can be named in a report. */
  id: string;
  description: string;
  run(subject: CommandSubject): Promise<void>;
}

function parameterNames(operation: Record<string, unknown>, doc: OpenApiDocument): string[] {
  const parameters = Array.isArray(operation.parameters) ? (operation.parameters as unknown[]) : [];
  const shared = (doc.components?.parameters ?? {}) as Record<string, { name?: string }>;
  return parameters.map((parameter) => {
    const entry = parameter as { name?: string; $ref?: string };
    if (entry.name !== undefined) return entry.name;
    return shared[entry.$ref?.split('/').pop() ?? '']?.name ?? '';
  });
}

/** Every POST, PUT, PATCH and DELETE operation of the document, sorted by operationId. */
export function writeOperationsOf(doc: OpenApiDocument): WriteOperation[] {
  return listOperations(doc)
    .filter((entry) => WRITE_METHODS.has(entry.method))
    .map((entry) => ({
      operationId: entry.id,
      method: entry.method,
      path: entry.path,
      versioned: parameterNames(entry.operation, doc).some((name) => IF_MATCH_PARAMETER.test(name)),
    }))
    .sort((a, b) => (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0));
}

const etag = (version: number | null): string | undefined => (version === null ? undefined : `"${version}"`);

/** The conformance cases of BR-PLT-02 and ST-KERNEL-028 for one write operation: three, plus two when it is versioned. */
export function commandCasesFor(operation: WriteOperation): CommandCase[] {
  const id = (name: string): string => `${operation.operationId}:${name}`;
  const cases: CommandCase[] = [
    {
      id: id('missing-key'),
      description: 'a request without Idempotency-Key is refused with 400 INVALID_REQUEST',
      async run(subject) {
        const { version } = await subject.prepare();
        const reply = await subject.send({ key: null, ifMatch: etag(version), body: subject.body('a') });
        expect(reply.status).toBe(400);
        expect(reply.json.code).toBe('INVALID_REQUEST');
      },
    },
    {
      id: id('replay'),
      description: 'the same key and body returns the first answer with Idempotency-Replayed: true',
      async run(subject) {
        const { version } = await subject.prepare();
        const key = newKey();
        const first = await subject.send({ key, ifMatch: etag(version), body: subject.body('a') });
        expect(first.status).toBeLessThan(300);
        const second = await subject.send({ key, ifMatch: etag(version), body: subject.body('a') });
        expect(second.status).toBe(first.status);
        expect(second.json).toEqual(first.json);
        expect(second.headers.get('idempotency-replayed')).toBe('true');
      },
    },
    {
      id: id('conflict'),
      description: 'the same key with another body is refused with 409 IDEMPOTENCY_CONFLICT',
      async run(subject) {
        const { version } = await subject.prepare();
        const key = newKey();
        const first = await subject.send({ key, ifMatch: etag(version), body: subject.body('a') });
        expect(first.status).toBeLessThan(300);
        const second = await subject.send({ key, ifMatch: etag(version), body: subject.body('b') });
        expect(second.status).toBe(409);
        expect(second.json.code).toBe('IDEMPOTENCY_CONFLICT');
      },
    },
  ];
  if (operation.versioned) {
    cases.push(
      {
        id: id('missing-if-match'),
        description: 'a versioned command without If-Match is refused with 428 PRECONDITION_REQUIRED',
        async run(subject) {
          await subject.prepare();
          const reply = await subject.send({ key: newKey(), body: subject.body('a') });
          expect(reply.status).toBe(428);
          expect(reply.json.code).toBe('PRECONDITION_REQUIRED');
        },
      },
      {
        id: id('stale-if-match'),
        description: 'a second writer with the same If-Match is refused with 409 VERSION_CONFLICT and the current version',
        async run(subject) {
          const { version } = await subject.prepare();
          const first = await subject.send({ key: newKey(), ifMatch: etag(version), body: subject.body('a') });
          expect(first.status).toBeLessThan(300);
          const second = await subject.send({ key: newKey(), ifMatch: etag(version), body: subject.body('b') });
          expect(second.status).toBe(409);
          expect(second.json.code).toBe('VERSION_CONFLICT');
          expect(second.json.current_version).toBeGreaterThan(version ?? 0);
        },
      },
    );
  }
  return cases;
}
