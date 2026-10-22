import { finding } from './checks/finding.mjs';
import { listOperations, WRITE_METHODS } from './checks/openapi.mjs';
import { parseSql } from './sql.mjs';

// Implementation plan: epic -> feature -> story (a demonstrable vertical slice) -> technical and QA
// tasks. Completeness is checked against the single-source design data so nothing is left unplanned.

export const RELEASES = ['R0', 'R1', 'R2', 'R3', 'R4'];
// Human review items a story may require; the vocabulary is closed so schedules can be summed by kind.
export const REVIEW_ITEMS = ['money', 'authorization', 'tenant-isolation', 'migration', 'legal-template', 'legal-rule', 'ai-decision', 'privacy', 'security'];
// Minimum review.hours.max per item; a story with several items needs the sum of its floors, capped.
// The floors come from first principles: a reviewer cannot read a ledger or an isolation policy in less.
export const REVIEW_FLOORS = {
  items: { money: 1.5, 'tenant-isolation': 2, authorization: 1, migration: 1, 'legal-template': 1, 'legal-rule': 1, 'ai-decision': 1, security: 1, privacy: 0.5 },
  sumCap: 8,
};
export function reviewFloor(required) {
  const sum = required.reduce((total, item) => total + (REVIEW_FLOORS.items[item] ?? 0), 0);
  return Math.min(sum, REVIEW_FLOORS.sumCap);
}

// Evidence quality. A UI screen-contract checklist proves that a screen renders and obeys the seven
// UI states; it cannot prove state changes, money, permissions or events, so a criterion that states such
// behaviour must cite a specific test.
export const BEHAVIOUR_PATTERN = /\b(?:40[0-9]|422|409|403)\b|\bstatus|ledger|audit|\bevents?\b|emitted|idempotent|\bDONE\b|approv|reject|refus|\bamount|VND|duplicate|\bstored\b|\bcreated\b|\bqueued\b|\bwritten\b|\btransaction\b|\benforced\b|\bunchanged\b|\bsets\b/i;
const UI_CHECKLIST_TEST = /^UI-/;
const HAS_NUMBER_OR_CODE = /\d|\b[A-Z][A-Z0-9_]{3,}\b/;
const TOLERANCE_WITH_NUMBER = /tolerance\s*(?:of\s+)?[±<≤=]*\s*\d/i;
// Closed list of wording a reviewer cannot measure. An entry with `exempt` is allowed when the text
// also carries a number or a code (for example "correct" next to an error code or a figure).
export const SOFT_PHRASES = [
  { phrase: 'agreed', pattern: /\bagreed\b/i },
  { phrase: 'appropriate', pattern: /\bappropriate(?:ly)?\b/i },
  { phrase: 'as expected', pattern: /\bas expected\b/i },
  { phrase: 'works', pattern: /\bworks\b/i },
  { phrase: 'properly', pattern: /\bproperly\b/i },
  { phrase: 'screen contracts pass', pattern: /\bscreen[- ]contracts?(?: checks?)? (?:pass(?:es)?|fails?)\b/i },
  { phrase: 'correct', pattern: /\bcorrect(?:ly)?\b/i, exempt: HAS_NUMBER_OR_CODE },
  { phrase: 'within tolerance', pattern: /\bwithin\s+(?:the\s+)?(?:[a-z]+\s+)?tolerance\b/i, exempt: TOLERANCE_WITH_NUMBER },
];

function checkAcceptanceEvidence(stories) {
  const findings = [];
  for (const story of stories) {
    for (const criterion of story.acceptance ?? []) {
      const then = String(criterion.then ?? '');
      const behaviour = UI_CHECKLIST_TEST.test(criterion.test_id ?? '') ? then.match(BEHAVIOUR_PATTERN) : null;
      if (behaviour) {
        findings.push(finding('PLAN_AC_UI_CHECKLIST_FOR_BEHAVIOUR', { story: story.id, criterion: criterion.id, test: criterion.test_id, word: behaviour[0].toLowerCase() }));
      }
      for (const { phrase, pattern, exempt } of SOFT_PHRASES) {
        if (pattern.test(then) && !(exempt && exempt.test(then))) {
          findings.push(finding('PLAN_AC_SOFT', { story: story.id, criterion: criterion.id, phrase }));
        }
      }
    }
  }
  return findings;
}

