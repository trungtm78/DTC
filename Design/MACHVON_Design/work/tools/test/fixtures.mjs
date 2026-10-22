// Minimal consistent design model used as the baseline for every check test.
// Each test clones it and breaks exactly one invariant.

export function validModel() {
  return {
    screens: [
      { id: 'IAM-01', module: 'IAM', req: 'FR-IAM-01', platform: 'web' },
      { id: 'DIS-01', module: 'DIS', req: 'FR-DIS-01', platform: 'web' },
    ],
    backlog: [
      { id: 'BL-IAM-01', screen: 'IAM-01', requirement: 'FR-IAM-01', test_ids: ['UI-IAM-01'] },
      { id: 'BL-DIS-01', screen: 'DIS-01', requirement: 'FR-DIS-01', test_ids: ['UI-DIS-01'] },
    ],
    trace: [
      { requirement: 'FR-IAM-01', screen: 'IAM-01', backlog_id: 'BL-IAM-01', test_ids: ['UI-IAM-01', 'UAT-AC01'] },
      { requirement: 'FR-DIS-01', screen: 'DIS-01', backlog_id: 'BL-DIS-01', test_ids: ['UI-DIS-01'] },
    ],
    tests: [
      { id: 'UI-IAM-01', priority: 'P0', steps: ['Open login', 'Submit valid credentials'], expected: 'Session created for tenant A' },
      { id: 'UI-DIS-01', priority: 'P0', steps: ['Open weekly report', 'Submit'], expected: 'Report revision Submitted' },
      { id: 'UAT-AC01', priority: 'P0', steps: ['Submit twice with one key'], expected: 'Exactly one revision exists' },
    ],
    nonFunctional: [
      { id: 'NFR-SEC-01', title: 'Tenant isolation', controls: ['RLS tenant_boundary'], test_ids: ['UAT-AC01'] },
    ],
    openapi: {
      paths: {
        '/reports/{id}/submit': {
          post: {
            operationId: 'post_reports_id_submit',
            'x-permission': 'report.submit',
            parameters: [{ name: 'Idempotency-Key', in: 'header', required: true }],
          },
        },
        '/resources/project': {
          get: { operationId: 'get_resources_project', 'x-permission': 'project.read' },
        },
      },
    },
    entities: { project: { tenant_id: 'uuid', id: 'uuid PK' }, tenant: { id: 'uuid PK' } },
    sql: [
      'CREATE TABLE tenant (',
      '  id uuid NOT NULL',
      ');',
      'CREATE TABLE project (',
      '  tenant_id uuid NOT NULL,',
      '  id uuid NOT NULL,',
      '  owner_unit_id uuid NOT NULL',
      ');',
      'ALTER TABLE project ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE project FORCE ROW LEVEL SECURITY;',
      "CREATE POLICY tenant_boundary ON project AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);",
      "CREATE POLICY tenant_access ON project AS PERMISSIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);",
      'CREATE INDEX project_owner_unit_idx ON project (tenant_id, owner_unit_id);',
    ].join('\n'),
  };
}

export function codes(findings) {
  return findings.map((f) => f.code).sort();
}
