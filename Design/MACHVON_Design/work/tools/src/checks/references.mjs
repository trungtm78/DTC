// Shared lookups over the requirement graph so every check agrees on what "covered" means.

export function requirementIds(model) {
  return new Set([
    ...model.trace.map((row) => row.requirement),
    ...(model.nonFunctional ?? []).map((row) => row.id),
  ]);
}

export function testReferenceSources(model) {
  return [
    ...model.trace.map((row) => ({ from: row.requirement, ids: row.test_ids ?? [] })),
    ...model.backlog.map((row) => ({ from: row.id, ids: row.test_ids ?? [] })),
    ...(model.nonFunctional ?? []).map((row) => ({ from: row.id, ids: row.test_ids ?? [] })),
  ];
}

export function testsCoveringRequirement(model, requirement) {
  const testIds = new Set(model.tests.map((t) => t.id));
  const fromRows = [
    ...model.trace.filter((row) => row.requirement === requirement),
    ...(model.nonFunctional ?? []).filter((row) => row.id === requirement),
  ].flatMap((row) => row.test_ids ?? []);
  const fromTests = model.tests.filter((t) => (t.covers ?? []).includes(requirement)).map((t) => t.id);
  return [...fromRows, ...fromTests].filter((id) => testIds.has(id));
}
