import { breakingChanges } from '../src/breaking-changes';
import type { Change } from '../src/breaking-changes';
import type { OpenApiDocument } from '../src/openapi-document';
import { documentWith, jsonResponse, loadRealDocument } from './fixtures';

const UNIT = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'name'],
  properties: {
    code: { type: 'string', pattern: '^[A-Z]+$' },
    name: { type: 'string' },
    kind: { type: 'string', enum: ['A', 'B', 'C'] },
    parent: { $ref: '#/components/schemas/Parent' },
  },
};

const PARENT = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' }, label: { type: 'string' } } };

function operation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operationId: 'createUnit',
    'x-permission': 'org.unit.manage',
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UnitCreate' } } } },
    responses: jsonResponse({ $ref: '#/components/schemas/UnitView' }),
    ...overrides,
  };
}

function baseline(options: { unit?: Record<string, unknown>; op?: Record<string, unknown>; view?: Record<string, unknown>; extraPaths?: Record<string, unknown> } = {}): OpenApiDocument {
  return documentWith(
    {
      '/units': { post: options.op ?? operation() },
      '/units/{id}': { get: { operationId: 'getUnit', 'x-permission': 'org.unit.read', responses: jsonResponse({ $ref: '#/components/schemas/UnitView' }) } },
      ...(options.extraPaths ?? {}),
    },
    {
      UnitCreate: options.unit ?? UNIT,
      UnitView: options.view ?? { type: 'object', required: ['id', 'code'], properties: { id: { type: 'string' }, code: { type: 'string' }, state: { type: 'string', enum: ['Active', 'Closed'] } } },
      Parent: PARENT,
    },
  );
}

function kinds(changes: readonly Change[]): string[] {
  return changes.map((change) => change.kind);
}

