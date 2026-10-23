import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompat } from '../src/compat';
import type { CompatIo } from '../src/compat';
import type { OpenApiDocument } from '../src/openapi-document';
import { documentWith, jsonResponse } from './fixtures';

function doc(permission = 'a.read', extraOperation = false): OpenApiDocument {
  const paths: Record<string, unknown> = { '/a': { get: { operationId: 'getA', 'x-permission': permission, responses: jsonResponse({ type: 'object' }) } } };
  if (extraOperation) paths['/b'] = { get: { operationId: 'getB', 'x-permission': 'b.read', responses: jsonResponse({ type: 'object' }) } };
  return documentWith(paths);
}

function scratch(files: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'machvon-compat-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), JSON.stringify(content));
  return directory;
}

function io(previous: OpenApiDocument | undefined, current: OpenApiDocument): { io: CompatIo; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    io: {
      log: (line) => lines.push(line),
      readCurrent: () => current,
      readPrevious: () => previous,
    },
  };
}

describe('runCompat', () => {
  it('passes when only additive changes were made', () => {
    const { io: sink, lines } = io(doc(), doc('a.read', true));
    expect(runCompat({ baseRef: 'origin/main', allowFile: undefined }, sink)).toEqual({ status: 'ok', exitCode: 0 });
    expect(lines.join('\n')).toContain('compatible');
  });

  it('fails and prints one line per breaking change', () => {
    const { io: sink, lines } = io(doc(), doc('a.admin'));
    const result = runCompat({ baseRef: 'origin/main', allowFile: undefined }, sink);
    expect(result).toEqual({ status: 'breaking', exitCode: 1 });
    expect(lines.some((line) => line.includes('PERMISSION_CHANGED') && line.includes('getA'))).toBe(true);
    expect(lines.at(-1)).toContain('1 breaking change');
  });

  it('reports skipped, never passed, when the base reference is missing', () => {
    const { io: sink, lines } = io(undefined, doc());
    expect(runCompat({ baseRef: 'origin/main', allowFile: undefined }, sink)).toEqual({ status: 'skipped', exitCode: 0 });
    expect(lines.join('\n')).toContain('SKIPPED');
    expect(lines.join('\n')).toContain('origin/main');
  });

  it('accepts a listed change with a reason and a change request, and warns about entries nothing needs', () => {
    const directory = scratch({
      'allow.json': {
        allowed: [
          { operation: 'getA', kind: 'PERMISSION_CHANGED', reason: 'moved to a stricter permission', change_request: 'CR-TEST-01' },
          { operation: 'getZ', kind: 'OPERATION_REMOVED', reason: 'old', change_request: 'CR-TEST-00' },
        ],
      },
    });
    const { io: sink, lines } = io(doc(), doc('a.admin'));
    expect(runCompat({ baseRef: 'origin/main', allowFile: join(directory, 'allow.json') }, sink)).toEqual({ status: 'ok', exitCode: 0 });
    const text = lines.join('\n');
    expect(text).toContain('accepted by CR-TEST-01');
    expect(text).toContain('unused allow entry: getZ OPERATION_REMOVED');
  });

  it('refuses an allow entry without a reason or a change request', () => {
    const directory = scratch({ 'allow.json': { allowed: [{ operation: 'getA', kind: 'PERMISSION_CHANGED' }] } });
    const { io: sink, lines } = io(doc(), doc('a.admin'));
    expect(runCompat({ baseRef: 'origin/main', allowFile: join(directory, 'allow.json') }, sink)).toEqual({ status: 'invalid', exitCode: 2 });
    expect(lines.join('\n')).toContain('reason');
  });

  it('refuses an allow file that is not {"allowed": []}', () => {
    const directory = scratch({ 'allow.json': { allowed: 3 } });
    const { io: sink } = io(doc(), doc());
    expect(runCompat({ baseRef: 'origin/main', allowFile: join(directory, 'allow.json') }, sink)).toEqual({ status: 'invalid', exitCode: 2 });
  });
});
