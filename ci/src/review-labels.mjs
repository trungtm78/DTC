import { readFileSync } from 'node:fs';

// Closed vocabulary shared with the plan tool's review items.
export const REVIEW_ITEMS = Object.freeze([
  'money',
  'authorization',
  'tenant-isolation',
  'migration',
  'legal-template',
  'legal-rule',
  'ai-decision',
  'privacy',
  'security',
]);

const REQUIRED_PREFIX = 'review:';
const APPROVED_PREFIX = 'review:approved:';
const VALID_LABELS = new Set(REVIEW_ITEMS.map((item) => `${REQUIRED_PREFIX}${item}`));
const RULES_URL = new URL('../review-rules.json', import.meta.url);

function escapeRegex(char) {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

function globToRegex(glob) {
  let source = '';
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const followedBySlash = glob[index + 2] === '/';
      source += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 3 : 2;
    } else if (char === '*') {
      source += '[^/]*';
      index += 1;
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else {
      source += escapeRegex(char);
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(file, glob) {
  return globToRegex(glob).test(file);
}

export function validateRules(rules) {
  if (!Array.isArray(rules)) throw new Error('review rules must be an array');
  for (const rule of rules) {
    if (!Array.isArray(rule.globs) || rule.globs.length === 0) throw new Error('every review rule needs a non-empty globs array');
    if (!Array.isArray(rule.labels) || rule.labels.length === 0) throw new Error('every review rule needs a non-empty labels array');
    for (const label of rule.labels) {
      if (!VALID_LABELS.has(label)) throw new Error(`review label outside the closed vocabulary: ${label}`);
    }
  }
  return rules;
}

export function loadRules(url = RULES_URL) {
  return validateRules(JSON.parse(readFileSync(url, 'utf8')).rules);
}

export function requiredLabels(changedFiles, rules) {
  const required = new Set();
  const files = changedFiles.map((file) => file.replaceAll('\\', '/'));
  for (const rule of rules) {
    const matchers = rule.globs.map(globToRegex);
    if (files.some((file) => matchers.some((matcher) => matcher.test(file)))) {
      for (const label of rule.labels) required.add(label);
    }
  }
  return [...required].sort();
}

// Only the human approval label `review:approved:<item>` satisfies `review:<item>`.
export function missingLabels(required, prLabels) {
  const present = new Set(prLabels);
  return required.filter((label) => !present.has(`${APPROVED_PREFIX}${label.slice(REQUIRED_PREFIX.length)}`));
}

// Latest applier of each approval label, from GitHub issue events (oldest first). Only labels that are
// still on the PR are considered; a label without any `labeled` event gets no entry.
export function approvalActors(events, labels) {
  const present = new Set(labels.filter((label) => label.startsWith(APPROVED_PREFIX)));
  const actors = {};
  for (const event of events) {
    const name = event.label?.name;
    if (event.event === 'labeled' && present.has(name) && event.actor) {
      actors[name] = { login: event.actor.login, type: event.actor.type, at: event.created_at };
    }
  }
  return actors;
}

function isIndependentApproval(actor, author) {
  if (!actor || !author || actor.type === 'Bot') return false;
  return String(actor.login).toLowerCase() !== author.toLowerCase();
}

// An approval only covers the revision the reviewer saw: it must be strictly newer than the head commit.
// Unparsable or missing timestamps are never fresh.
function isFreshApproval(actor, headCommitAt) {
  const approvedAt = Date.parse(actor?.at);
  const committedAt = Date.parse(headCommitAt);
  return Number.isFinite(approvedAt) && Number.isFinite(committedAt) && approvedAt > committedAt;
}

const approvalOf = (label) => `${APPROVED_PREFIX}${label.slice(REQUIRED_PREFIX.length)}`;

// Required items without an approval that a human other than the PR author applied after the head commit
// was made (any newer commit invalidates every approval). Fails closed: unknown applier, unknown author,
// Bot appliers and unknown timestamps never approve.
export function unapprovedItems(required, prLabels, actors, author, headCommitAt) {
  const present = new Set(prLabels);
  return required.filter((label) => {
    const approval = approvalOf(label);
    const actor = actors[approval];
    return !present.has(approval) || !isIndependentApproval(actor, author) || !isFreshApproval(actor, headCommitAt);
  });
}

// Required items whose approval came from an independent human but is not newer than the head commit.
export function staleItems(required, prLabels, actors, author, headCommitAt) {
  const present = new Set(prLabels);
  return required.filter((label) => {
    const approval = approvalOf(label);
    return present.has(approval) && isIndependentApproval(actors[approval], author) && !isFreshApproval(actors[approval], headCommitAt);
  });
}
