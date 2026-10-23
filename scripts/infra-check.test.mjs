import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDING_CODES, infraCheck, main } from './infra-check.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The tiny plan knows every story the real components name, plus two of its own.
const REAL_STORIES = readdirSync(join(REPO_ROOT, 'infra', 'components')).flatMap((file) => JSON.parse(readFileSync(join(REPO_ROOT, 'infra', 'components', file), 'utf8')).firstStories);
const PLAN = { stories: [...new Set([...REAL_STORIES, 'ST-A', 'ST-B'])].map((id) => ({ id })) };

const cleanups = [];

// A scratch repository: the real infra/ and its runbooks, a tiny plan, and the edits of one case applied on top.
function scratch(edit = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-infra-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(REPO_ROOT, 'infra'), join(root, 'infra'), { recursive: true });
  if (existsSync(join(REPO_ROOT, 'docs', 'runbooks', 'infra'))) {
    cpSync(join(REPO_ROOT, 'docs', 'runbooks', 'infra'), join(root, 'docs', 'runbooks', 'infra'), { recursive: true });
  }
  const planPath = join(root, 'plan.json');
  writeFileSync(planPath, JSON.stringify(PLAN));
  const api = {
    root,
    planPath,
    json(path, change) {
      const file = join(root, path);
      const value = JSON.parse(readFileSync(file, 'utf8'));
      const next = change(value) ?? value;
      writeFileSync(file, JSON.stringify(next, null, 2));
    },
    text(path, change) {
      const file = join(root, path);
      writeFileSync(file, change(readFileSync(file, 'utf8')));
    },
    write(path, content) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    },
  };
  edit(api);
  return api;
}

process.on('exit', () => cleanups.forEach((clean) => clean()));

const codesOf = (result) => result.findings.map((entry) => entry.code);
const run = (s) => infraCheck(s.root, { planPath: s.planPath });

test('the real infra directory passes and every component is planned, none entered', () => {
  const result = infraCheck(REPO_ROOT);
  assert.deepEqual(result.findings, []);
  assert.equal(result.components.length, 8);
  assert.ok(result.components.every((component) => component.state === 'PLANNED' && component.entered === false));
});

test('a resource outside Vietnam is reported with the resource and its environment', () => {
  const s = scratch((api) => api.json('infra/environments/production.json', (env) => { env.resources[0].region = 'SG-1'; }));
  const result = run(s);
  assert.deepEqual(codesOf(result), ['RESIDENCY_REGION']);
  assert.match(result.findings[0].detail, /pg-primary/);
  assert.match(result.findings[0].file, /production\.json$/);
});

test('a replica, a log sink and a telemetry endpoint outside Vietnam are each reported', () => {
  const s = scratch((api) =>
    api.json('infra/environments/staging.json', (env) => {
      env.resources.find((r) => r.id === 'objects').replicaRegion = 'US-EAST-1';
      env.resources.find((r) => r.id === 'log-sink').region = 'EU-WEST-1';
      env.resources.find((r) => r.id === 'telemetry').region = 'AP-SOUTH-1';
    }),
  );
  const details = run(s).findings.map((entry) => entry.detail).join(' ');
  assert.match(details, /objects/);
  assert.match(details, /log-sink/);
  assert.match(details, /telemetry/);
});

test('a backup target in the same region as the primary, or none at all, is a missing second site', () => {
  const same = scratch((api) => api.json('infra/environments/production.json', (env) => { env.resources.find((r) => r.id === 'pg-wal-archive').region = 'VN-HAN-1'; }));
  assert.deepEqual(codesOf(run(same)), ['SECOND_SITE_MISSING']);
  const none = scratch((api) => api.json('infra/environments/dr.json', (env) => { env.resources = env.resources.filter((r) => r.role !== 'backup-target'); }));
  assert.deepEqual(codesOf(run(none)), ['SECOND_SITE_MISSING']);
});