describe('breakingChanges', () => {
  it('reports nothing for an identical document and for the real document compared with itself', () => {
    expect(breakingChanges(baseline(), baseline())).toEqual([]);
    const real = loadRealDocument();
    expect(breakingChanges(real, real)).toEqual([]);
  });

  it('does not flag additive changes: a new operation, a new optional request field, a new response field, a widened request enum', () => {
    const current = baseline({
      unit: { ...UNIT, properties: { ...UNIT.properties, note: { type: 'string' }, kind: { type: 'string', enum: ['A', 'B', 'C', 'D'] } } },
      view: { type: 'object', required: ['id', 'code'], properties: { id: { type: 'string' }, code: { type: 'string' }, state: { type: 'string', enum: ['Active', 'Closed'] }, extra: { type: 'string' } } },
      extraPaths: { '/things': { get: { operationId: 'listThings', 'x-permission': 'org.unit.read', responses: jsonResponse({ type: 'object' }) } } },
    });
    expect(breakingChanges(baseline(), current)).toEqual([]);
  });

  it('flags a removed operation and an operation that moved', () => {
    const removed = JSON.parse(JSON.stringify(baseline())) as OpenApiDocument;
    delete removed.paths['/units/{id}'];
    expect(breakingChanges(baseline(), removed)).toEqual([expect.objectContaining({ kind: 'OPERATION_REMOVED', operation: 'getUnit' })]);

    const moved = baseline({ op: operation() });
    const current = JSON.parse(JSON.stringify(moved)) as OpenApiDocument;
    current.paths['/v2/units'] = current.paths['/units'] as Record<string, unknown>;
    delete current.paths['/units'];
    expect(breakingChanges(baseline(), current)).toEqual([expect.objectContaining({ kind: 'OPERATION_MOVED', operation: 'createUnit' })]);
  });

  it('flags a changed x-permission', () => {
    const current = baseline({ op: operation({ 'x-permission': 'org.unit.admin' }) });
    expect(breakingChanges(baseline(), current)).toEqual([
      expect.objectContaining({ kind: 'PERMISSION_CHANGED', operation: 'createUnit', before: 'org.unit.manage', after: 'org.unit.admin' }),
    ]);
  });

  it('flags a removed request field, a retyped request field and a field removed deep inside a referenced schema', () => {
    const removed = baseline({ unit: { ...UNIT, properties: { code: UNIT.properties.code, name: UNIT.properties.name, parent: UNIT.properties.parent } } });
    const retyped = baseline({ unit: { ...UNIT, properties: { ...UNIT.properties, name: { type: 'integer' } } } });
    const deep = documentWith({ '/units': { post: operation() }, '/units/{id}': (baseline().paths['/units/{id}'] as Record<string, unknown>) }, {
      UnitCreate: UNIT,
      UnitView: (baseline().components?.schemas as Record<string, unknown>).UnitView,
      Parent: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    });
    expect(breakingChanges(baseline(), removed)).toEqual([expect.objectContaining({ kind: 'FIELD_REMOVED', side: 'request', location: 'kind' })]);
    expect(breakingChanges(baseline(), retyped)).toEqual([expect.objectContaining({ kind: 'FIELD_RETYPED', side: 'request', location: 'name', before: 'string', after: 'integer' })]);
    expect(breakingChanges(baseline(), deep)).toEqual([expect.objectContaining({ kind: 'FIELD_REMOVED', side: 'request', location: 'parent.label' })]);
  });

  it('flags removed and retyped response fields but not a response field that stays', () => {
    const removed = baseline({ view: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, state: { type: 'string', enum: ['Active', 'Closed'] } } } });
    const retyped = baseline({ view: { type: 'object', required: ['id', 'code'], properties: { id: { type: 'integer' }, code: { type: 'string' }, state: { type: 'string', enum: ['Active', 'Closed'] } } } });
    expect(kinds(breakingChanges(baseline(), removed)).filter((kind) => kind === 'FIELD_REMOVED')).toHaveLength(2);
    expect(breakingChanges(baseline(), retyped)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'FIELD_RETYPED', side: 'response', location: 'id' })]),
    );
  });

  it('flags a request enum that lost a value and a response enum that gained one', () => {
    const narrowed = baseline({ unit: { ...UNIT, properties: { ...UNIT.properties, kind: { type: 'string', enum: ['A', 'B'] } } } });
    const widenedResponse = baseline({ view: { type: 'object', required: ['id', 'code'], properties: { id: { type: 'string' }, code: { type: 'string' }, state: { type: 'string', enum: ['Active', 'Closed', 'Suspended'] } } } });
    expect(breakingChanges(baseline(), narrowed)).toEqual([expect.objectContaining({ kind: 'ENUM_TIGHTENED', side: 'request', location: 'kind', removed: ['"C"'] })]);
    // UnitView is the response of two operations, so both report the new value.
    const extended = breakingChanges(baseline(), widenedResponse);
    expect(extended.map((change) => [change.operation, change.kind, change.side, change.location, change.added])).toEqual([
      ['createUnit', 'ENUM_EXTENDED', 'response', 'state', ['"Suspended"']],
      ['getUnit', 'ENUM_EXTENDED', 'response', 'state', ['"Suspended"']],
    ]);
  });

  it('flags a new required request field, whether it is new or an existing optional field that became required', () => {
    const added = baseline({ unit: { ...UNIT, required: ['code', 'name', 'kind'] } });
    const brandNew = baseline({ unit: { ...UNIT, required: ['code', 'name', 'owner'], properties: { ...UNIT.properties, owner: { type: 'string' } } } });
    expect(breakingChanges(baseline(), added)).toEqual([expect.objectContaining({ kind: 'REQUIRED_FIELD_ADDED', side: 'request', location: 'kind' })]);
    expect(breakingChanges(baseline(), brandNew)).toEqual([expect.objectContaining({ kind: 'REQUIRED_FIELD_ADDED', side: 'request', location: 'owner' })]);
  });

  it('flags a removed parameter and a new required parameter', () => {
    const removed = baseline({ op: operation({ parameters: [] }) });
    const required = baseline({
      op: operation({
        parameters: [
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } },
        ],
      }),
    });
    const optional = baseline({
      op: operation({
        parameters: [
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'trace', in: 'query', required: false, schema: { type: 'string' } },
        ],
      }),
    });
    expect(breakingChanges(baseline(), removed)).toEqual([expect.objectContaining({ kind: 'PARAMETER_REMOVED', location: 'header:Idempotency-Key' })]);
    expect(breakingChanges(baseline(), required)).toEqual([expect.objectContaining({ kind: 'REQUIRED_PARAMETER_ADDED', location: 'header:If-Match' })]);
    expect(breakingChanges(baseline(), optional)).toEqual([]);
  });

  it('flags a removed success response and an operation whose request body disappeared', () => {
    const noResponse = baseline({ op: operation({ responses: { '400': { description: 'bad' } } }) });
    expect(breakingChanges(baseline(), noResponse)).toEqual([expect.objectContaining({ kind: 'RESPONSE_REMOVED', operation: 'createUnit', location: '200' })]);
    const noBody = baseline({ op: operation({ requestBody: undefined }) });
    expect(kinds(breakingChanges(baseline(), noBody))).toEqual(['REQUEST_BODY_REMOVED']);
  });

  it('survives reference cycles', () => {
    const cyclic = (extra: Record<string, unknown>): OpenApiDocument =>
      documentWith(
        { '/nodes': { post: { operationId: 'createNode', 'x-permission': 'node.manage', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } }, responses: jsonResponse({ type: 'object' }) } } },
        { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' }, ...extra } } },
      );
    expect(breakingChanges(cyclic({}), cyclic({ label: { type: 'string' } }))).toEqual([]);
    expect(breakingChanges(cyclic({ label: { type: 'string' } }), cyclic({}))).toEqual([expect.objectContaining({ kind: 'FIELD_REMOVED', location: 'label' })]);
  });

  it('detects a doctored copy of the real document for every kind it can express', () => {
    const real = loadRealDocument();
    const doctored = JSON.parse(JSON.stringify(real)) as OpenApiDocument;
    const first = Object.entries(doctored.paths).find(([, item]) => Object.hasOwn(item, 'post'));
    expect(first).toBeDefined();
    const [path, item] = first as [string, Record<string, Record<string, unknown>>];
    const operationId = item.post?.operationId as string;
    item.post = { ...item.post, 'x-permission': 'doctored.permission' };
    expect(breakingChanges(real, doctored)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'PERMISSION_CHANGED', operation: operationId })]));
    delete doctored.paths[path];
    expect(breakingChanges(real, doctored)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'OPERATION_REMOVED', operation: operationId })]));
  });

  it('orders the report deterministically and describes each change in one line', () => {
    const current = baseline({ op: operation({ 'x-permission': 'org.unit.admin' }), unit: { ...UNIT, required: ['code', 'name', 'kind'] } });
    const first = breakingChanges(baseline(), current);
    const second = breakingChanges(baseline(), current);
    expect(first).toEqual(second);
    expect(first.map((change) => change.operation)).toEqual([...first.map((change) => change.operation)].sort());
    for (const change of first) expect(change.summary).not.toContain('\n');
  });
});
