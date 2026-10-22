import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan, criticalPath, reviewScenarios, reviewFloor, RELEASES, REVIEW_ITEMS, REVIEW_FLOORS } from '../src/plan.mjs';
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
      { id: 'TK-IAM-001-2', kind: 'qa', title: 'Sign-in tests', test_ids: ['UI-IAM-01', 'UAT-AC01'] },
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
  assert.deepEqual(codes(checkPlan(model)), ['PLAN_OPERATION_UNCOVERED', 'PLAN_SCREEN_UNCOVERED', 'PLAN_TABLE_UNCOVERED', 'PLAN_TEST_UNUSED']);
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

test('the floor table covers every review item and caps the combined floor', () => {
  assert.deepEqual(Object.keys(REVIEW_FLOORS.items).sort(), [...REVIEW_ITEMS].sort());
  assert.deepEqual(REVIEW_FLOORS.items, { money: 1.5, 'tenant-isolation': 2, authorization: 1, migration: 1, 'legal-template': 1, 'legal-rule': 1, 'ai-decision': 1, security: 1, privacy: 0.5 });
  assert.equal(REVIEW_FLOORS.sumCap, 8);
});

test('reviewFloor sums the floors of the declared items up to the cap and ignores unknown items', () => {
  assert.equal(reviewFloor([]), 0);
  assert.equal(reviewFloor(['money']), 1.5);
  assert.equal(reviewFloor(['money', 'tenant-isolation', 'privacy']), 4);
  assert.equal(reviewFloor(['money', 'ghost']), 1.5);
  assert.equal(reviewFloor(REVIEW_ITEMS), 8);
});

test('review hours below the floor of the declared items are reported', () => {
  const low = story({ review: { required: ['money'], hours: { min: 0.5, max: 1 } } });
  const found = checkPlan(planModel([low, full()[1]])).filter((f) => f.code === 'PLAN_REVIEW_BELOW_FLOOR');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].params, { story: 'ST-IAM-001', floor: 1.5, min: 0.5, max: 1 });
  const several = story({ review: { required: ['money', 'tenant-isolation'], hours: { min: 1, max: 3 } } });
  assert.ok(codes(checkPlan(planModel([several, full()[1]]))).includes('PLAN_REVIEW_BELOW_FLOOR'), 'sum floor 3.5 > max 3');
  const ok = story({ review: { required: ['money', 'tenant-isolation'], hours: { min: 1, max: 3.5 } } });
  assert.deepEqual(checkPlan(planModel([ok, full()[1]])), []);
});

test('a required review needs a minimum above zero', () => {
  const zero = story({ review: { required: ['authorization'], hours: { min: 0, max: 2 } } });
  assert.ok(codes(checkPlan(planModel([zero, full()[1]]))).includes('PLAN_REVIEW_BELOW_FLOOR'));
});

test('invalid hours are reported once and not as below the floor', () => {
  const broken = story({ review: { required: ['money'], hours: { min: 5, max: 1 } } });
  const found = codes(checkPlan(planModel([broken, full()[1]])));
  assert.ok(found.includes('PLAN_REVIEW_HOURS_INVALID'));
  assert.ok(!found.includes('PLAN_REVIEW_BELOW_FLOOR'));
});

test('a story that calls a write operation must declare a review class, read-only stories may not', () => {
  const writer = story({ review: { required: [], hours: { min: 0, max: 0 } } });
  const found = checkPlan(planModel([writer, full()[1]])).filter((f) => f.code === 'PLAN_REVIEW_CLASS_MISSING');
  assert.deepEqual(found.map((f) => f.params), [{ story: 'ST-IAM-001', operations: ['post_reports_id_submit'] }]);
  const readOnly = { ...full()[1], review: { required: [], hours: { min: 0, max: 0 } } };
  assert.deepEqual(checkPlan(planModel([full()[0], readOnly])), []);
});

// Acceptance-evidence quality: a UI checklist cannot prove behaviour, soft wording cannot be measured,
// and every test must be used by some story.

function withCriterion(then, test_id = 'UI-IAM-01', extra = {}) {
  const base = story({ acceptance: [{ id: 'AC-ST-IAM-001-1', given: 'g', when: 'w', then, test_id }], ...extra });
  return planModel([base, full()[1]]);
}
const findingsOf = (model, code) => checkPlan(model).filter((f) => f.code === code);

