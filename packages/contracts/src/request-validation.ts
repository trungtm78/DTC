import { REQUEST_BODIES, REQUEST_SCHEMAS } from './request-schemas.generated.ts';
import { validateValue } from './validation.ts';
import type { Issue, Schema } from './validation.ts';

/** The request body schema of an operation, or undefined when it has no JSON body. */
export function requestSchemaOf(operationId: string): Schema | undefined {
  const key = Object.hasOwn(REQUEST_BODIES, operationId) ? REQUEST_BODIES[operationId] : undefined;
  return key === undefined ? undefined : REQUEST_SCHEMAS[key];
}

/**
 * Validates a request body against the schema of its operation in openapi.json. Returns undefined when the
 * operation declares no JSON body, otherwise the list of issues (empty when the body is valid).
 */
export function validateRequestBody(operationId: string, body: unknown): Issue[] | undefined {
  const schema = requestSchemaOf(operationId);
  return schema === undefined ? undefined : validateValue(schema, body, REQUEST_SCHEMAS);
}
