import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan, criticalPath, reviewScenarios, RELEASES, REVIEW_ITEMS } from '../src/plan.mjs';
import { validModel } from './fixtures.mjs';

function story(overrides = {}) {
  return {
    id: 'ST-IAM-001',
    epic: 'EP-IAM',
    feature: 'FT-IAM-01',
    title: 'Sign in with MFA',
    release: 'R0',
    module: 'IAM',
    screens: ['IAM-01'],
    operations: ['post_reports_id_submit'],
    tables: ['project'],
    acceptance: [{ id: 'AC-ST-IAM-001-1', given: 'a valid user', when: 'signs in', then: 'a session exists', test_id: 'UI-IAM-01' }],
    dependencies: [],
    review: { required: ['authorization'], hours: { min: 2, max: 4 } },
    effort: { agent_hours: { min: 4, max: 10 }, confidence: 'medium' },
    cxn: [],
    nfr: ['NFR-SEC-01'],
    tasks: [
      { id: 'TK-IAM-001-1', kind: 'backend', title: 'Session command' },
      { id: 'TK-IAM-001-2', kind: 'qa', title: 'Sign-in tests', test_ids: ['UI-IAM-01'] },
    ],
    ...overrides,
  };
}

function planModel(stories, extra = {}) {
  const model = validModel();
  // The two fixture screens: IAM-01 and DIS-01; operations: post_reports_id_submit, get_resources_project.
  model.plan = {
    epics: [{ id: 'EP-IAM', module: 'IAM', title: 'Identity' }, { id: 'EP-DIS', module: 'DIS', title: 'Reports' }],
    features: [{ id: 'FT-IAM-01', epic: 'EP-IAM', title: 'Sign in' }, { id: 'FT-DIS-01', epic: 'EP-DIS', title: 'Weekly report' }],
    stories,
    ...extra,
  };
  return model;
}

const full = () => [
  story(),
  story({ id: 'ST-DIS-001', epic: 'EP-DIS', feature: 'FT-DIS-01', module: 'DIS', screens: ['DIS-01'], operations: ['get_resources_project'], tables: ['tenant'], dependencies: ['ST-IAM-001'], release: 'R1',
    acceptance: [{ id: 'AC-ST-DIS-001-1', given: 'g', when: 'w', then: 't', test_id: 'UI-DIS-01' }],
    tasks: [{ id: 'TK-DIS-001-1', kind: 'qa', title: 'Report tests', test_ids: ['UI-DIS-01'] }] }),
];
const codes = (findings) => findings.map((f) => f.code).sort();

test('a complete plan produces no findings', () => {
  assert.deepEqual(checkPlan(planModel(full())), []);
});

test('the check is skipped when no plan is loaded', () => {
  assert.deepEqual(checkPlan(validModel()), []);
});

test('screens, operations and tables not covered by any story are reported', () => {
  const model = planModel([full()[0]]);
  assert.deepEqual(codes(checkPlan(model)), ['PLAN_OPERATION_UNCOVERED', 'PLAN_SCREEN_UNCOVERED', 'PLAN_TABLE_UNCOVERED']);
});

test('unknown references in a story are reported', () => {
  const bad = story({ screens: ['NOPE-1'], operations: ['no_such_op'], tables: ['no_table'], tasks: [{ id: 'TK-1', kind: 'qa', title: 'x', test_ids: ['T-NOPE'] }], acceptance: [{ id: 'AC-1', given: 'g', when: 'w', then: 't', test_id: 'T-MISSING' }] });
  const model = planModel([bad, full()[1]]);
  const found = codes(checkPlan(model));
  assert.ok(found.includes('PLAN_UNKNOWN_SCREEN'));
  assert.ok(found.includes('PLAN_UNKNOWN_OPERATION'));
  assert.ok(found.includes('PLAN_UNKNOWN_TABLE'));
  assert.ok(found.includes('PLAN_UNKNOWN_TEST'));
});

test('structure rules: acceptance criteria, QA task, review hours, release, epic and feature links', () => {
  const broken = story({ acceptance: [], tasks: [{ id: 'TK-1', kind: 'backend', title: 'only code' }], review: { required: ['money'], hours: { min: 5, max: 2 } }, release: 'R9', epic: 'EP-NONE', feature: 'FT-NONE' });
  const found = codes(checkPlan(planModel([broken, full()[1]])));
  for (const code of ['PLAN_STORY_NO_ACCEPTANCE', 'PLAN_STORY_NO_QA_TASK', 'PLAN_REVIEW_HOURS_INVALID', 'PLAN_RELEASE_INVALID', 'PLAN_UNKNOWN_EPIC', 'PLAN_UNKNOWN_FEATURE']) {
    assert.ok(found.includes(code), `${code} missing from ${found}`);
  }
});

