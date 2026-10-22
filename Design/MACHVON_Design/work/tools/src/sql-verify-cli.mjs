import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { verifySql } from './sql-verify.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_FILE = fileURLToPath(new URL('../../../03_Engineering/schema_reference.sql', import.meta.url));

export function formatVerification(result, messages, seconds) {
  const lines = [];
  if (result.counts) lines.push(translate(messages, 'sqlVerify.counts', result.counts));
  for (const problem of result.problems) lines.push(`  - ${translate(messages, problem.key, problem.params)}`);
  const key = result.ok ? 'sqlVerify.passed' : 'sqlVerify.failed';
  lines.push(translate(messages, key, { seconds, count: result.problems.length }));
  return lines;
}

export async function main(argv, log = console.log, verify = verifySql) {
  const { values } = parseArgs({
    args: argv,
    options: {
      file: { type: 'string', default: DEFAULT_FILE },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const sql = readFileSync(resolve(values.file), 'utf8');
  log(translate(messages, 'sqlVerify.start', { file: resolve(values.file) }));
  const started = Date.now();
  const result = await verify(sql);
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  for (const line of formatVerification(result, messages, seconds)) log(line);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
