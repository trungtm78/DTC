import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { REVIEW_ITEMS, approvalActors, loadRules, matchesGlob, missingLabels, requiredLabels, staleItems, unapprovedItems, validateRules } from '../src/review-labels.mjs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/review-labels-cli.mjs';
import { defaultRun } from '../src/verify.mjs';

const RULES = loadRules();

test('acceptance: a migration file with no labels leaves review:migration missing', () => {
  const required = requiredLabels(['db/migrations/V003__x.sql'], RULES);
  assert.deepEqual(required, ['review:migration']);
  assert.deepEqual(missingLabels(required, []), ['review:migration']);
});

test('acceptance: review:approved:migration satisfies review:migration', () => {
  const required = requiredLabels(['db/migrations/V003__x.sql'], RULES);
  assert.deepEqual(missingLabels(required, ['review:approved:migration']), []);
});

test('a bare review:<item> label is a request, not an approval', () => {
  assert.deepEqual(missingLabels(['review:migration'], ['review:migration']), ['review:migration']);
});

test('an approval for a different item does not satisfy the requirement', () => {
  assert.deepEqual(missingLabels(['review:money'], ['review:approved:migration', 'bug']), ['review:money']);
});

test('an unrelated file requires nothing', () => {
  assert.deepEqual(requiredLabels(['README.md', 'apps/api/src/main.ts'], RULES), []);
  assert.deepEqual(requiredLabels([], RULES), []);
});

test('required labels are de-duplicated and sorted', () => {
  const files = ['db/migrations/V1.sql', 'db/migrations/V2.sql', 'packages/db/src/x.ts', 'packages/kernel/src/signed-context.ts'];
  assert.deepEqual(requiredLabels(files, RULES), ['review:migration', 'review:security', 'review:tenant-isolation']);
});

test('seed rules map each path family to its labels', () => {
  const cases = [
    ['packages/db/src/tenant-database.ts', ['review:tenant-isolation']],
    ['packages/kernel/src/signed-context.ts', ['review:security', 'review:tenant-isolation']],
    ['packages/kernel/src/tenant-context.ts', ['review:security', 'review:tenant-isolation']],
    ['packages/kernel/src/errors.ts', []],
    ['apps/api/src/pay/pay.service.ts', ['review:money']],
    ['apps/api/src/modules/ledger-entries/x.ts', ['review:money']],
    ['apps/api/src/payment.ts', ['review:money']],
    ['apps/api/src/iam/roles.ts', ['review:authorization']],
    ['apps/api/src/policy-engine.ts', ['review:authorization']],
    ['packages/kernel/src/permission.ts', ['review:authorization']],
    ['Design/MACHVON_Design/03_Engineering/legal_rules.json', ['review:legal-rule']],
    ['apps/api/src/ai/agent.ts', ['review:ai-decision']],
    ['apps/api/src/llm/client.ts', ['review:ai-decision']],
    ['apps/api/src/mail/client.ts', []],
    ['apps/api/src/said/x.ts', []],
  ];
  for (const [file, expected] of cases) {
    assert.deepEqual(requiredLabels([file], RULES), expected, file);
  }
});

test('Windows separators are normalised before matching', () => {
  assert.deepEqual(requiredLabels(['db\\migrations\\V9.sql'], RULES), ['review:migration']);
});

test('matchesGlob supports **, *, ? and escapes regex characters', () => {
  assert.equal(matchesGlob('a/b/c.ts', '**/c.ts'), true);
  assert.equal(matchesGlob('c.ts', '**/c.ts'), true);
  assert.equal(matchesGlob('a/b/c.ts', 'a/*/c.ts'), true);
  assert.equal(matchesGlob('a/b/d/c.ts', 'a/*/c.ts'), false);
  assert.equal(matchesGlob('a/x1.ts', 'a/x?.ts'), true);
  assert.equal(matchesGlob('a/xy1.ts', 'a/x?.ts'), false);
  assert.equal(matchesGlob('a/b.ts', 'a/b.ts'), true);
  assert.equal(matchesGlob('a/bxts', 'a/b.ts'), false);
  assert.equal(matchesGlob('a/b/c', 'a/**'), true);
});

