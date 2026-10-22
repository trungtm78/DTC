import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';
import { defaultRun } from './verify.mjs';
import { approvalActors, loadRules, missingLabels, requiredLabels, staleItems, unapprovedItems } from './review-labels.mjs';

const EVENTS_PER_PAGE = 100;
const MAX_EVENTS = 2000;
const API_ORIGIN = 'https://api.github.com/';
const NEXT_LINK = /<([^>]+)>\s*;\s*rel="next"/;

export const EVENTS_TRUNCATED = 'EVENTS_TRUNCATED';
const COMMIT_UNREADABLE = 'COMMIT_UNREADABLE';

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

function nextPageUrl(response) {
  const match = NEXT_LINK.exec(response.headers?.get('link') ?? '');
  if (!match) return undefined;
  // The bearer token must never be sent anywhere but the GitHub API.
  if (!match[1].startsWith(API_ORIGIN)) throw new Error('next page link leaves the GitHub API');
  return match[1];
}

// Complete issue-event history of the pull request, oldest first, following the Link rel="next" header.
// A history longer than MAX_EVENTS or any failing page throws: a truncated history must never be trusted.
async function fetchEvents({ token, repository, number }, fetchImpl) {
  const events = [];
  let url = `${API_ORIGIN}repos/${repository}/issues/${number}/events?per_page=${EVENTS_PER_PAGE}`;
  while (url) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    events.push(...(await response.json()));
    url = nextPageUrl(response);
    if (url && events.length >= MAX_EVENTS) {
      throw Object.assign(new Error('history ceiling reached'), { code: EVENTS_TRUNCATED });
    }
  }
  return events;
}

// Commit date of the PR head: approvals applied before it were given for an older revision.
async function fetchHeadCommitDate({ token, repository, headSha }, fetchImpl) {
  const response = await fetchImpl(`${API_ORIGIN}repos/${repository}/commits/${headSha}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  const fail = (detail) => Object.assign(new Error(detail), { code: COMMIT_UNREADABLE });
  if (!response.ok) throw fail(`HTTP ${response.status}`);
  const date = (await response.json())?.commit?.committer?.date;
  if (!Number.isFinite(Date.parse(date))) throw fail('no committer date');
  return date;
}

function apiSettings(env) {
  const settings = { token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, number: env.PR_NUMBER, author: env.PR_AUTHOR, headSha: env.HEAD_SHA };
  const missing = [];
  if (!settings.token) missing.push('GITHUB_TOKEN');
  if (!settings.repository) missing.push('GITHUB_REPOSITORY');
  if (!/^[0-9]+$/.test(settings.number ?? '')) missing.push('PR_NUMBER');
  if (!settings.author) missing.push('PR_AUTHOR');
  if (!/^[0-9a-f]{40}$/i.test(settings.headSha ?? '')) missing.push('HEAD_SHA');
  return { settings, missing };
}

function reportBlocked(log, messages, missing, stale = []) {
  log(translate(messages, 'review.blocked', { count: missing.length }));
  for (const label of missing) {
    const key = stale.includes(label) ? 'review.approvalStale' : 'review.missingItem';
    log(`  - ${translate(messages, key, { required: label, approval: label.replace('review:', 'review:approved:') })}`);
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
  let headCommitAt;
  try {
    headCommitAt = await fetchHeadCommitDate(settings, fetchImpl);
  } catch (error) {
    log(translate(messages, 'review.commitFailed', { detail: error.message }));
    return 1;
  }
  try {
    events = await fetchEvents(settings, fetchImpl);
  } catch (error) {
    const key = error.code === EVENTS_TRUNCATED ? 'review.eventsTruncated' : 'review.eventsFailed';
    log(translate(messages, key, { detail: error.message, max: MAX_EVENTS }));
    return 1;
  }
  const actors = approvalActors(events, labels);
  const unapproved = unapprovedItems(required, labels, actors, settings.author, headCommitAt);
  if (unapproved.length > 0) return reportBlocked(log, messages, unapproved, staleItems(required, labels, actors, settings.author, headCommitAt));
  log(translate(messages, 'review.satisfied', { items: required.join(', ') }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
