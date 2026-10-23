import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCALE = 'vi';
const CI_WORKFLOW_FILE = 'ci.yml';
const API_VERSION = '2022-11-28';
const PAGE_SIZE = 100;
const MS_PER_MINUTE = 60_000;
/** The commit status the staging job writes once the staging deployment of a commit succeeded. */
export const STAGING_CONTEXT = 'deploy/staging';
export const PRODUCTION_CONTEXT_PREFIX = 'deploy/production/';
const STATES = new Set(['success', 'failure', 'pending', 'error']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const PROBLEM_CODES = ['SHA_INVALID', 'CI_NOT_GREEN', 'STAGING_NOT_GREEN', 'COHORT_UNKNOWN', 'PREVIOUS_COHORT_MISSING', 'BAKE_NOT_ELAPSED'];

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** The newest status of a context (the API lists newest first); undefined when the context never reported. */
function latestStatus(statuses, context) {
  return statuses.find((status) => status.context === context);
}

export function productionContext(cohort) {
  return `${PRODUCTION_CONTEXT_PREFIX}${cohort}`;
}

/**
 * Decides whether `sha` may be promoted to `cohort` in production. Inputs are API payloads, so the decision is a pure
 * function: the commit must have a successful CI run, the staging deployment of this exact commit must have succeeded,
 * and (past the first cohort) the previous cohort must have been promoted at least `bakeMinutes` ago.
 *
 * @param {{ sha: string, cohort: string, cohorts: string[], bakeMinutes: number, ciRuns: object[], statuses: object[], now: number }} input
 * @returns {{ problems: { code: string, detail: string }[] }}
 */
export function evaluateProductionGate({ sha, cohort, cohorts, bakeMinutes, ciRuns, statuses, now }) {
  const problems = [];
  if (!SHA_PATTERN.test(sha)) problems.push({ code: 'SHA_INVALID', detail: sha });
  const green = ciRuns.some((run) => run.head_sha === sha && run.status === 'completed' && run.conclusion === 'success');
  if (!green) problems.push({ code: 'CI_NOT_GREEN', detail: sha });
  if (latestStatus(statuses, STAGING_CONTEXT)?.state !== 'success') problems.push({ code: 'STAGING_NOT_GREEN', detail: STAGING_CONTEXT });
  const index = cohorts.indexOf(cohort);
  if (index < 0) {
    problems.push({ code: 'COHORT_UNKNOWN', detail: cohort });
  } else if (index > 0) {
    const previous = latestStatus(statuses, productionContext(cohorts[index - 1]));
    if (previous?.state !== 'success') {
      problems.push({ code: 'PREVIOUS_COHORT_MISSING', detail: cohorts[index - 1] });
    } else {
      const elapsed = (now - Date.parse(previous.created_at)) / MS_PER_MINUTE;
      if (!(elapsed >= bakeMinutes)) problems.push({ code: 'BAKE_NOT_ELAPSED', detail: `${cohorts[index - 1]} ${Math.max(0, Math.ceil(bakeMinutes - elapsed))}` });
    }
  }
  return { problems };
}

function apiBase(env) {
  return env.GITHUB_API_URL ?? 'https://api.github.com';
}

async function request(fetchImpl, env, method, path, body) {
  const response = await fetchImpl(`${apiBase(env)}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GH_TOKEN ?? ''}`,
      'x-github-api-version': API_VERSION,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

/** Writes a commit status. Production and staging evidence is a status on the deployed commit itself. */
export async function recordStatus({ repo, sha, context, state, description }, { fetchImpl = fetch, env = process.env } = {}) {
  return request(fetchImpl, env, 'POST', `/repos/${repo}/statuses/${sha}`, { state, context, description });
}

export async function loadEvidence({ repo, sha }, { fetchImpl = fetch, env = process.env } = {}) {
  const runs = await request(fetchImpl, env, 'GET', `/repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs?head_sha=${sha}&per_page=${PAGE_SIZE}`);
  const statuses = await request(fetchImpl, env, 'GET', `/repos/${repo}/commits/${sha}/statuses?per_page=${PAGE_SIZE}`);
  return { ciRuns: runs.workflow_runs ?? [], statuses };
}

export function readCanaryPolicy(root = REPO_ROOT) {
  const policy = JSON.parse(readFileSync(join(root, 'infra', 'pipelines', 'production.json'), 'utf8'));
  return { cohorts: policy.canary.cohorts, bakeMinutes: policy.canary.bakeMinutes };
}

const OPTIONS = {
  sha: { type: 'string' },
  cohort: { type: 'string' },
  repo: { type: 'string' },
  context: { type: 'string' },
  state: { type: 'string' },
  description: { type: 'string', default: '' },
  root: { type: 'string', default: REPO_ROOT },
  locale: { type: 'string', default: DEFAULT_LOCALE },
};

/**
 * `check --sha <sha> --cohort <cohort> --repo <owner/name>` exits 1 when the promotion is not allowed.
 * `record --sha <sha> --repo <owner/name> --context <context> --state <state>` writes a commit status.
 */
export async function main(argv, { log = console.log, fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch {
    log(loadMessages(DEFAULT_LOCALE)['deployGate.usage']);
    return 2;
  }
  const { values, positionals } = parsed;
  const messages = loadMessages(values.locale);
  const [command] = positionals;
  const complete = values.sha !== undefined && values.repo !== undefined;
  if (command === 'record' && complete && values.context !== undefined && STATES.has(values.state ?? '')) {
    await recordStatus({ repo: values.repo, sha: values.sha, context: values.context, state: values.state, description: values.description }, { fetchImpl, env });
    log(format(messages['deployGate.recorded'], { context: values.context, state: values.state }));
    return 0;
  }
  if (command === 'check' && complete && values.cohort !== undefined) {
    const policy = readCanaryPolicy(resolve(values.root));
    const evidence = await loadEvidence({ repo: values.repo, sha: values.sha }, { fetchImpl, env });
    const { problems } = evaluateProductionGate({ sha: values.sha, cohort: values.cohort, ...policy, ...evidence, now });
    for (const problem of problems) log(format(messages[`deployGate.${problem.code}`], { detail: problem.detail }));
    log(problems.length === 0 ? format(messages['deployGate.summary.pass'], { sha: values.sha, cohort: values.cohort }) : format(messages['deployGate.summary.fail'], { count: problems.length }));
    return problems.length === 0 ? 0 : 1;
  }
  log(messages['deployGate.usage']);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
