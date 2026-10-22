import { lintOpenApi } from '../src/lint-openapi';
import { documentWith, jsonResponse, loadRealDocument } from './fixtures';

describe('lintOpenApi missing_x_permission', () => {
  const operation = { operationId: 'get_things', responses: jsonResponse({ type: 'object' }) };

  it('reports an operation without x-permission by operationId and passes once added', () => {
    const missing = documentWith({ '/things': { get: operation } });
    expect(lintOpenApi(missing)).toEqual([{ operationId: 'get_things', rule: 'missing_x_permission' }]);

    const fixed = documentWith({ '/things': { get: { ...operation, 'x-permission': 'thing.read' } } });
    expect(lintOpenApi(fixed)).toEqual([]);
  });

  it('treats an empty or non-string x-permission as missing', () => {
    const doc = documentWith({
      '/a': { get: { ...operation, operationId: 'a', 'x-permission': '' } },
      '/b': { get: { ...operation, operationId: 'b', 'x-permission': 7 } },
      '/c': { get: { ...operation, operationId: 'c', 'x-permission': 'c.read' } },
    });
    expect(lintOpenApi(doc).map((finding) => finding.operationId)).toEqual(['a', 'b']);
  });

  it('names an operation without operationId by method and path', () => {
    const doc = documentWith({ '/x': { post: { responses: jsonResponse({}) } } });
    expect(lintOpenApi(doc)).toEqual([{ operationId: 'POST /x', rule: 'missing_x_permission' }]);
  });

  it('ignores path-level keys that are not HTTP methods', () => {
    const doc = documentWith({ '/x': { parameters: [], summary: 'shared', get: { ...operation, 'x-permission': 'x.read' } } });
    expect(lintOpenApi(doc)).toEqual([]);
  });
});

describe('lintOpenApi dto_exposes_secret', () => {
  const dtoOperation = (schema: unknown, extra: Record<string, unknown> = {}) => ({
    operationId: 'get_widget',
    'x-permission': 'widget.read',
    'x-exposure': 'dto',
    responses: jsonResponse(schema),
    ...extra,
  });

  it.each(['push_secret_ref', 'token_fingerprint'])('reports a dto response schema exposing %s', (secret) => {
    const doc = documentWith(
      { '/widgets/{id}': { get: dtoOperation({ $ref: '#/components/schemas/Widget' }) } },
      { Widget: { type: 'object', properties: { id: { type: 'string' }, [secret]: { type: 'string' } } } },
    );
    expect(lintOpenApi(doc)).toEqual([{ operationId: 'get_widget', rule: 'dto_exposes_secret' }]);
  });

  it('finds a secret nested through arrays, composition and referenced schemas', () => {
    const doc = documentWith(
      { '/widgets': { get: dtoOperation({ type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Page' } } } }) } },
      {
        Page: { allOf: [{ $ref: '#/components/schemas/Base' }] },
        Base: {
          oneOf: [
            {
              type: 'object',
              properties: { inner: { type: 'object', additionalProperties: { type: 'object', properties: { token_fingerprint: {} } } } },
            },
          ],
        },
      },
    );
    expect(lintOpenApi(doc)).toEqual([{ operationId: 'get_widget', rule: 'dto_exposes_secret' }]);
  });

  it('follows a referenced response object and terminates on cyclic schemas', () => {
    const doc = documentWith(
      { '/widgets': { get: dtoOperation(null, { responses: { '200': { $ref: '#/components/responses/WidgetOk' } } }) } },
      { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' }, push_secret_ref: {} } } },
    );
    doc.components = {
      ...doc.components,
      responses: { WidgetOk: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } },
    };
    expect(lintOpenApi(doc)).toEqual([{ operationId: 'get_widget', rule: 'dto_exposes_secret' }]);
  });

  it('terminates on a cycle that holds no secret', () => {
    const doc = documentWith(
      { '/widgets': { get: dtoOperation({ $ref: '#/components/schemas/Node' }) } },
      { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } },
    );
    expect(lintOpenApi(doc)).toEqual([]);
  });

  it('does not report secrets on operations that are not x-exposure dto', () => {
    const schema = { type: 'object', properties: { push_secret_ref: { type: 'string' } } };
    const doc = documentWith({
      '/a': { get: { ...dtoOperation(schema), operationId: 'a', 'x-exposure': 'internal' } },
      '/b': { get: { ...dtoOperation(schema), operationId: 'b', 'x-exposure': undefined } },
    });
    expect(lintOpenApi(doc)).toEqual([]);
  });

  it('does not report a secret name that only appears as an example, enum or description value', () => {
    const doc = documentWith({
      '/a': {
        get: dtoOperation({
          type: 'object',
          properties: { kind: { type: 'string', enum: ['push_secret_ref'], example: { push_secret_ref: 1 }, description: 'token_fingerprint' } },
        }),
      },
    });
    expect(lintOpenApi(doc)).toEqual([]);
  });

  it('does not treat a property literally named "properties" as a schema keyword', () => {
    const doc = documentWith({ '/a': { get: dtoOperation({ type: 'object', properties: { properties: { type: 'string' } } }) } });
    expect(lintOpenApi(doc)).toEqual([]);
  });

  it('ignores a dangling $ref', () => {
    const doc = documentWith({ '/a': { get: dtoOperation({ $ref: '#/components/schemas/Missing' }) } });
    expect(lintOpenApi(doc)).toEqual([]);
  });

  it('reports both rules for one operation, missing permission first', () => {
    const doc = documentWith({
      '/a': { get: { operationId: 'both', 'x-exposure': 'dto', responses: jsonResponse({ properties: { push_secret_ref: {} } }) } },
    });
    expect(lintOpenApi(doc)).toEqual([
      { operationId: 'both', rule: 'missing_x_permission' },
      { operationId: 'both', rule: 'dto_exposes_secret' },
    ]);
  });
});

describe('lintOpenApi on the design contract', () => {
  it('finds no violations in the 815 operation openapi.json', () => {
    expect(lintOpenApi(loadRealDocument())).toEqual([]);
  });
});