test('an egress endpoint outside Vietnam is refused unless it carries only PUBLIC data and an approved transfer assessment', () => {
  const internal = scratch((api) => api.json('infra/environments/production.json', (env) => { env.egress.push({ id: 'ai', host: 'api.openai.com', dataClasses: ['INTERNAL'] }); }));
  assert.deepEqual(codesOf(run(internal)), ['EGRESS_HOST']);
  const publicOnly = scratch((api) => api.json('infra/environments/production.json', (env) => { env.egress.push({ id: 'ai', host: 'api.example.com', dataClasses: ['PUBLIC'] }); }));
  assert.deepEqual(codesOf(run(publicOnly)), ['EGRESS_HOST']);
  const assessed = scratch((api) => api.json('infra/environments/production.json', (env) => { env.egress.push({ id: 'ai', host: 'api.example.com', dataClasses: ['PUBLIC'], transferAssessment: 'TA-2026-001' }); }));
  assert.deepEqual(codesOf(run(assessed)), []);
});

test('credentials, key and realm names must not be shared by two environments', () => {
  for (const key of ['credentials', 'kmsKey', 'keycloakRealm']) {
    const s = scratch((api) => {
      const staging = JSON.parse(readFileSync(join(api.root, 'infra/environments/staging.json'), 'utf8'));
      api.json('infra/environments/production.json', (env) => { env[key] = staging[key]; });
    });
    const result = run(s);
    assert.ok(codesOf(result).includes('ENV_SHARED'), key);
    assert.match(result.findings.find((f) => f.code === 'ENV_SHARED').detail, new RegExp(key));
  }
});

test('real data below production is refused, masked refreshes need the masked flag', () => {
  const real = scratch((api) => api.json('infra/environments/staging.json', (env) => { env.dataClass = 'real'; }));
  assert.deepEqual(codesOf(run(real)), ['PRODUCTION_DATA_BELOW']);
  const unmasked = scratch((api) => api.json('infra/environments/staging.json', (env) => { env.maskedRefresh.masked = false; }));
  assert.deepEqual(codesOf(run(unmasked)), ['PRODUCTION_DATA_BELOW']);
});

function entered(api, name, change = () => {}) {
  api.json(`infra/components/${name}.json`, (component) => {
    component.state = 'IN_USE';
    component.restoreEvidence = { path: `docs/runbooks/infra/evidence/${name}.md`, verifiedVersion: component.version, restoredAt: '2026-10-24' };
    change(component);
  });
  api.write(`docs/runbooks/infra/evidence/${name}.md`, '# Restore evidence\n');
}

test('the entry gate passes when the runbook, the restore evidence and the alerts all exist', () => {
  const s = scratch((api) => entered(api, 'postgres'));
  const result = run(s);
  assert.deepEqual(result.findings, []);
  assert.equal(result.components.find((c) => c.name === 'postgres').entered, true);
});

test('the entry gate fails naming the missing runbook, restore test or alert, one at a time', () => {
  const noRunbook = scratch((api) => entered(api, 'postgres', (c) => { c.runbook = 'docs/runbooks/infra/absent.md'; }));
  assert.deepEqual(codesOf(run(noRunbook)), ['COMPONENT_RUNBOOK_MISSING']);
  const noEvidence = scratch((api) => entered(api, 'postgres', (c) => { c.restoreEvidence = null; }));
  assert.deepEqual(codesOf(run(noEvidence)), ['COMPONENT_RESTORE_MISSING']);
  const missingFile = scratch((api) => entered(api, 'postgres', (c) => { c.restoreEvidence.path = 'docs/runbooks/infra/evidence/nope.md'; }));
  assert.deepEqual(codesOf(run(missingFile)), ['COMPONENT_RESTORE_MISSING']);
  const noAlert = scratch((api) => entered(api, 'postgres', (c) => { c.alerts = [...c.alerts, 'pg-does-not-exist']; }));
  assert.deepEqual(codesOf(run(noAlert)), ['COMPONENT_ALERT_MISSING']);
  const noAlerts = scratch((api) => entered(api, 'postgres', (c) => { c.alerts = []; }));
  assert.deepEqual(codesOf(run(noAlerts)), ['COMPONENT_ALERT_MISSING']);
});

