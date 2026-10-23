import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from '../src/cli.ts';
import { CSS_OUTPUT_PATH, DESIGN_TOKENS_PATH, TS_OUTPUT_PATH } from '../src/generate.ts';
import { REPO_ROOT } from './support.ts';

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'machvon-tokens-'));
  const source = join(root, DESIGN_TOKENS_PATH);
  mkdirSync(dirname(source), { recursive: true });
  copyFileSync(join(REPO_ROOT, DESIGN_TOKENS_PATH), source);
  return root;
}

function capture(): { lines: string[]; io: { log: (line: string) => void } } {
  const lines: string[] = [];
  return { lines, io: { log: (line) => lines.push(line) } };
}

describe('tokens cli', () => {
  it('generate writes both files with LF line endings, check then passes', () => {
    const root = scratchRoot();
    const out = capture();
    expect(main(['generate', '--root', root], out.io)).toBe(0);
    expect(out.lines.join('\n')).toContain(CSS_OUTPUT_PATH);
    expect(readFileSync(join(root, CSS_OUTPUT_PATH), 'utf8')).not.toContain('\r');
    expect(readFileSync(join(root, TS_OUTPUT_PATH), 'utf8')).toContain('export const TOKENS: Tokens');
    expect(main(['check', '--root', root], capture().io)).toBe(0);
  });

  it('check fails and names the file when a generated file is edited by hand or missing', () => {
    const root = scratchRoot();
    main(['generate', '--root', root], capture().io);
    writeFileSync(join(root, CSS_OUTPUT_PATH), `${readFileSync(join(root, CSS_OUTPUT_PATH), 'utf8')}/* hand edit */\n`);
    const edited = capture();
    expect(main(['check', '--root', root], edited.io)).toBe(1);
    expect(edited.lines.join('\n')).toContain(CSS_OUTPUT_PATH);

    const missing = scratchRoot();
    const absent = capture();
    expect(main(['check', '--root', missing], absent.io)).toBe(1);
    expect(absent.lines.join('\n')).toContain(TS_OUTPUT_PATH);
  });

  it('check ignores CRLF line endings that Git may add on checkout', () => {
    const root = scratchRoot();
    main(['generate', '--root', root], capture().io);
    for (const file of [CSS_OUTPUT_PATH, TS_OUTPUT_PATH]) {
      writeFileSync(join(root, file), readFileSync(join(root, file), 'utf8').replace(/\n/g, '\r\n'));
    }
    expect(main(['check', '--root', root], capture().io)).toBe(0);
  });

  it('prints usage and exits 2 for an unknown command', () => {
    const out = capture();
    expect(main(['bogus'], out.io)).toBe(2);
    expect(out.lines.join('\n')).toContain('Usage');
  });

  it('the committed generated files in the repository are current', () => {
    expect(main(['check', '--root', REPO_ROOT], capture().io)).toBe(0);
  });
});
