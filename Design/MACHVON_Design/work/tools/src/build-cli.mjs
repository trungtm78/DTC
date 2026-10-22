import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadModel } from './model.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';
import { buildPages } from './render/pages.mjs';
import { exportPdfs } from './render/markdown-pdf.mjs';

const PACKAGE_ROOT = new URL('../../../', import.meta.url);
const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('03_Engineering', PACKAGE_ROOT));
const DEFAULT_DOCS_DIR = fileURLToPath(new URL('01_Documents', PACKAGE_ROOT));
const DEFAULT_BASELINE = '1.4';
const BROWSER_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];

export function findBrowserExecutable({
  explicit = process.env.MACHVON_BROWSER,
  candidates = BROWSER_CANDIDATES,
  exists = existsSync,
} = {}) {
  if (explicit) return explicit;
  const found = candidates.find((path) => exists(path));
  if (!found) throw new Error('No Chromium-based browser found; set MACHVON_BROWSER to its executable path');
  return found;
}

async function launchInstalledBrowser() {
  const { default: puppeteer } = await import('puppeteer-core');
  return puppeteer.launch({ executablePath: findBrowserExecutable(), headless: true });
}

function todayVietnamese() {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
}

export async function main(argv, { log = console.log, launch = launchInstalledBrowser } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      pages: { type: 'boolean', default: false },
      pdf: { type: 'boolean', default: false },
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      docs: { type: 'string', default: DEFAULT_DOCS_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      baseline: { type: 'string', default: DEFAULT_BASELINE },
      date: { type: 'string', default: todayVietnamese() },
    },
  });
  const messages = loadMessages(values.locale);
  if (!values.pages && !values.pdf) {
    log(translate(messages, 'build.usage'));
    return 2;
  }
  const ctx = { messages, baseline: values.baseline, date: values.date };
  if (values.pages) {
    for (const path of buildPages(loadModel(resolve(values.dir)), resolve(values.dir), ctx)) {
      log(translate(messages, 'build.wrote', { path }));
    }
  }
  if (values.pdf) {
    for (const { pdf } of await exportPdfs(resolve(values.docs), ctx, { launch })) {
      log(translate(messages, 'build.wrote', { path: pdf }));
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
