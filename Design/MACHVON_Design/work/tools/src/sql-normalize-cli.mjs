import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { foreignKeyStatements, normalizeForeignKeys } from './merge.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

// Applies the managed-section normalisation (foreign keys last) to the reference schema through the
// same function the merge uses, so the file is never edited by hand.
const DEFAULT_FILE = fileURLToPath(new URL('../../../03_Engineering/schema_reference.sql', import.meta.url));

export function main(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      file: { type: 'string', default: DEFAULT_FILE },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const path = resolve(values.file);
  const normalized = normalizeForeignKeys(readFileSync(path, 'utf8'));
  writeFileSync(path, normalized, 'utf8');
  log(translate(loadMessages(values.locale), 'sqlNormalize.done', { moved: foreignKeyStatements(normalized).length, file: path }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