test('every seed label belongs to the closed review vocabulary', () => {
  assert.deepEqual([...REVIEW_ITEMS], ['money', 'authorization', 'tenant-isolation', 'migration', 'legal-template', 'legal-rule', 'ai-decision', 'privacy', 'security']);
  assert.doesNotThrow(() => validateRules(RULES));
  const raw = JSON.parse(readFileSync(new URL('../review-rules.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(raw.rules) && raw.rules.length > 0);
});

test('validateRules rejects labels outside the vocabulary and malformed rules', () => {
  assert.throws(() => validateRules([{ globs: ['x'], labels: ['review:bogus'] }]), /review:bogus/);
  assert.throws(() => validateRules([{ globs: ['x'], labels: ['money'] }]), /money/);
  assert.throws(() => validateRules([{ globs: [], labels: ['review:money'] }]), /globs/);
  assert.throws(() => validateRules([{ globs: ['x'], labels: [] }]), /labels/);
  assert.throws(() => validateRules({}), /array/);
});


const REVIEWER = { login: 'reviewer-1', type: 'User' };
const HEAD_AT = '2026-01-01T00:00:00Z';
const APPROVAL_AT = '2026-01-02T00:00:00Z';

function labeledEvent(label, actor, id = 1, at = APPROVAL_AT) {
  return { id, event: 'labeled', created_at: at, label: { name: label }, actor };
}

test('approvalActors returns the latest labeler of each approved label', () => {
  const events = [
    labeledEvent('review:approved:migration', { login: 'author', type: 'User' }, 1),
    { id: 2, event: 'unlabeled', label: { name: 'review:approved:migration' }, actor: { login: 'author', type: 'User' } },
    labeledEvent('review:approved:migration', REVIEWER, 3),
    labeledEvent('bug', { login: 'someone', type: 'User' }, 4),
    { id: 5, event: 'commented' },
  ];
  const actors = approvalActors(events, ['review:approved:migration', 'review:approved:money', 'bug']);
  assert.deepEqual(actors, { 'review:approved:migration': { ...REVIEWER, at: APPROVAL_AT } });
});

test('approvalActors ignores labeled events without a label or an actor', () => {
  const events = [{ event: 'labeled', actor: REVIEWER }, { event: 'labeled', label: { name: 'review:approved:money' }, actor: null }];
  assert.deepEqual(approvalActors(events, ['review:approved:money']), {});
});

test('independence: a self-applied approval does not approve (login compared case-insensitively)', () => {
  const actors = approvalActors([labeledEvent('review:approved:migration', { login: 'Alice', type: 'User' })], ['review:approved:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], actors, 'alice', HEAD_AT), ['review:migration']);
});

test('independence: a Bot-applied approval does not approve', () => {
  const actors = approvalActors([labeledEvent('review:approved:migration', { login: 'automation[bot]', type: 'Bot' })], ['review:approved:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], actors, 'alice', HEAD_AT), ['review:migration']);
});

test('independence: a reviewer-applied approval approves', () => {
  const actors = approvalActors([labeledEvent('review:approved:migration', REVIEWER)], ['review:approved:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], actors, 'alice', HEAD_AT), []);
});

test('independence: a label with no labeled event fails closed', () => {
  const actors = approvalActors([], ['review:approved:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], actors, 'alice', HEAD_AT), ['review:migration']);
});

test('independence: an unlabeled-then-relabeled approval uses the latest actor', () => {
  const selfThenReviewer = [
    labeledEvent('review:approved:migration', { login: 'alice', type: 'User' }, 1),
    labeledEvent('review:approved:migration', REVIEWER, 2),
  ];
  const first = approvalActors(selfThenReviewer, ['review:approved:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], first, 'alice', HEAD_AT), []);
  const reviewerThenSelf = [...selfThenReviewer].reverse().map((event, index) => ({ ...event, id: index + 1 }));
  const second = approvalActors(reviewerThenSelf, ['review:approved:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], second, 'alice', HEAD_AT), ['review:migration']);
});

test('unapprovedItems fails closed without an author, and still reports labels that are absent', () => {
  const actors = { 'review:approved:migration': { ...REVIEWER, at: APPROVAL_AT } };
  assert.deepEqual(unapprovedItems(['review:migration'], ['review:approved:migration'], actors, '', HEAD_AT), ['review:migration']);
  assert.deepEqual(unapprovedItems(['review:money', 'review:migration'], ['review:approved:migration'], actors, 'alice', HEAD_AT), ['review:money']);
});

const API_ENV = { GITHUB_TOKEN: 't0ken', GITHUB_REPOSITORY: 'org/repo', PR_NUMBER: '7', PR_AUTHOR: 'alice', HEAD_SHA: 'a'.repeat(40) };

const API_EVENTS = 'https://api.github.com/repos/org/repo/issues/7/events';

// Serves `pages` in order; every page except the last carries a Link rel="next" header like GitHub does.
function fakeFetch(pages, { ok = true, status = 200, failAt = -1, commit = { commit: { committer: { date: HEAD_AT } } }, commitOk = true } = {}) {
  const urls = [];
  const calls = [];
  const commitUrls = [];
  const fetchImpl = async (url, options) => {
    if (url.includes('/commits/')) {
      commitUrls.push(url);
      calls.push(options);
      return { ok: commitOk, status: commitOk ? 200 : 404, headers: { get: () => null }, json: async () => commit };
    }
    const index = urls.length;
    urls.push(url);
    calls.push(options);
    if (!ok || index === failAt) return { ok: false, status: 403, headers: { get: () => null }, json: async () => [] };
    const next = index < pages.length - 1 ? `<${API_EVENTS}?per_page=100&page=${index + 2}>; rel="next", <${API_EVENTS}?per_page=100&page=9>; rel="last"` : null;
    return { ok, status, headers: { get: (name) => (name.toLowerCase() === 'link' ? next : null) }, json: async () => pages[index] ?? [] };
  };
  return { fetchImpl, urls, calls, commitUrls };
}

async function runCli(argv, { stdout = '', labels, env = {}, status = 0, pages = [[]], fetchOk = true, failAt = -1, commit, commitOk } = {}) {
  const lines = [];
  const gitCalls = [];
  const run = (command, args) => {
    gitCalls.push([command, ...args]);
    return { status, stdout, stderr: status === 0 ? '' : 'boom' };
  };
  const fullEnv = { ...API_ENV, ...env };
  if (labels !== undefined) fullEnv.PR_LABELS = labels;
  const fetcher = fakeFetch(pages, { ok: fetchOk, failAt, commit, commitOk });
  const code = await main(argv, { log: (text) => lines.push(text), run, env: fullEnv, fetchImpl: fetcher.fetchImpl });
  return { code, out: lines.join('\n'), gitCalls, fetcher };
}

const EN = ['--base', 'abc', '--locale', 'en'];
const nul = (...paths) => `${paths.join('\0')}\0`;

test('cli lists changes with -z and --no-renames so a rename counts both paths', async () => {
  const { code, gitCalls } = await runCli(EN, { stdout: nul('README.md'), labels: '[]' });
  assert.equal(code, 0);
  assert.deepEqual(gitCalls[0], ['git', 'diff', '--name-only', '-z', '--no-renames', 'abc...HEAD']);
});

test('a real rename out of db/migrations still requires migration approval (source path counts)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-rename-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'db', 'migrations'), { recursive: true });
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'db', 'migrations', 'V003__thuế.sql'), 'select 1;\nselect 2;\nselect 3;\nselect 4;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: base');
  const base = git('rev-parse', 'HEAD').trim();
  git('mv', 'db/migrations/V003__thuế.sql', 'docs/V003__thuế.sql');
  git('commit', '-q', '-m', 'chore: move');
  const lines = [];
  const code = await main(['--base', base, '--locale', 'en'], {
    log: (text) => lines.push(text),
    run: (command, args) => defaultRun(command, args, { cwd: dir }),
    env: { ...API_ENV, PR_LABELS: '[]' },
    fetchImpl: fakeFetch([[]]).fetchImpl,
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /review:migration/);
});

test('a NUL-delimited non-ASCII path is matched without trimming or unquoting', async () => {
  const { code, out } = await runCli(EN, { stdout: nul('db/migrations/V003__thuế.sql'), labels: '[]' });
  assert.equal(code, 1);
  assert.match(out, /review:migration/);
});

test('cli fails and lists the missing item when no approval label exists, without calling the API', async () => {
  const { code, out, fetcher } = await runCli(EN, { stdout: nul('db/migrations/V003__x.sql'), labels: '[]' });
  assert.equal(code, 1);
  assert.match(out, /review:migration/);
  assert.match(out, /review:approved:migration/);
  assert.equal(fetcher.urls.length, 0);
});

test('cli passes for a reviewer-applied approval label and reads the events with the token', async () => {
  const pages = [[labeledEvent('review:approved:migration', REVIEWER)]];
  const { code, out, fetcher } = await runCli(EN, { stdout: nul('db/migrations/V003__x.sql'), labels: '["review:approved:migration"]', pages });
  assert.equal(code, 0);
  assert.match(out, /approved for: review:migration/);
  assert.equal(fetcher.urls[0], 'https://api.github.com/repos/org/repo/issues/7/events?per_page=100');
  assert.equal(fetcher.calls[0].headers.Authorization, 'Bearer t0ken');
});

test('cli rejects a self-applied approval, a Bot-applied approval and an approval without an event', async () => {
  const stdout = nul('db/migrations/V003__x.sql');
  const labels = '["review:approved:migration"]';
  const self = await runCli(EN, { stdout, labels, pages: [[labeledEvent('review:approved:migration', { login: 'ALICE', type: 'User' })]] });
  assert.equal(self.code, 1);
  assert.match(self.out, /other than the PR author/);
  const bot = await runCli(EN, { stdout, labels, pages: [[labeledEvent('review:approved:migration', { login: 'x[bot]', type: 'Bot' })]] });
  assert.equal(bot.code, 1);
  const none = await runCli(EN, { stdout, labels, pages: [[]] });
  assert.equal(none.code, 1);
});

const fillerEvents = (count, offset = 0) => Array.from({ length: count }, (_, index) => ({ id: offset + index, event: 'commented' }));
const APPROVED = 'review:approved:migration';
const MIGRATION = nul('db/migrations/V003__x.sql');
const APPROVED_LABELS = `["${APPROVED}"]`;
const unlabeledEvent = (actor, id) => ({ id, event: 'unlabeled', label: { name: APPROVED }, actor });

// 302 events over 4 pages: the reviewer approves early, then events 301 and 302 change the label.
function longHistory(finalActor) {
  const first = [labeledEvent(APPROVED, REVIEWER, 1), ...fillerEvents(99, 2)];
  return [first, fillerEvents(100, 100), fillerEvents(100, 200), [unlabeledEvent({ login: 'alice', type: 'User' }, 301), labeledEvent(APPROVED, finalActor, 302)]];
}

test('cli follows the Link rel=next header through a 302-event history and uses the latest actor', async () => {
  const selfRelabel = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages: longHistory({ login: 'alice', type: 'User' }) });
  assert.equal(selfRelabel.code, 1);
  assert.equal(selfRelabel.fetcher.urls.length, 4);
  assert.equal(selfRelabel.fetcher.urls[3], `${API_EVENTS}?per_page=100&page=4`);
  const reviewerRelabel = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages: longHistory(REVIEWER) });
  assert.equal(reviewerRelabel.code, 0);
  assert.equal(reviewerRelabel.fetcher.urls.length, 4);
});

test('cli stops on a page without a next link', async () => {
  const { code, fetcher } = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages: [[labeledEvent(APPROVED, REVIEWER)]] });
  assert.equal(code, 0);
  assert.equal(fetcher.urls.length, 1);
});

test('cli fails closed when the history reaches the 2000-event ceiling with more pages pending', async () => {
  const pages = Array.from({ length: 21 }, (_, index) => (index === 0 ? [labeledEvent(APPROVED, REVIEWER, 1), ...fillerEvents(99, 2)] : fillerEvents(100, index * 100)));
  const truncated = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages });
  assert.equal(truncated.code, 1);
  assert.match(truncated.out, /more than 2000 events/);
  assert.equal(truncated.fetcher.urls.length, 20);
  const exact = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages: pages.slice(0, 20) });
  assert.equal(exact.code, 0);
  assert.equal(exact.fetcher.urls.length, 20);
});

test('cli fails closed when a later page fails to load', async () => {
  const { code, out } = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages: longHistory(REVIEWER), failAt: 2 });
  assert.equal(code, 1);
  assert.match(out, /Cannot read the pull request events/);
});

test('cli refuses a next link that leaves the GitHub API host', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: () => (url.includes('/commits/') ? null : '<https://evil.example/events?page=2>; rel="next"') },
    json: async () => (url.includes('/commits/') ? { commit: { committer: { date: HEAD_AT } } } : [labeledEvent(APPROVED, REVIEWER)]),
  });
  const lines = [];
  const code = await main(EN, { log: (text) => lines.push(text), run: () => ({ status: 0, stdout: MIGRATION, stderr: '' }), env: { ...API_ENV, PR_LABELS: APPROVED_LABELS }, fetchImpl });
  assert.equal(code, 1);
  assert.match(lines.join(' '), /Cannot read the pull request events/);
});

