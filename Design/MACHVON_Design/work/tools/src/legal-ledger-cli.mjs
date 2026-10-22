import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { buildLedger, checkLedgerMarkers, extractMarkers } from './legal-ledger.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_SPECS_DIR = fileURLToPath(new URL('../../../01_Documents/05_modules', import.meta.url));
const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));
const REGISTER_FILE = 'legal_confirmation_register.json';
const LEDGER_FILE = 'legal_confirmation_ledger.json';
const SPEC_FILE = /^[A-Z]+\.md$/;

function readMarkers(specsDir, extraFiles) {
  const modules = readdirSync(specsDir).filter((name) => SPEC_FILE.test(name)).map((name) => join(specsDir, name));
  return [...modules, ...extraFiles.filter(existsSync)].flatMap((path) =>
    extractMarkers(readFileSync(path, 'utf8'), path.split(/[\\/]/).at(-1)),
  );
}

export function ledgerMain(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      specs: { type: 'string', default: DEFAULT_SPECS_DIR },
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const engineeringDir = resolve(values.dir);
  const basicDesign = join(resolve(values.specs), '..', '04_Thiet_ke_co_ban.md');
  const markers = readMarkers(resolve(values.specs), [basicDesign]);
  const registerPath = join(engineeringDir, REGISTER_FILE);
  const register = existsSync(registerPath) ? JSON.parse(readFileSync(registerPath, 'utf8')) : {};
  const ledger = buildLedger(markers, register);
  writeFileSync(join(engineeringDir, LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');

  const findings = checkLedgerMarkers(markers);
  for (const item of findings) log(translate(messages, item.messageKey, item.params));
  const open = ledger.filter((row) => row.status !== 'CONFIRMED').length;
  log(translate(messages, 'ledger.summary', { total: ledger.length, open }));
  return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = ledgerMain(process.argv.slice(2));
}
