import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNavigation } from '../src/checks/navigation.mjs';
import { runChecks } from '../src/checks/index.mjs';
import { loadModel, ENGINEERING_FILES } from '../src/model.mjs';
import { loadMessages, translate } from '../src/i18n.mjs';
import { validModel, codes } from './fixtures.mjs';

function modelWithNavigation() {
  const model = validModel();
  model.screens.push({ id: 'MOB-07', module: 'MOB', req: 'FR-MOB-07', platform: 'mobile' });
  model.navigation = {
    webRoutes: [{ id: 'IAM-01' }, { id: 'DIS-01' }],
    mobileRoutes: [{ id: 'MOB-07' }],
  };
  return model;
}

test('a model without a navigation file is not checked', () => {
  assert.deepEqual(checkNavigation(validModel()), []);
});

test('a navigation that covers every screen produces no findings', () => {
  assert.deepEqual(checkNavigation(modelWithNavigation()), []);
});

test('web and mobile screens without a route are reported with their platform', () => {
  const model = modelWithNavigation();
  model.navigation.webRoutes = [{ id: 'IAM-01' }];
  model.navigation.mobileRoutes = [];
  const findings = checkNavigation(model);
  assert.deepEqual(codes(findings), ['NAV_ROUTE_MISSING', 'NAV_ROUTE_MISSING']);
  assert.deepEqual(findings.map((item) => item.params), [
    { screen: 'DIS-01', platform: 'web' },
    { screen: 'MOB-07', platform: 'mobile' },
  ]);
});

test('routes that point at no catalogued screen of their platform are reported', () => {
  const model = modelWithNavigation();
  model.navigation.webRoutes.push({ id: 'XXX-99' }, { id: 'MOB-07' });
  model.navigation.mobileRoutes.push({ id: 'IAM-01' });
  const findings = checkNavigation(model);
  assert.deepEqual(codes(findings), ['NAV_ROUTE_UNKNOWN', 'NAV_ROUTE_UNKNOWN', 'NAV_ROUTE_UNKNOWN']);
  assert.deepEqual(findings.map((item) => item.params.screen), ['XXX-99', 'MOB-07', 'IAM-01']);
});

test('runChecks includes the navigation check', () => {
  const model = modelWithNavigation();
  model.navigation.webRoutes = [{ id: 'IAM-01' }];
  assert.ok(codes(runChecks(model)).includes('NAV_ROUTE_MISSING'));
});

test('both locales explain the navigation findings', () => {
  for (const locale of ['en', 'vi']) {
    const messages = loadMessages(locale);
    for (const code of ['check.finding.navRouteMissing', 'check.finding.navRouteUnknown']) {
      const text = translate(messages, code, { screen: 'DIS-01', platform: 'web' });
      assert.notEqual(text, code, `${locale} misses ${code}`);
      assert.match(text, /DIS-01/);
    }
  }
});

test('loadModel reads navigation_architecture.json when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-nav-'));
  const model = validModel();
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  write(ENGINEERING_FILES.screens, model.screens);
  write(ENGINEERING_FILES.backlog, model.backlog);
  write(ENGINEERING_FILES.trace, model.trace);
  write(ENGINEERING_FILES.tests, model.tests);
  write(ENGINEERING_FILES.openapi, model.openapi);
  write(ENGINEERING_FILES.dictionary, { entities: model.entities });
  write(ENGINEERING_FILES.sql, model.sql);
  assert.equal(loadModel(dir).navigation, undefined);
  write(ENGINEERING_FILES.navigation, { webRoutes: [{ id: 'IAM-01' }], mobileRoutes: [] });
  assert.deepEqual(loadModel(dir).navigation.webRoutes, [{ id: 'IAM-01' }]);
});
