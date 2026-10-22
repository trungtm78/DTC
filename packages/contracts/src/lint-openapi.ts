import { listOperations } from './openapi-document.ts';
import type { OpenApiDocument } from './openapi-document.ts';

export type LintRule = 'missing_x_permission' | 'dto_exposes_secret';

export interface LintFinding {
  operationId: string;
  rule: LintRule;
}

// Property names that must never appear in a response DTO (ST-KERNEL-030).
const SECRET_PROPERTY_NAMES = new Set(['push_secret_ref', 'token_fingerprint']);
// Keywords whose values are data, not schemas: names found inside them are not properties.
const DATA_KEYWORDS = new Set(['example', 'examples', 'enum', 'default', 'const']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Resolves a local JSON pointer such as "#/components/schemas/A/properties/b" against the document.
function resolveRef(doc: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = doc;
  for (const token of ref.slice(2).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) current = current[Number(key)];
    else if (isRecord(current) && Object.hasOwn(current, key)) current = current[key];
    else return undefined;
  }
  return current;
}

// Depth-first walk through a schema or response object, following $ref once per target.
function exposesSecret(doc: OpenApiDocument, node: unknown, visited: Set<string>): boolean {
  if (Array.isArray(node)) return node.some((child) => exposesSecret(doc, child, visited));
  if (!isRecord(node)) return false;
  const ref = node['$ref'];
  if (typeof ref === 'string' && !visited.has(ref)) {
    visited.add(ref);
    if (exposesSecret(doc, resolveRef(doc, ref), visited)) return true;
  }
  // OpenAPI 3.1 allows keywords next to $ref, so the siblings are inspected too.
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' || DATA_KEYWORDS.has(key)) continue;
    if (key === 'properties' && isRecord(value)) {
      for (const [name, schema] of Object.entries(value)) {
        if (SECRET_PROPERTY_NAMES.has(name) || exposesSecret(doc, schema, visited)) return true;
      }
    } else if (exposesSecret(doc, value, visited)) {
      return true;
    }
  }
  return false;
}

export function lintOpenApi(doc: OpenApiDocument): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { id, operation } of listOperations(doc)) {
    const permission = operation['x-permission'];
    if (typeof permission !== 'string' || permission === '') {
      findings.push({ operationId: id, rule: 'missing_x_permission' });
    }
    if (operation['x-exposure'] === 'dto' && exposesSecret(doc, operation.responses, new Set())) {
      findings.push({ operationId: id, rule: 'dto_exposes_secret' });
    }
  }
  return findings;
}
