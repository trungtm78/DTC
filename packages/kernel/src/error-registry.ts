import { readFileSync } from 'node:fs';

export interface RegisteredError {
  status: number;
  title: string;
}

const DEFAULT_CANONICAL_STATUS = 400;
const STATUS_IN_TEXT = /\((\d{3})\)/;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`error registry: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asStatus(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error(`error registry: ${code} has no valid HTTP status`);
  }
  return value;
}

function canonicalEntry(code: string, text: unknown): RegisteredError {
  if (typeof text !== 'string') throw new Error(`error registry: canonical ${code} must be text`);
  const match = STATUS_IN_TEXT.exec(text);
  return { status: match?.[1] === undefined ? DEFAULT_CANONICAL_STATUS : Number(match[1]), title: text };
}

function registryEntry(code: string, entry: unknown): RegisteredError {
  const record = asRecord(entry, `registry ${code}`);
  if (typeof record.title !== 'string') throw new Error(`error registry: ${code} has no title`);
  return { status: asStatus(record.status, code), title: record.title };
}

/**
 * Loads Design/MACHVON_Design/03_Engineering/error_codes.json into one code -> {status,title} map.
 * `canonical` entries take their status from the first "(NNN)" in the text (else 400); `registry`
 * entries carry their own status and win when a code appears in both sections.
 */
export function loadErrorRegistry(path: string): Map<string, RegisteredError> {
  const root = asRecord(JSON.parse(readFileSync(path, 'utf8')), 'the file');
  const result = new Map<string, RegisteredError>();
  if (root.canonical !== undefined) {
    for (const [code, text] of Object.entries(asRecord(root.canonical, 'canonical'))) result.set(code, canonicalEntry(code, text));
  }
  if (root.registry !== undefined) {
    for (const [code, entry] of Object.entries(asRecord(root.registry, 'registry'))) result.set(code, registryEntry(code, entry));
  }
  return result;
}
