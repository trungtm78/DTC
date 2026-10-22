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