// A test no story cites is dead weight in the plan: it is never scheduled, so nobody would run it.
function checkTestUsage(model, stories) {
  const used = new Set(stories.flatMap((story) => [
    ...(story.acceptance ?? []).map((criterion) => criterion.test_id),
    ...(story.tasks ?? []).flatMap((task) => task.test_ids ?? []),
  ]));
  return model.tests.filter((test) => !used.has(test.id)).map((test) => finding('PLAN_TEST_UNUSED', { test: test.id }, 'warning'));
}

const RELEASE_ORDER = new Map(RELEASES.map((release, index) => [release, index]));

function coverage(stories, field) {
  return new Set(stories.flatMap((story) => story[field] ?? []));
}

function uncovered(known, covered, code, key) {
  return [...known].filter((item) => !covered.has(item)).map((item) => finding(code, { [key]: item }));
}

function unknownRefs(stories, field, known, code, key) {
  return stories.flatMap((story) =>
    (story[field] ?? []).filter((item) => !known.has(item)).map((item) => finding(code, { story: story.id, [key]: item })),
  );
}

function checkDuplicates(model, stories) {
  const seen = new Set();
  const findings = [];
  for (const id of [...model.plan.epics, ...model.plan.features, ...stories].map((record) => record.id)) {
    if (seen.has(id)) findings.push(finding('PLAN_DUPLICATE_ID', { id }));
    seen.add(id);
  }
  return findings;
}

function checkStoryShape(model, story, writeOperations) {
  const findings = [];
  const testIds = new Set(model.tests.map((test) => test.id));
  const epics = new Set(model.plan.epics.map((epic) => epic.id));
  const features = new Set(model.plan.features.map((feature) => feature.id));
  const { min, max } = story.review?.hours ?? {};

  if (!RELEASE_ORDER.has(story.release)) findings.push(finding('PLAN_RELEASE_INVALID', { story: story.id, release: story.release }));
  if (!epics.has(story.epic)) findings.push(finding('PLAN_UNKNOWN_EPIC', { story: story.id, epic: story.epic }));
  if (!features.has(story.feature)) findings.push(finding('PLAN_UNKNOWN_FEATURE', { story: story.id, feature: story.feature }));
  if (!(story.acceptance ?? []).length) findings.push(finding('PLAN_STORY_NO_ACCEPTANCE', { story: story.id }));
  for (const criterion of story.acceptance ?? []) {
    if (!testIds.has(criterion.test_id)) findings.push(finding('PLAN_UNKNOWN_TEST', { story: story.id, test: criterion.test_id }));
  }
  const qaTasks = (story.tasks ?? []).filter((task) => task.kind === 'qa' && (task.test_ids ?? []).length > 0);
  if (qaTasks.length === 0) findings.push(finding('PLAN_STORY_NO_QA_TASK', { story: story.id }));
  for (const task of story.tasks ?? []) {
    for (const test of task.test_ids ?? []) {
      if (!testIds.has(test)) findings.push(finding('PLAN_UNKNOWN_TEST', { story: story.id, test }));
    }
  }
  for (const item of story.review?.required ?? []) {
    if (!REVIEW_ITEMS.includes(item)) findings.push(finding('PLAN_REVIEW_ITEM_UNKNOWN', { story: story.id, item }));
  }
  if (!(Number.isFinite(min) && Number.isFinite(max) && min >= 0 && min <= max)) {
    findings.push(finding('PLAN_REVIEW_HOURS_INVALID', { story: story.id }));
    return findings;
  }
  const required = story.review?.required ?? [];
  if (required.length > 0) {
    const floor = reviewFloor(required);
    if (max < floor || min <= 0) findings.push(finding('PLAN_REVIEW_BELOW_FLOOR', { story: story.id, floor, min, max }));
  } else {
    const writes = (story.operations ?? []).filter((operation) => writeOperations.has(operation));
    if (writes.length > 0) findings.push(finding('PLAN_REVIEW_CLASS_MISSING', { story: story.id, operations: writes }));
  }
  return findings;
}