test('a UI checklist test cannot be the evidence of a behavioural criterion', () => {
  for (const then of [
    '422 BOQ_TOTAL_MISMATCH', 'cross-tenant ids return 404', 'the ledger entry is reversed', 'one audit row is written',
    'the event is emitted once', 'the retry is idempotent', 'the task is DONE', 'the request is approved', 'the draft is rejected',
    'amount_vnd is 3,704', 'the total is 5,000 VND', 'status moves to SENT', 'it is refused', 'no duplicate rows are created',
    'the row is stored', 'a row is created', 'nothing is queued', 'it is written in one transaction', 'MFA is enforced', 'the value is unchanged', 'the flag sets ACCEPTED',
  ]) {
    const found = findingsOf(withCriterion(then), 'PLAN_AC_UI_CHECKLIST_FOR_BEHAVIOUR');
    assert.equal(found.length, 1, then);
    assert.deepEqual(Object.keys(found[0].params).sort(), ['criterion', 'story', 'test', 'word']);
    assert.equal(found[0].params.criterion, 'AC-ST-IAM-001-1');
    assert.equal(found[0].params.test, 'UI-IAM-01');
    assert.equal(found[0].severity, 'error');
  }
});

test('a UI checklist test stays valid evidence for pure rendering criteria and specific tests for behaviour', () => {
  assert.deepEqual(findingsOf(withCriterion('the seven UI states render and the screen contract checks of UI-IAM-01 report 0 failures'), 'PLAN_AC_UI_CHECKLIST_FOR_BEHAVIOUR'), []);
  assert.deepEqual(findingsOf(withCriterion('422 BOQ_TOTAL_MISMATCH', 'UAT-AC01'), 'PLAN_AC_UI_CHECKLIST_FOR_BEHAVIOUR'), []);
  assert.deepEqual(findingsOf(withCriterion('the statuses and the restored values are shown', 'UI-IAM-01'), 'PLAN_AC_UI_CHECKLIST_FOR_BEHAVIOUR').map((f) => f.params.word), ['status']);
});

test('soft wording in a criterion is reported from a closed list of phrases', () => {
  for (const [then, phrase] of [
    ['the page works', 'works'],
    ['figures within the agreed target', 'agreed'],
    ['an appropriate message is shown', 'appropriate'],
    ['the result is as expected', 'as expected'],
    ['the form is saved properly', 'properly'],
    ['the screen renders and screen contracts pass', 'screen contracts pass'],
    ['no screen-contract check fails', 'screen contracts pass'],
    ['the totals are correct', 'correct'],
    ['totals are computed correctly', 'correct'],
    ['numbers match within tolerance', 'within tolerance'],
    ['numbers match within the signed tolerance', 'within tolerance'],
  ]) {
    const found = findingsOf(withCriterion(then, 'UAT-AC01'), 'PLAN_AC_SOFT');
    assert.equal(found.length, 1, then);
    assert.equal(found[0].params.phrase, phrase, then);
    assert.equal(found[0].params.criterion, 'AC-ST-IAM-001-1');
    assert.equal(found[0].severity, 'error');
  }
});

test('measurable wording passes: numbers or codes next to correct and tolerance, and a correction is not soft', () => {
  for (const then of [
    'the totals are correct to 0 VND difference',
    'the correct code SCOPE_DENIED is returned',
    'numbers match within 0.5% tolerance',
    'numbers match within tolerance of 2 VND',
    'a correction after lock creates a new revision',
    'the seven UI states render and the screen contract checks of UI-IAM-01 report 0 failures',
  ]) {
    assert.deepEqual(findingsOf(withCriterion(then, 'UAT-AC01'), 'PLAN_AC_SOFT'), [], then);
  }
});

test('a test used by no story criterion or QA task is reported as a warning', () => {
  const model = planModel(full());
  model.plan.stories[0].tasks[1].test_ids = ['UI-IAM-01'];
  model.tests.push({ id: 'UAT-AC99', priority: 'P1', steps: ['x'], expected: 'y' });
  const found = findingsOf(model, 'PLAN_TEST_UNUSED');
  assert.deepEqual(found.map((f) => f.params), [{ test: 'UAT-AC01' }, { test: 'UAT-AC99' }]);
  assert.ok(found.every((f) => f.severity === 'warning'));
  model.plan.stories[0].tasks[1].test_ids.push('UAT-AC01');
  model.plan.stories[1].acceptance[0].test_id = 'UAT-AC99';
  model.plan.stories[1].tasks[0].test_ids.push('UAT-AC99');
  assert.deepEqual(findingsOf(model, 'PLAN_TEST_UNUSED'), []);
});

test('the new plan findings have a message in each locale', async () => {
  const { loadMessages } = await import('../src/i18n.mjs');
  for (const locale of ['en', 'vi']) {
    const messages = loadMessages(locale);
    for (const key of ['check.finding.planAcUiChecklistForBehaviour', 'check.finding.planAcSoft', 'check.finding.planTestUnused']) {
      assert.ok(messages[key], `${locale} misses ${key}`);
    }
  }
});