test('restore evidence older than the component version is stale', () => {
  const s = scratch((api) => entered(api, 'postgres', (c) => { c.restoreEvidence.verifiedVersion = '17'; }));
  assert.deepEqual(codesOf(run(s)), ['EVIDENCE_STALE']);
});

test('a planned component may lack evidence but its stories are listed as blocked; unknown stories are findings', () => {
  const s = scratch((api) => {
    api.json('infra/components/postgres.json', (c) => { c.firstStories = ['ST-A', 'ST-GONE']; });
  });
  const result = run(s);
  assert.deepEqual(codesOf(result), ['STORY_UNKNOWN']);
  assert.deepEqual(result.blockedStories.filter((entry) => entry.component === 'postgres'), [{ story: 'ST-A', component: 'postgres', missing: 'restore test' }]);
});

test('--require-entered fails for a planned component and names what is missing, and passes once entered', () => {
  const planned = scratch();
  const lines = [];
  assert.equal(main(['--root', planned.root, '--plan', planned.planPath, '--require-entered', 'postgres'], { log: (line) => lines.push(line) }), 1);
  assert.ok(lines.some((line) => /restore/i.test(line)));
  const ready = scratch((api) => entered(api, 'postgres'));
  assert.equal(main(['--root', ready.root, '--plan', ready.planPath, '--require-entered', 'postgres'], { log: () => undefined }), 0);
  assert.equal(main(['--root', ready.root, '--plan', ready.planPath, '--require-entered', 'nonexistent'], { log: () => undefined }), 2);
});

test('secrets: an inline value, a bad reference, a long rotation and a missing reference are findings', () => {
  const inline = scratch((api) => api.json('infra/environments/staging.json', (env) => { env.databasePassword = 'Sup3rS3cretValue'; }));
  assert.ok(codesOf(run(inline)).includes('SECRET_INLINE'));
  const url = scratch((api) => api.json('infra/environments/staging.json', (env) => { env.databaseUrl = 'postgres://admin:hunter2hunter2@db.internal:5432/app'; }));
  assert.ok(codesOf(run(url)).includes('SECRET_INLINE'));
  const bad = scratch((api) => api.json('infra/secrets/references.json', (file) => { file.secrets[0].ref = 'vault:abc'; }));
  assert.ok(codesOf(run(bad)).includes('SECRET_REF_INVALID'));
  const rotation = scratch((api) => api.json('infra/secrets/references.json', (file) => { file.secrets[0].rotationDays = 365; }));
  assert.ok(codesOf(run(rotation)).includes('SECRET_ROTATION'));
  const missing = scratch((api) => api.json('infra/environments/production.json', (env) => { env.credentials = 'secret://production/not-listed'; }));
  assert.ok(codesOf(run(missing)).includes('SECRET_REF_MISSING'));
});

test('pipelines: production needs an approval, a canary by cohort that starts small, and a fast rollback', () => {
  const noApproval = scratch((api) => api.json('infra/pipelines/production.json', (p) => { p.approval.required = false; }));
  assert.deepEqual(codesOf(run(noApproval)), ['PIPELINE_APPROVAL']);
  const noCohorts = scratch((api) => api.json('infra/pipelines/production.json', (p) => { p.canary.cohorts = ['all']; }));
  assert.deepEqual(codesOf(run(noCohorts)), ['PIPELINE_CANARY']);
  const bigFirstStep = scratch((api) => api.json('infra/pipelines/production.json', (p) => { p.canary.stepsPercent = [50, 100]; }));
  assert.deepEqual(codesOf(run(bigFirstStep)), ['PIPELINE_CANARY']);
  const slowRollback = scratch((api) => api.json('infra/pipelines/production.json', (p) => { p.rollback.maxMinutes = 60; }));
  assert.deepEqual(codesOf(run(slowRollback)), ['PIPELINE_ROLLBACK']);
  const noCanaryAtAll = scratch((api) => api.json('infra/pipelines/production.json', (p) => { delete p.canary; }));
  assert.deepEqual(codesOf(run(noCanaryAtAll)), ['PIPELINE_CANARY']);
});