function checkDependencies(stories) {
  const byId = new Map(stories.map((story) => [story.id, story]));
  const findings = [];
  for (const story of stories) {
    for (const dependency of story.dependencies ?? []) {
      const target = byId.get(dependency);
      if (!target) {
        findings.push(finding('PLAN_DEPENDENCY_UNKNOWN', { story: story.id, dependency }));
      } else if (RELEASE_ORDER.get(target.release) > RELEASE_ORDER.get(story.release)) {
        findings.push(finding('PLAN_DEPENDENCY_LATER_RELEASE', { story: story.id, dependency, release: target.release }));
      }
    }
  }
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'active') {
      findings.push(finding('PLAN_DEPENDENCY_CYCLE', { story: id, cycle: [...trail, id].join(' > ') }));
      return;
    }
    state.set(id, 'active');
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency)) visit(dependency, [...trail, id]);
    state.set(id, 'done');
  };
  for (const story of stories) visit(story.id, []);
  return findings;
}

export function checkPlan(model) {
  if (!model.plan) return [];
  const stories = model.plan.stories;
  const screens = new Set(model.screens.map((screen) => screen.id));
  const operations = new Set(listOperations(model.openapi).map(({ operation }) => operation.operationId));
  const tables = new Set(parseSql(model.sql).tables.keys());
  const writeOperations = new Set(listOperations(model.openapi).filter(({ method }) => WRITE_METHODS.has(method)).map(({ operation }) => operation.operationId));
  const cxn = new Set((model.legalLedger ?? []).map((row) => row.id));

  return [
    ...checkDuplicates(model, stories),
    ...stories.flatMap((story) => checkStoryShape(model, story, writeOperations)),
    ...checkDependencies(stories),
    ...checkAcceptanceEvidence(stories),
    ...checkTestUsage(model, stories),
    ...uncovered(screens, coverage(stories, 'screens'), 'PLAN_SCREEN_UNCOVERED', 'screen'),
    ...uncovered(operations, coverage(stories, 'operations'), 'PLAN_OPERATION_UNCOVERED', 'operation'),
    ...uncovered(tables, coverage(stories, 'tables'), 'PLAN_TABLE_UNCOVERED', 'table'),
    ...unknownRefs(stories, 'screens', screens, 'PLAN_UNKNOWN_SCREEN', 'screen'),
    ...unknownRefs(stories, 'operations', operations, 'PLAN_UNKNOWN_OPERATION', 'operation'),
    ...unknownRefs(stories, 'tables', tables, 'PLAN_UNKNOWN_TABLE', 'table'),
    ...uncovered(new Set((model.nonFunctional ?? []).map((nfr) => nfr.id)), coverage(stories, 'nfr'), 'PLAN_NFR_UNCOVERED', 'nfr'),
    ...unknownRefs(stories, 'nfr', new Set((model.nonFunctional ?? []).map((nfr) => nfr.id)), 'PLAN_UNKNOWN_NFR', 'nfr'),
    ...(model.legalLedger ? unknownRefs(stories, 'cxn', cxn, 'PLAN_UNKNOWN_CXN', 'cxn') : []),
  ];
}

// Longest chain of dependent stories, weighted by maximum agent hours: the schedule driver.
export function criticalPath(stories) {
  const byId = new Map(stories.map((story) => [story.id, story]));
  const memo = new Map();
  const longest = (id) => {
    if (memo.has(id)) return memo.get(id);
    const story = byId.get(id);
    const own = story.effort?.agent_hours?.max ?? 0;
    let best = { hours: own, path: [id] };
    for (const dependency of story.dependencies ?? []) {
      if (!byId.has(dependency)) continue;
      const via = longest(dependency);
      if (via.hours + own > best.hours) best = { hours: via.hours + own, path: [...via.path, id] };
    }
    memo.set(id, best);
    return best;
  };
  return stories.map((story) => longest(story.id)).reduce((a, b) => (b.hours > a.hours ? b : a), { hours: 0, path: [] });
}

// Weeks of human review capacity needed per release for each reviewer-count scenario.
export function reviewScenarios(stories, { reviewers, hoursPerWeek }) {
  const weeks = (hours, count) => (hours === 0 ? 0 : Math.ceil(hours / (count * hoursPerWeek)));
  return RELEASES.map((release) => {
    const inRelease = stories.filter((story) => story.release === release);
    const hours = {
      min: inRelease.reduce((total, story) => total + (story.review?.hours?.min ?? 0), 0),
      max: inRelease.reduce((total, story) => total + (story.review?.hours?.max ?? 0), 0),
    };
    return { release, hours, weeks: reviewers.map((count) => ({ reviewers: count, min: weeks(hours.min, count), max: weeks(hours.max, count) })) };
  });
}