test('cli fails closed when the events cannot be read or the API settings are missing', async () => {
  const stdout = nul('db/migrations/V003__x.sql');
  const labels = '["review:approved:migration"]';
  const denied = await runCli(EN, { stdout, labels, fetchOk: false });
  assert.equal(denied.code, 1);
  assert.match(denied.out, /Cannot read the pull request events/);
  const noToken = await runCli(EN, { stdout, labels, env: { GITHUB_TOKEN: '' } });
  assert.equal(noToken.code, 1);
  assert.match(noToken.out, /GITHUB_TOKEN/);
  const noAuthor = await runCli(EN, { stdout, labels, env: { PR_AUTHOR: '' } });
  assert.equal(noAuthor.code, 1);
  const badNumber = await runCli(EN, { stdout, labels, env: { PR_NUMBER: 'abc' } });
  assert.equal(badNumber.code, 1);
  const throwing = await main(EN, {
    log: () => {},
    run: () => ({ status: 0, stdout, stderr: '' }),
    env: { ...API_ENV, PR_LABELS: labels },
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(throwing, 1);
});

test('cli passes for unrelated changes without needing the API settings', async () => {
  const { code, out } = await runCli(EN, { stdout: nul('README.md'), labels: '[]', env: { GITHUB_TOKEN: '' } });
  assert.equal(code, 0);
  assert.match(out, /No human review/);
});

test('cli reads the base from the environment when no argument is given, and defaults to Vietnamese', async () => {
  const { code, out, gitCalls } = await runCli([], { stdout: nul('db/migrations/V1.sql'), labels: '[]', env: { REVIEW_BASE: 'def' } });
  assert.equal(code, 1);
  assert.equal(gitCalls[0].at(-1), 'def...HEAD');
  assert.match(out, /review:migration/);
  assert.doesNotMatch(out, /approved for/);
});

test('cli fails closed when the base, the labels or git are unusable', async () => {
  const noBase = await runCli(['--locale', 'en'], { labels: '[]' });
  assert.equal(noBase.code, 1);
  assert.match(noBase.out, /base/i);
  const noLabels = await runCli(EN, {});
  assert.equal(noLabels.code, 1);
  assert.match(noLabels.out, /PR_LABELS/);
  const badJson = await runCli(EN, { labels: '{not json' });
  assert.equal(badJson.code, 1);
  assert.match(badJson.out, /PR_LABELS/);
  const notArray = await runCli(EN, { labels: '{"a":1}' });
  assert.equal(notArray.code, 1);
  assert.match(notArray.out, /PR_LABELS/);
  const gitFails = await runCli(EN, { labels: '[]', status: 128 });
  assert.equal(gitFails.code, 1);
  assert.match(gitFails.out, /git diff/);
});

test('approvalActors records when each approval label was applied', () => {
  const actors = approvalActors([labeledEvent(APPROVED, REVIEWER, 1, '2026-03-04T05:06:07Z')], [APPROVED]);
  assert.deepEqual(actors, { [APPROVED]: { ...REVIEWER, at: '2026-03-04T05:06:07Z' } });
});

test('an approval applied before the head commit is stale and does not approve', () => {
  const actors = approvalActors([labeledEvent(APPROVED, REVIEWER, 1, '2026-01-01T00:00:00Z')], [APPROVED]);
  assert.deepEqual(unapprovedItems(['review:migration'], [APPROVED], actors, 'alice', '2026-01-01T00:00:01Z'), ['review:migration']);
  assert.deepEqual(staleItems(['review:migration'], [APPROVED], actors, 'alice', '2026-01-01T00:00:01Z'), ['review:migration']);
});

test('an approval at the same instant as the head commit does not approve; one second later does', () => {
  const same = approvalActors([labeledEvent(APPROVED, REVIEWER, 1, '2026-01-01T00:00:00Z')], [APPROVED]);
  assert.deepEqual(unapprovedItems(['review:migration'], [APPROVED], same, 'alice', '2026-01-01T00:00:00Z'), ['review:migration']);
  const later = approvalActors([labeledEvent(APPROVED, REVIEWER, 1, '2026-01-01T00:00:01Z')], [APPROVED]);
  assert.deepEqual(unapprovedItems(['review:migration'], [APPROVED], later, 'alice', '2026-01-01T00:00:00Z'), []);
  assert.deepEqual(staleItems(['review:migration'], [APPROVED], later, 'alice', '2026-01-01T00:00:00Z'), []);
});

test('missing or unparsable timestamps fail closed', () => {
  const noEventTime = { [APPROVED]: { ...REVIEWER } };
  assert.deepEqual(unapprovedItems(['review:migration'], [APPROVED], noEventTime, 'alice', HEAD_AT), ['review:migration']);
  const good = { [APPROVED]: { ...REVIEWER, at: APPROVAL_AT } };
  assert.deepEqual(unapprovedItems(['review:migration'], [APPROVED], good, 'alice', undefined), ['review:migration']);
  assert.deepEqual(unapprovedItems(['review:migration'], [APPROVED], good, 'alice', 'not a date'), ['review:migration']);
});

test('staleItems ignores items that are unapproved for another reason', () => {
  assert.deepEqual(staleItems(['review:migration'], [], {}, 'alice', HEAD_AT), []);
  const bot = { [APPROVED]: { login: 'x[bot]', type: 'Bot', at: '2025-01-01T00:00:00Z' } };
  assert.deepEqual(staleItems(['review:migration'], [APPROVED], bot, 'alice', HEAD_AT), []);
});

test('cli rejects an approval older than the head commit with the stale message, and reads the commit by SHA', async () => {
  const pages = [[labeledEvent(APPROVED, REVIEWER, 1, '2026-01-01T00:00:00Z')]];
  const commit = { commit: { committer: { date: '2026-01-05T00:00:00Z' } } };
  const { code, out, fetcher } = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, commit });
  assert.equal(code, 1);
  assert.match(out, /predates the latest push/);
  assert.equal(fetcher.commitUrls[0], `https://api.github.com/repos/org/repo/commits/${'a'.repeat(40)}`);
});

