import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { DEFAULT_LOCALE, loadMessages } from './i18n.mjs';
import { defaultRun, resolveBase, runVerification } from './verify.mjs';
import { formatReport } from './report.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL('../config.json', import.meta.url));

export function main(argv, { log = console.log, run = defaultRun, env = process.env } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      codex: { type: 'boolean', default: false },
      ship: { type: 'boolean', default: false },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      root: { type: 'string', default: REPO_ROOT },
    },
  });
  const root = resolve(values.root);
  const config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {};
  const base = resolveBase({ explicit: values.base, githubBaseRef: env.GITHUB_BASE_REF, run });
  const result = runVerification({ root, base, run, config, options: { codex: values.codex, ship: values.ship } });
  log(formatReport(result.stages, loadMessages(values.locale), { failed: result.failed }));
  return result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
