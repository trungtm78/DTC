import { readFileSync } from 'node:fs';
import { breakingChanges } from './breaking-changes.ts';
import type { Change } from './breaking-changes.ts';
import type { OpenApiDocument } from './openapi-document.ts';

export interface CompatIo {
  log(line: string): void;
  readCurrent(): OpenApiDocument;
  /** The contract at the base reference, or undefined when that reference does not exist here. */
  readPrevious(baseRef: string): OpenApiDocument | undefined;
}

export interface CompatOptions {
  baseRef: string;
  /** JSON file `{ "allowed": [{ operation, kind, location?, reason, change_request }] }`. */
  allowFile: string | undefined;
}

export interface CompatResult {
  status: 'ok' | 'breaking' | 'skipped' | 'invalid';
  exitCode: 0 | 1 | 2;
}

interface AllowEntry {
  operation: string;
  kind: string;
  location?: string;
  reason: string;
  change_request: string;
}

function parseAllowFile(path: string): AllowEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const list = typeof parsed === 'object' && parsed !== null ? (parsed as { allowed?: unknown }).allowed : undefined;
  if (!Array.isArray(list)) throw new Error('the allow file must be {"allowed": [...]}');
  return list.map((entry, index) => {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    for (const field of ['operation', 'kind', 'reason', 'change_request']) {
      if (typeof item[field] !== 'string' || item[field] === '') throw new Error(`allow entry ${index + 1} needs a ${field}`);
    }
    if (item.location !== undefined && typeof item.location !== 'string') throw new Error(`allow entry ${index + 1} has a bad location`);
    return item as unknown as AllowEntry;
  });
}

function matches(entry: AllowEntry, change: Change): boolean {
  return entry.operation === change.operation && entry.kind === change.kind && (entry.location === undefined || entry.location === change.location);
}

/**
 * Compares the working-tree contract with the one at the base reference. Breaking changes fail the check unless an
 * allow entry names them with a reason and the change request that approved them. A missing base reference is reported
 * as SKIPPED, never as a pass.
 */
export function runCompat(options: CompatOptions, io: CompatIo): CompatResult {
  let allowed: AllowEntry[] = [];
  if (options.allowFile !== undefined) {
    try {
      allowed = parseAllowFile(options.allowFile);
    } catch (error) {
      io.log(`invalid allow file: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'invalid', exitCode: 2 };
    }
  }
  const previous = io.readPrevious(options.baseRef);
  if (previous === undefined) {
    io.log(`SKIPPED: base reference ${options.baseRef} does not exist here, so the contract was not compared`);
    return { status: 'skipped', exitCode: 0 };
  }
  const used = new Set<AllowEntry>();
  const open: Change[] = [];
  for (const change of breakingChanges(previous, io.readCurrent())) {
    const entry = allowed.find((candidate) => matches(candidate, change));
    if (entry === undefined) {
      open.push(change);
      continue;
    }
    used.add(entry);
    io.log(`accepted by ${entry.change_request}: ${change.kind} ${change.operation} ${change.summary} (${entry.reason})`);
  }
  for (const entry of allowed) {
    if (!used.has(entry)) io.log(`unused allow entry: ${entry.operation} ${entry.kind}${entry.location === undefined ? '' : ` ${entry.location}`}`);
  }
  if (open.length === 0) {
    io.log(`the contract is compatible with ${options.baseRef}`);
    return { status: 'ok', exitCode: 0 };
  }
  for (const change of open) io.log(`${change.kind} ${change.operation}: ${change.summary}`);
  io.log(`${open.length} breaking change${open.length === 1 ? '' : 's'} against ${options.baseRef}; list them in the allow file with a change request or revert them`);
  return { status: 'breaking', exitCode: 1 };
}
