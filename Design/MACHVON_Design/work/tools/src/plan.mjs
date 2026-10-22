import { finding } from './checks/finding.mjs';
import { listOperations } from './checks/openapi.mjs';
import { parseSql } from './sql.mjs';

// Implementation plan: epic -> feature -> story (a demonstrable vertical slice) -> technical and QA
// tasks. Completeness is checked against the single-source design data so nothing is left unplanned.

export const RELEASES = ['R0', 'R1', 'R2', 'R3', 'R4'];
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

function checkStoryShape(model, story) {
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
  if (!(Number.isFinite(min) && Number.isFinite(max) && min >= 0 && min <= max)) {
    findings.push(finding('PLAN_REVIEW_HOURS_INVALID', { story: story.id }));
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
  const cxn = new Set((model.legalLedger ?? []).map((row) => row.id));

  return [
    ...checkDuplicates(model, stories),
    ...stories.flatMap((story) => checkStoryShape(model, story)),
    ...checkDependencies(stories),
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
