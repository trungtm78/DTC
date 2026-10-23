import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_REPORT = join(REPO_ROOT, 'apps', 'web', 'e2e', 'report.json');
const DEFAULT_LOCALE = 'vi';

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/**
 * Reduces the browser report written by apps/web/e2e to the numbers a person (and PROGRESS.md) needs: how many routes
 * and pages were walked, which pages are broken and why, and how the visual cases stand.
 */
export function summarise(report) {
  const walk =
    report.routeWalk === undefined
      ? undefined
      : {
          stale: report.routeWalk.stale === true,
          routes: report.routeWalk.routes,
          pages: report.routeWalk.entries.length,
          broken: report.routeWalk.entries
            .filter((entry) => entry.problems.length > 0)
            .map((entry) => ({ id: entry.id, viewport: entry.viewport, problems: entry.problems })),
        };
  const visual =
    report.visual === undefined
      ? undefined
      : {
          pass: report.visual.filter((entry) => entry.status === 'pass').length,
          fail: report.visual.filter((entry) => entry.status === 'fail').map((entry) => entry.id),
          pending: report.visual.filter((entry) => entry.status === 'pending').map((entry) => entry.id),
          stale: report.visual.filter((entry) => entry.status === 'stale').map((entry) => entry.id),
        };
  return { walk, visual };
}

export function main(argv, { log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      report: { type: 'string', default: DEFAULT_REPORT },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      'require-visual': { type: 'boolean', default: false },
      'require-walk': { type: 'boolean', default: false },
    },
  });
  const messages = loadMessages(values.locale);
  const path = resolve(values.report);
  if (!existsSync(path)) {
    log(format(messages['e2e.report.missing'], { path }));
    return 2;
  }
  const { walk, visual } = summarise(JSON.parse(readFileSync(path, 'utf8')));
  let failures = 0;
  if (walk !== undefined && walk.stale) {
    // Written by an earlier run: it is shown, never counted, and only a demanded walk turns it into a failure.
    log(format(messages['e2e.walk.stale'], { routes: walk.routes }));
    if (values['require-walk']) failures += 1;
  } else if (walk === undefined && values['require-walk']) {
    log(messages['e2e.walk.missing']);
    failures += 1;
  } else if (walk !== undefined) {
    log(format(messages['e2e.walk.summary'], { routes: walk.routes, pages: walk.pages, broken: walk.broken.length }));
    for (const item of walk.broken) {
      failures += 1;
      log(format(messages['e2e.walk.broken'], { id: item.id, viewport: item.viewport, problems: item.problems.join('; ') }));
    }
  }
  if (visual !== undefined) {
    log(format(messages['e2e.visual.summary'], { pass: visual.pass, fail: visual.fail.length, pending: visual.pending.length, stale: visual.stale.length }));
    for (const id of visual.fail) {
      failures += 1;
      log(format(messages['e2e.visual.failed'], { id }));
    }
    for (const id of visual.pending) {
      if (values['require-visual']) failures += 1;
      log(format(messages['e2e.visual.pending'], { id }));
    }
    for (const id of visual.stale) {
      if (values['require-visual']) failures += 1;
      log(format(messages['e2e.visual.stale'], { id }));
    }
  }
  log(failures === 0 ? messages['e2e.summary.pass'] : format(messages['e2e.summary.fail'], { count: failures }));
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
