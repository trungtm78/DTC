import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { linkBacklog } from './plan-link.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));

export function linkMain(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: { dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR }, locale: { type: 'string', default: DEFAULT_LOCALE } },
  });
  const messages = loadMessages(values.locale);
  const dir = resolve(values.dir);
  const backlogPath = join(dir, 'implementation_backlog.json');
  const backlog = JSON.parse(readFileSync(backlogPath, 'utf8'));
  const plan = JSON.parse(readFileSync(join(dir, 'implementation_plan.json'), 'utf8'));
  const { rows, unplanned } = linkBacklog(backlog, plan.stories);
  writeFileSync(backlogPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  for (const id of unplanned) log(translate(messages, 'link.unplanned', { id }));
  log(translate(messages, 'link.summary', { total: rows.length, unplanned: unplanned.length }));
  return unplanned.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = linkMain(process.argv.slice(2));
}