test('postgres: archive timeout, WAL level and recovery targets follow the design', () => {
  const timeout = scratch((api) => api.text('infra/postgres/postgresql.conf.tpl', (text) => text.replace('archive_timeout = 60s', 'archive_timeout = 300s')));
  assert.deepEqual(codesOf(run(timeout)), ['POSTGRES_ARCHIVE_TIMEOUT']);
  const level = scratch((api) => api.text('infra/postgres/postgresql.conf.tpl', (text) => text.replace('wal_level = logical', 'wal_level = replica')));
  assert.deepEqual(codesOf(run(level)), ['POSTGRES_WAL_LEVEL']);
  const rpo = scratch((api) => api.json('infra/postgres/backup.json', (b) => { b.rpoMinutes = 60; }));
  assert.deepEqual(codesOf(run(rpo)), ['BACKUP_TARGET']);
  const retention = scratch((api) => api.json('infra/postgres/backup.json', (b) => { b.pitrRetentionDays = 7; }));
  assert.deepEqual(codesOf(run(retention)), ['BACKUP_TARGET']);
});

test('keycloak: the control-plane client needs its own audience and WebAuthn for the platform roles', () => {
  const noWebauthn = scratch((api) => api.json('infra/keycloak/realm-template.json', (r) => { r.clients[1].requiredWebAuthnRealmRoles = []; }));
  assert.deepEqual(codesOf(run(noWebauthn)), ['KEYCLOAK_CONTROL_CLIENT']);
  const sameAudience = scratch((api) => api.json('infra/keycloak/realm-template.json', (r) => { r.clients[1].audience = 'machvon-api'; }));
  assert.deepEqual(codesOf(run(sameAudience)), ['KEYCLOAK_CONTROL_CLIENT']);
  const noClient = scratch((api) => api.json('infra/keycloak/realm-template.json', (r) => { r.clients = r.clients.slice(0, 1); }));
  assert.deepEqual(codesOf(run(noClient)), ['KEYCLOAK_CONTROL_CLIENT']);
});

test('alerts: the channel must be independent of the product, each rule needs an owner and an existing runbook', () => {
  const channel = scratch((api) => api.json('infra/alerts/postgres.json', (rules) => { rules[0].channel = 'notification-center'; }));
  assert.deepEqual(codesOf(run(channel)), ['ALERT_CHANNEL']);
  const owner = scratch((api) => api.json('infra/alerts/postgres.json', (rules) => { rules[0].owner = ''; }));
  assert.deepEqual(codesOf(run(owner)), ['ALERT_OWNER']);
  const runbook = scratch((api) => api.json('infra/alerts/postgres.json', (rules) => { rules[0].runbook = 'docs/runbooks/infra/missing.md#x'; }));
  assert.deepEqual(codesOf(run(runbook)), ['ALERT_RUNBOOK']);
});

test('a malformed JSON file is a finding, not a crash', () => {
  const s = scratch((api) => api.write('infra/environments/broken.json', '{ not json'));
  assert.ok(codesOf(run(s)).includes('INFRA_FILE_INVALID'));
});

test('every finding code has a message in both languages and main reports them with the file', () => {
  for (const locale of ['vi', 'en']) {
    const messages = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'messages', `${locale}.json`), 'utf8'));
    for (const code of FINDING_CODES) assert.ok(messages[`infra.${code}`], `${locale} ${code}`);
    for (const key of ['infra.summary.pass', 'infra.summary.fail', 'infra.component.pending', 'infra.story.blocked', 'infra.usage']) assert.ok(messages[key], `${locale} ${key}`);
  }
  const s = scratch((api) => api.json('infra/environments/production.json', (env) => { env.resources[0].region = 'SG-1'; }));
  const lines = [];
  assert.equal(main(['--root', s.root, '--plan', s.planPath, '--locale', 'en'], { log: (line) => lines.push(line) }), 1);
  assert.ok(lines.some((line) => line.includes('production.json') && line.includes('pg-primary')));
});

test('main exits 2 on an unknown option and 0 on the real repository', () => {
  assert.equal(main(['--bogus'], { log: () => undefined }), 2);
  assert.equal(main(['--root', REPO_ROOT], { log: () => undefined }), 0);
});
