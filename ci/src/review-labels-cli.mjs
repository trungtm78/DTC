import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';
import { defaultRun } from './verify.mjs';
import { approvalActors, loadRules, missingLabels, requiredLabels, unapprovedItems } from './review-labels.mjs';

const EVENTS_PER_PAGE = 100;
const MAX_EVENT_PAGES = 3;

function parseLabels(raw) {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((label) => typeof label === 'string') ? parsed : undefined;
  } catch {
    // JSON.parse only throws SyntaxError; malformed input is reported by the caller as an invalid value.
    return undefined;
  }
}

// Issue events of the pull request, oldest first, at most MAX_EVENT_PAGES * EVENTS_PER_PAGE entries.
async function fetchEvents({ token, repository, number }, fetchImpl) {
  const events = [];
  for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
    const url = `https://api.github.com/repos/${repository}/issues/${number}/events?per_page=${EVENTS_PER_PAGE}&page=${page}`;
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const batch = await response.json();
    events.push(...batch);
    if (batch.length < EVENTS_PER_PAGE) break;
  }
  return events;
}

function apiSettings(env) {
  const settings = { token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, number: env.PR_NUMBER, author: env.PR_AUTHOR };
  const missing = [];
  if (!settings.token) missing.push('GITHUB_TOKEN');
  if (!settings.repository) missing.push('GITHUB_REPOSITORY');
  if (!/^[0-9]+$/.test(settings.number ?? '')) missing.push('PR_NUMBER');
  if (!settings.author) missing.push('PR_AUTHOR');
  return { settings, missing };
}

function reportBlocked(log, messages, missing) {
  log(translate(messages, 'review.blocked', { count: missing.length }));
  for (const label of missing) {
    log(`  - ${translate(messages, 'review.missingItem', { required: label, approval: label.replace('review:', 'review:approved:') })}`);
  }
  return 1;
}

// Merge gate: exit 1 while any review item required by the changed paths lacks an approval label that a
// human other than the PR author applied.
export async function main(argv, { log = console.log, run = defaultRun, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const base = values.base ?? env.REVIEW_BASE;
  if (!base) {
    log(translate(messages, 'review.baseMissing'));
    return 1;
  }
  const labels = parseLabels(env.PR_LABELS);
  if (!labels) {
    log(translate(messages, 'review.labelsInvalid'));
    return 1;
  }
  // -z: NUL-delimited, unquoted paths (non-ASCII safe); --no-renames: a rename lists the source path too.
  const diff = run('git', ['diff', '--name-only', '-z', '--no-renames', `${base}...HEAD`]);
  if (diff.status !== 0) {
    log(translate(messages, 'review.diffFailed', { base }));
    return 1;
  }
  const changed = diff.stdout.split('\0').filter(Boolean);
  const required = requiredLabels(changed, loadRules());
  if (required.length === 0) {
    log(translate(messages, 'review.noneRequired'));
    return 0;
  }
  const absent = missingLabels(required, labels);
  // Nothing is approved yet, so the applier does not matter and the API is not needed.
  if (absent.length === required.length) return reportBlocked(log, messages, absent);

  const { settings, missing: missingSettings } = apiSettings(env);
  if (missingSettings.length > 0) {
    log(translate(messages, 'review.apiSettingsMissing', { names: missingSettings.join(', ') }));
    return 1;
  }
  let events;
  try {
    events = await fetchEvents(settings, fetchImpl);
  } catch (error) {
    log(translate(messages, 'review.eventsFailed', { detail: error.message }));
    return 1;
  }
  const unapproved = unapprovedItems(required, labels, approvalActors(events, labels), settings.author);
  if (unapproved.length > 0) return reportBlocked(log, messages, unapproved);
  log(translate(messages, 'review.satisfied', { items: required.join(', ') }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
