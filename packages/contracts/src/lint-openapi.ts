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
const REF_PREFIX = '#/components/';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRef(doc: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith(REF_PREFIX)) return undefined;
  const [section, name] = ref.slice(REF_PREFIX.length).split('/');
  if (section === undefined || name === undefined) return undefined;
  const bucket = doc.components?.[section];
  return isRecord(bucket) ? bucket[name] : undefined;
}

// Depth-first walk through a schema or response object, following $ref once per target.
function exposesSecret(doc: OpenApiDocument, node: unknown, visited: Set<string>): boolean {
  if (Array.isArray(node)) return node.some((child) => exposesSecret(doc, child, visited));
  if (!isRecord(node)) return false;
  const ref = node['$ref'];
  if (typeof ref === 'string') {
    if (visited.has(ref)) return false;
    visited.add(ref);
    return exposesSecret(doc, resolveRef(doc, ref), visited);
  }
  for (const [key, value] of Object.entries(node)) {
    if (DATA_KEYWORDS.has(key)) continue;
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
