import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OpenApiDocument } from '../src/openapi-document';

export const REPO_ROOT = resolve(__dirname, '..', '..', '..');
export const OPENAPI_PATH = resolve(REPO_ROOT, 'Design', 'MACHVON_Design', '03_Engineering', 'openapi.json');

export function loadRealDocument(): OpenApiDocument {
  return JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiDocument;
}

export function jsonResponse(schema: unknown): Record<string, unknown> {
  return { '200': { description: 'ok', content: { 'application/json': { schema } } } };
}

export function documentWith(paths: Record<string, unknown>, schemas: Record<string, unknown> = {}): OpenApiDocument {
  return { openapi: '3.1.0', info: { title: 'fixture', version: '1' }, paths, components: { schemas } } as OpenApiDocument;
}
