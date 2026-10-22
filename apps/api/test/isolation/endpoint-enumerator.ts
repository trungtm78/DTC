import { listOperations } from '@machvon/contracts';
import type { OpenApiDocument } from '@machvon/contracts';

const PATH_PARAMETER = /\{[^{}/]+\}/;
const PATH_PARAMETERS = /\{[^{}/]+\}/g;

/**
 * Returns the sorted operationIds of the implemented operations whose path has a path parameter.
 * Each of them needs a foreign-id case in the isolation suite. An implemented operation that the
 * document does not define is a defect and throws.
 */
export function enumerateIdBearingOperations(doc: OpenApiDocument, implemented: ReadonlySet<string>): string[] {
  const entries = listOperations(doc);
  const known = new Set(entries.map((entry) => entry.id));
  for (const id of implemented) {
    if (!known.has(id)) throw new Error(`Implemented operation ${id} is not defined in the OpenAPI document`);
  }
  return entries
    .filter((entry) => implemented.has(entry.id) && PATH_PARAMETER.test(entry.path))
    .map((entry) => entry.id)
    .sort();
}

/** The path template of an operation, for example `/resources/organization_unit/{id}`. */
export function operationPath(doc: OpenApiDocument, operationId: string): string {
  const entry = listOperations(doc).find((candidate) => candidate.id === operationId);
  if (entry === undefined) throw new Error(`Operation ${operationId} is not defined in the OpenAPI document`);
  return entry.path;
}

/** Fills the single path parameter of a template with an id. */
export function fillPath(template: string, id: string): string {
  return template.replace(PATH_PARAMETERS, encodeURIComponent(id));
}