test('dependencies must exist, be acyclic and never point to a later release', () => {
  const a = story({ dependencies: ['ST-DIS-001'] });
  const b = full()[1];
  const cyc = codes(checkPlan(planModel([a, b])));
  assert.ok(cyc.includes('PLAN_DEPENDENCY_CYCLE'));
  const unknown = codes(checkPlan(planModel([story({ dependencies: ['ST-GHOST'] }), b])));
  assert.ok(unknown.includes('PLAN_DEPENDENCY_UNKNOWN'));
  const later = codes(checkPlan(planModel([story({ release: 'R1' }), { ...b, release: 'R0', dependencies: ['ST-IAM-001'] }])));
  assert.ok(later.includes('PLAN_DEPENDENCY_LATER_RELEASE'));
});

test('a story using an unconfirmed legal item must declare the gate and duplicate ids are reported', () => {
  const gated = story({ cxn: ['CXN-99'] });
  const model = planModel([gated, full()[1]]);
  model.legalLedger = [{ id: 'CXN-99', status: 'AWAITING_CONFIRMATION' }];
  assert.deepEqual(checkPlan(model), [], 'declared CXN dependencies are allowed while awaiting confirmation');
  model.legalLedger = [];
  assert.ok(codes(checkPlan(model)).includes('PLAN_UNKNOWN_CXN'));
  assert.ok(codes(checkPlan(planModel([full()[0], full()[0], full()[1]]))).includes('PLAN_DUPLICATE_ID'));
});

test('criticalPath returns the longest dependency chain weighted by maximum agent hours', () => {
  const stories = [
    story({ id: 'A', dependencies: [], effort: { agent_hours: { min: 1, max: 4 }, confidence: 'high' } }),
    story({ id: 'B', dependencies: ['A'], effort: { agent_hours: { min: 1, max: 6 }, confidence: 'high' } }),
    story({ id: 'C', dependencies: ['A'], effort: { agent_hours: { min: 1, max: 2 }, confidence: 'high' } }),
    story({ id: 'D', dependencies: ['B', 'C'], effort: { agent_hours: { min: 1, max: 3 }, confidence: 'high' } }),
  ];
  const result = criticalPath(stories);
  assert.deepEqual(result.path, ['A', 'B', 'D']);
  assert.equal(result.hours, 13);
});

test('releases are R0 to R4', () => {
  assert.deepEqual(RELEASES, ['R0', 'R1', 'R2', 'R3', 'R4']);
});

test('every non-functional requirement must be covered by a story and references must exist', () => {
  const model = planModel(full());
  model.nonFunctional = [{ id: 'NFR-SEC-01', controls: ['RLS'], test_ids: ['UI-IAM-01'] }, { id: 'NFR-OPS-01', controls: ['restore'], test_ids: ['UAT-AC01'] }];
  model.plan.stories.forEach((item) => { item.nfr = []; });
  assert.deepEqual(codes(checkPlan(model)), ['PLAN_NFR_UNCOVERED', 'PLAN_NFR_UNCOVERED']);
  model.plan.stories[0].nfr = ['NFR-SEC-01', 'NFR-OPS-01', 'NFR-GHOST'];
  assert.deepEqual(codes(checkPlan(model)), ['PLAN_UNKNOWN_NFR']);
});

test('human review items must come from the canonical vocabulary', () => {
  assert.deepEqual(REVIEW_ITEMS, ['money', 'authorization', 'tenant-isolation', 'migration', 'legal-template', 'legal-rule', 'ai-decision', 'privacy', 'security']);
  const model = planModel([story({ review: { required: ['money', 'ai_decision', 'legal'], hours: { min: 1, max: 2 } } }), full()[1]]);
  const findings = checkPlan(model).filter((f) => f.code === 'PLAN_REVIEW_ITEM_UNKNOWN');
  assert.deepEqual(findings.map((f) => f.params.item).sort(), ['ai_decision', 'legal']);
});

test('reviewScenarios turns review hours into weeks of human capacity per release', () => {
  const stories = [
    { release: 'R0', review: { hours: { min: 10, max: 25 } } },
    { release: 'R0', review: { hours: { min: 10, max: 15 } } },
    { release: 'R1', review: { hours: { min: 1, max: 3 } } },
  ];
  const result = reviewScenarios(stories, { reviewers: [1, 2], hoursPerWeek: 10 });
  const r0 = result.find((row) => row.release === 'R0');
  assert.deepEqual(r0.hours, { min: 20, max: 40 });
  assert.deepEqual(r0.weeks, [{ reviewers: 1, min: 2, max: 4 }, { reviewers: 2, min: 1, max: 2 }]);
  const r1 = result.find((row) => row.release === 'R1');
  assert.deepEqual(r1.weeks, [{ reviewers: 1, min: 1, max: 1 }, { reviewers: 2, min: 1, max: 1 }]);
  assert.deepEqual(result.find((row) => row.release === 'R4').weeks, [{ reviewers: 1, min: 0, max: 0 }, { reviewers: 2, min: 0, max: 0 }]);
});
