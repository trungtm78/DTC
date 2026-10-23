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

  describe('constraints that appear, disappear or weaken', () => {
    const view = (extra: Record<string, unknown>): Record<string, unknown> => ({ type: 'object', required: ['id', 'code'], properties: { id: { type: 'string' }, code: { type: 'string' }, ...extra } });

    it('treats an absent request enum as unrestricted: adding one is a tightening', () => {
      const current = baseline({ unit: { ...UNIT, properties: { ...UNIT.properties, name: { type: 'string', enum: ['only'] } } } });
      expect(breakingChanges(baseline(), current)).toEqual([expect.objectContaining({ kind: 'ENUM_TIGHTENED', side: 'request', location: 'name', after: '"only"' })]);
    });

    it('treats a removed response enum as an extension: any value can come back now', () => {
      const current = baseline({ view: view({ state: { type: 'string' } }) });
      const changes = breakingChanges(baseline(), current);
      expect(changes.map((change) => [change.operation, change.kind, change.side, change.location])).toEqual([
        ['createUnit', 'ENUM_EXTENDED', 'response', 'state'],
        ['getUnit', 'ENUM_EXTENDED', 'response', 'state'],
      ]);
    });

    it('does not flag the loosening direction of those two', () => {
      const unrestricted = baseline({ unit: { ...UNIT, properties: { ...UNIT.properties, kind: { type: 'string' } } } });
      expect(breakingChanges(baseline(), unrestricted)).toEqual([]);
      const restricted = baseline({ view: view({ state: { type: 'string', enum: ['Active'] } }) });
      expect(breakingChanges(baseline({ view: view({ state: { type: 'string' } }) }), restricted)).toEqual([]);
    });

    it('flags a response field that stops being required while it stays declared', () => {
      const current = baseline({ view: { ...view({ state: { type: 'string', enum: ['Active', 'Closed'] } }), required: ['code'] } });
      const changes = breakingChanges(baseline(), current);
      expect(changes.map((change) => [change.operation, change.kind, change.side, change.location])).toEqual([
        ['createUnit', 'RESPONSE_FIELD_OPTIONAL', 'response', 'id'],
        ['getUnit', 'RESPONSE_FIELD_OPTIONAL', 'response', 'id'],
      ]);
    });

    it('does not flag a response field that is still required through an allOf member', () => {
      const previous = baseline({ view: view({}) });
      const current = baseline({ view: { type: 'object', required: ['code'], properties: { id: { type: 'string' }, code: { type: 'string' } }, allOf: [{ required: ['id'] }] } });
      expect(breakingChanges(previous, current)).toEqual([]);
    });

    it('flags a request body that becomes required, also when the operation had no body before', () => {
      const optionalBody = operation({ requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/UnitCreate' } } } } });
      const omittedFlag = operation({ requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UnitCreate' } } } } });
      expect(breakingChanges(baseline({ op: optionalBody }), baseline())).toEqual([expect.objectContaining({ kind: 'REQUEST_BODY_REQUIRED', operation: 'createUnit', side: 'request' })]);
      expect(breakingChanges(baseline({ op: omittedFlag }), baseline())).toEqual([expect.objectContaining({ kind: 'REQUEST_BODY_REQUIRED' })]);
      expect(breakingChanges(baseline({ op: operation({ requestBody: undefined }) }), baseline())).toEqual([expect.objectContaining({ kind: 'REQUEST_BODY_REQUIRED' })]);
      // An optional body that stays optional, or a body that was already required, is not a break.
      expect(breakingChanges(baseline({ op: optionalBody }), baseline({ op: optionalBody }))).toEqual([]);
      expect(breakingChanges(baseline({ op: operation({ requestBody: undefined }) }), baseline({ op: optionalBody }))).toEqual([]);
    });

    it('merges the parameters of the path item into every operation, operation level wins', () => {
      const pathLevel = (parameters: unknown[], opParameters: unknown[] = []): OpenApiDocument =>
        baseline({ extraPaths: { '/a': { parameters, get: { operationId: 'getA', 'x-permission': 'a.read', parameters: opParameters, responses: jsonResponse({ type: 'object' }) } } } });
      const trace = { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } };
      const optionalTrace = { ...trace, required: false };
      expect(breakingChanges(pathLevel([]), pathLevel([trace]))).toEqual([expect.objectContaining({ kind: 'REQUIRED_PARAMETER_ADDED', operation: 'getA', location: 'header:X-Trace' })]);
      expect(breakingChanges(pathLevel([trace]), pathLevel([]))).toEqual([expect.objectContaining({ kind: 'PARAMETER_REMOVED', operation: 'getA', location: 'header:X-Trace' })]);
      expect(breakingChanges(pathLevel([optionalTrace]), pathLevel([trace]))).toEqual([expect.objectContaining({ kind: 'REQUIRED_PARAMETER_ADDED', location: 'header:X-Trace' })]);
      // Moving the parameter from the path item to the operation changes nothing for a caller.
      expect(breakingChanges(pathLevel([trace]), pathLevel([], [trace]))).toEqual([]);
      // An operation-level declaration overrides the path-level one.
      expect(breakingChanges(pathLevel([trace], [optionalTrace]), pathLevel([trace], [optionalTrace]))).toEqual([]);
      expect(breakingChanges(pathLevel([trace], [optionalTrace]), pathLevel([trace], [trace]))).toEqual([expect.objectContaining({ kind: 'REQUIRED_PARAMETER_ADDED' })]);
    });
  });

  describe('oneOf, anyOf and allOf alternatives', () => {
    const FIRST = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    const SECOND = { type: 'object', required: ['sourceVersion', 'reason'], properties: { sourceVersion: { type: 'integer' }, reason: { type: 'string' } } };
    const THIRD = { type: 'object', required: ['other'], properties: { other: { type: 'string' } } };
    const bodyDocument = (keyword: string, members: unknown[], side: 'request' | 'response'): OpenApiDocument =>
      documentWith(
        {
          '/things': {
            post: {
              operationId: 'saveThing',
              'x-permission': 'thing.manage',
              ...(side === 'request'
                ? { requestBody: { required: true, content: { 'application/json': { schema: { [keyword]: members } } } }, responses: jsonResponse({ type: 'object' }) }
                : { responses: jsonResponse({ [keyword]: members }) }),
            },
          },
        },
        {},
      );

    it('flags a request alternative that was removed, wherever it stood', () => {
      expect(breakingChanges(bodyDocument('oneOf', [FIRST, SECOND], 'request'), bodyDocument('oneOf', [FIRST], 'request'))).toEqual([
        expect.objectContaining({ kind: 'ALTERNATIVE_REMOVED', side: 'request', operation: 'saveThing' }),
      ]);
      expect(breakingChanges(bodyDocument('anyOf', [FIRST, SECOND], 'request'), bodyDocument('anyOf', [SECOND], 'request'))).toEqual([
        expect.objectContaining({ kind: 'ALTERNATIVE_REMOVED', side: 'request' }),
      ]);
    });

    it('accepts an added request alternative, in any position, and a reordering', () => {
      expect(breakingChanges(bodyDocument('oneOf', [FIRST], 'request'), bodyDocument('oneOf', [FIRST, SECOND], 'request'))).toEqual([]);
      expect(breakingChanges(bodyDocument('oneOf', [FIRST], 'request'), bodyDocument('oneOf', [THIRD, FIRST], 'request'))).toEqual([]);
      expect(breakingChanges(bodyDocument('oneOf', [FIRST, SECOND], 'request'), bodyDocument('oneOf', [SECOND, FIRST], 'request'))).toEqual([]);
    });

    it('flags a response alternative that was added and accepts a removed one', () => {
      expect(breakingChanges(bodyDocument('oneOf', [FIRST], 'response'), bodyDocument('oneOf', [FIRST, SECOND], 'response'))).toEqual([
        expect.objectContaining({ kind: 'ALTERNATIVE_ADDED', side: 'response' }),
      ]);
      expect(breakingChanges(bodyDocument('oneOf', [FIRST, SECOND], 'response'), bodyDocument('oneOf', [FIRST], 'response'))).toEqual([]);
    });

    it('still reports the detail inside an alternative that changed in place', () => {
      const retyped = { ...SECOND, properties: { ...SECOND.properties, sourceVersion: { type: 'string' } } };
      expect(breakingChanges(bodyDocument('oneOf', [FIRST, SECOND], 'request'), bodyDocument('oneOf', [FIRST, retyped], 'request'))).toEqual([
        expect.objectContaining({ kind: 'FIELD_RETYPED', side: 'request', location: 'sourceVersion' }),
      ]);
    });

    it('pairs alternatives by reference name before looking at their position', () => {
      const documentOf = (members: unknown[], schemas: Record<string, unknown>): OpenApiDocument =>
        documentWith(
          { '/things': { post: { operationId: 'saveThing', 'x-permission': 'thing.manage', requestBody: { required: true, content: { 'application/json': { schema: { oneOf: members } } } }, responses: jsonResponse({ type: 'object' }) } } },
          schemas,
        );
      const previous = documentOf([{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }], { A: FIRST, B: SECOND });
      const reordered = documentOf([{ $ref: '#/components/schemas/B' }, { $ref: '#/components/schemas/A' }], { A: FIRST, B: SECOND });
      const retypedB = documentOf([{ $ref: '#/components/schemas/B' }, { $ref: '#/components/schemas/A' }], { A: FIRST, B: { ...SECOND, properties: { ...SECOND.properties, reason: { type: 'integer' } } } });
      expect(breakingChanges(previous, reordered)).toEqual([]);
      expect(breakingChanges(previous, retypedB)).toEqual([expect.objectContaining({ kind: 'FIELD_RETYPED', location: 'reason' })]);
    });

    it('flags an allOf whose member list changed, in the direction that hurts', () => {
      expect(breakingChanges(bodyDocument('allOf', [FIRST], 'request'), bodyDocument('allOf', [FIRST, THIRD], 'request'))).toEqual([
        expect.objectContaining({ kind: 'COMPOSITION_CHANGED', side: 'request' }),
      ]);
      expect(breakingChanges(bodyDocument('allOf', [FIRST, THIRD], 'response'), bodyDocument('allOf', [FIRST], 'response'))).toEqual([
        expect.objectContaining({ kind: 'COMPOSITION_CHANGED', side: 'response' }),
      ]);
      expect(breakingChanges(bodyDocument('allOf', [FIRST, THIRD], 'request'), bodyDocument('allOf', [FIRST], 'request'))).toEqual([]);
      expect(breakingChanges(bodyDocument('allOf', [FIRST], 'response'), bodyDocument('allOf', [FIRST, THIRD], 'response'))).toEqual([]);
    });
  });

  it('catches the real TenantThemeReviewRequest losing an alternative', () => {
    const real = loadRealDocument();
    const schemas = real.components?.schemas as Record<string, { oneOf?: unknown[] }>;
    expect(schemas.TenantThemeReviewRequest?.oneOf?.length).toBeGreaterThan(1);
    const doctored = JSON.parse(JSON.stringify(real)) as OpenApiDocument;
    const target = (doctored.components?.schemas as Record<string, { oneOf?: unknown[] }>).TenantThemeReviewRequest as { oneOf: unknown[] };
    target.oneOf = target.oneOf.slice(0, 1);
    expect(breakingChanges(real, doctored)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ALTERNATIVE_REMOVED', side: 'request' })]));
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
