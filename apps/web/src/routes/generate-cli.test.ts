import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './generate-cli.ts';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENGINEERING = join('Design', 'MACHVON_Design', '03_Engineering');
const OUTPUT = join('apps', 'web', 'src', 'routes', 'routes.generated.json');
const scratch: string[] = [];

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'machvon-routes-'));
  scratch.push(root);
  mkdirSync(join(root, ENGINEERING), { recursive: true });
  for (const file of ['navigation_architecture.json', 'screen_catalog.json']) {
    cpSync(join(REPO_ROOT, ENGINEERING, file), join(root, ENGINEERING, file));
  }
  return root;
}

// A Windows checkout (text=auto) turns the committed table into CRLF; what matters is the text, not the line endings.
const lf = (text: string): string => text.replace(/\r\n/g, '\n');

function capture() {
  const lines: string[] = [];
  return { lines, io: { log: (line: string) => void lines.push(line) } };
}

afterEach(() => {
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('routes:generate and routes:check', () => {
  it('writes the table, then reports it up to date', async () => {
    const root = scratchRoot();
    const written = capture();
    expect(await main(['generate', '--root', root], written.io)).toBe(0);
    expect(written.lines[0]).toContain('routes.generated.json');
    expect(lf(readFileSync(join(root, OUTPUT), 'utf8'))).toBe(lf(readFileSync(join(REPO_ROOT, OUTPUT), 'utf8')));
    expect(await main(['check', '--root', root], capture().io)).toBe(0);
  });

  it('accepts a table with CRLF line endings, as a Windows checkout writes it', async () => {
    const root = scratchRoot();
    await main(['generate', '--root', root], capture().io);
    const path = join(root, OUTPUT);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
    expect(await main(['check', '--root', root], capture().io)).toBe(0);
  });

  it('exits 1 and says how to fix it when the committed file was edited by hand', async () => {
    const root = scratchRoot();
    await main(['generate', '--root', root], capture().io);
    const path = join(root, OUTPUT);
    writeFileSync(path, readFileSync(path, 'utf8').replace('Tổng quan điều hành', 'Hand edited'));
    const failed = capture();
    expect(await main(['check', '--root', root], failed.io)).toBe(1);
    expect(failed.lines.join('\n')).toContain('routes:generate');
  });

  it('exits 1 when the table was never generated', async () => {
    expect(await main(['check', '--root', scratchRoot()], capture().io)).toBe(1);
  });

  it('exits 1 with the reason when the design files are inconsistent', async () => {
    const root = scratchRoot();
    const catalogue = join(root, ENGINEERING, 'screen_catalog.json');
    writeFileSync(catalogue, JSON.stringify([{ id: 'HOME-01' }]));
    const failed = capture();
    expect(await main(['generate', '--root', root], failed.io)).toBe(1);
    expect(failed.lines.join('\n')).toContain('is not in the screen catalogue');
  });

  it('exits 1 when a design file cannot be read at all', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'machvon-routes-empty-'));
    scratch.push(empty);
    expect(await main(['generate', '--root', empty], capture().io)).toBe(1);
  });

  it('exits 2 with the usage for an unknown command', async () => {
    const usage = capture();
    expect(await main(['bogus'], usage.io)).toBe(2);
    expect(usage.lines[0]).toContain('Usage');
  });

  it('succeeds through the launcher script on the real repository', () => {
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join('scripts', 'generate-routes.mjs'), 'check'], {
      cwd: join(REPO_ROOT, 'apps', 'web'),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
  });
});