test('cli accepts an approval applied after the head commit', async () => {
  const pages = [[labeledEvent(APPROVED, REVIEWER, 1, '2026-01-06T00:00:00Z')]];
  const commit = { commit: { committer: { date: '2026-01-05T00:00:00Z' } } };
  const { code } = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, commit });
  assert.equal(code, 0);
});

test('cli fails closed when the head commit date is missing, unreadable or HEAD_SHA is unusable', async () => {
  const pages = [[labeledEvent(APPROVED, REVIEWER)]];
  const noDate = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, commit: { commit: {} } });
  assert.equal(noDate.code, 1);
  assert.match(noDate.out, /head commit date/);
  const badDate = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, commit: { commit: { committer: { date: 'soon' } } } });
  assert.equal(badDate.code, 1);
  const notFound = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, commitOk: false });
  assert.equal(notFound.code, 1);
  assert.match(notFound.out, /head commit date/);
  const noSha = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, env: { HEAD_SHA: '' } });
  assert.equal(noSha.code, 1);
  assert.match(noSha.out, /HEAD_SHA/);
  const badSha = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages, env: { HEAD_SHA: '../x' } });
  assert.equal(badSha.code, 1);
  const noTime = await runCli(EN, { stdout: MIGRATION, labels: APPROVED_LABELS, pages: [[{ event: 'labeled', label: { name: APPROVED }, actor: REVIEWER }]] });
  assert.equal(noTime.code, 1);
});
