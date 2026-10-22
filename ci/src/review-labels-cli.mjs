import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';
import { defaultRun } from './verify.mjs';
import { loadRules, missingLabels, requiredLabels } from './review-labels.mjs';

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

// Merge gate: exit 1 while any review item required by the changed paths lacks its human approval label.
export function main(argv, { log = console.log, run = defaultRun, env = process.env } = {}) {
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
  const diff = run('git', ['diff', '--name-only', `${base}...HEAD`]);
  if (diff.status !== 0) {
    log(translate(messages, 'review.diffFailed', { base }));
    return 1;
  }
  const changed = diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const required = requiredLabels(changed, loadRules());
  if (required.length === 0) {
    log(translate(messages, 'review.noneRequired'));
    return 0;
  }
  const missing = missingLabels(required, labels);
  if (missing.length === 0) {
    log(translate(messages, 'review.satisfied', { items: required.join(', ') }));
    return 0;
  }
  log(translate(messages, 'review.blocked', { count: missing.length }));
  for (const label of missing) {
    log(`  - ${translate(messages, 'review.missingItem', { required: label, approval: label.replace('review:', 'review:approved:') })}`);
  }
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
