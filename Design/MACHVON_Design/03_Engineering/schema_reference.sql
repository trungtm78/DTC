-- MACH VON v1.3 / PostgreSQL reference design; review before deployment.

-- No database was created or changed. Application runtime must not own tables or bypass RLS.

CREATE SCHEMA IF NOT EXISTS machvon;

SET search_path = machvon, public;

CREATE TABLE tenant (
  id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  placement_id uuid NOT NULL,
  region text NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (code)
);

CREATE TABLE organization_unit (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid,
  valid_from date NOT NULL,
  valid_until date,
  successor_id uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE membership (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  status text NOT NULL,
  valid_until timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE role_grant (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_json jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE project (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  owner_unit_id uuid NOT NULL,
  area_master_version_id uuid NOT NULL,
  classification text NOT NULL,
  total_investment_vnd numeric(24,0) NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE plan_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  fiscal_year integer NOT NULL,
  revision integer NOT NULL,
  decision_id uuid NOT NULL,
  status text NOT NULL,
  effective_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE allocation_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  plan_version_id uuid NOT NULL,
  fund_source_version_id uuid NOT NULL,
  bucket text NOT NULL,
  source_year integer NOT NULL,
  amount_vnd numeric(24,0) NOT NULL,
  ctmtqg_subset_vnd numeric(24,0) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE reporting_period (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  calendar_version integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  deadline_at timestamptz NOT NULL,
  locked_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE report_revision (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  period_id uuid NOT NULL,
  plan_version_id uuid NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL,
  is_current boolean NOT NULL,
  version bigint NOT NULL,
  submitted_at timestamptz,
  accepted_at timestamptz,
  payload_hash char(64) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE funding_snapshot_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  report_revision_id uuid NOT NULL,
  bucket text NOT NULL,
  budget_level text NOT NULL,
  disbursed_cumulative_vnd numeric(24,0) NOT NULL,
  ctmtqg_subset_vnd numeric(24,0),
  next_month_registered_vnd numeric(24,0) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE progress_snapshot (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  report_revision_id uuid NOT NULL,
  construction_value_vnd numeric(24,0) NOT NULL,
  acceptance_value_vnd numeric(24,0) NOT NULL,
  treasury_submitted_value_vnd numeric(24,0) NOT NULL,
  preparing_dossier_value_vnd numeric(24,0) NOT NULL,
  measurement_basis text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE treasury_transaction (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  external_id text NOT NULL,
  provider text NOT NULL,
  amount_vnd numeric(24,0) NOT NULL,
  confirmed_at timestamptz NOT NULL,
  reversal_of_id uuid,
  source_hash char(64) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE document_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  document_id uuid NOT NULL,
  version integer NOT NULL,
  object_key text NOT NULL,
  checksum char(64) NOT NULL,
  mime text NOT NULL,
  page_count integer NOT NULL,
  classification text NOT NULL,
  scan_status text NOT NULL,
  acl_json jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE issue (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  category_version_id uuid NOT NULL,
  severity text NOT NULL,
  assignee_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE contractor (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  tax_identifier text NOT NULL,
  legal_name text NOT NULL,
  verification_status text NOT NULL,
  profile_document_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE proposal (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  package_id uuid NOT NULL,
  contractor_id uuid NOT NULL,
  document_version_ids jsonb NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE criteria_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  package_id uuid NOT NULL,
  revision integer NOT NULL,
  criteria_json jsonb NOT NULL,
  approved_by uuid NOT NULL,
  effective_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE analysis_run (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  criteria_version_id uuid NOT NULL,
  profile_version_id uuid NOT NULL,
  input_hash char(64) NOT NULL,
  status text NOT NULL,
  budget_reservation_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE analysis_finding (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  criterion_id text NOT NULL,
  status text NOT NULL,
  finding text NOT NULL,
  evidence_refs jsonb NOT NULL,
  reviewer_id uuid,
  override_reason text,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE llm_attempt (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  provider_request_id text NOT NULL,
  actual_model text NOT NULL,
  pricing_version_id uuid NOT NULL,
  input_total bigint NOT NULL,
  cached_input bigint NOT NULL,
  output_total bigint NOT NULL,
  reasoning_info bigint NOT NULL,
  cost numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  reconcile_status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE budget_reservation (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  scope_json jsonb NOT NULL,
  reserved_amount numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE model_profile_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  task_type text NOT NULL,
  revision integer NOT NULL,
  model_id text NOT NULL,
  effort text,
  output_cap integer NOT NULL,
  routing_policy jsonb NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE notification_instance (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  event_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  purpose text NOT NULL,
  dedupe_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE delivery_attempt (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  notification_id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  provider_message_id text,
  attempt_no integer NOT NULL,
  status text NOT NULL,
  error_code text,
  delivered_at timestamptz,
  cost numeric(24,8) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE conversation (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  external_thread_id text NOT NULL,
  verified_contact_id uuid NOT NULL,
  resource_links jsonb NOT NULL,
  assignee_id uuid NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE channel_message (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  provider_message_id text NOT NULL,
  kind text NOT NULL,
  content_reference text NOT NULL,
  sent_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE contact_consent (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  evidence_reference text NOT NULL,
  effective_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE metric_definition (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  revision integer NOT NULL,
  grain text NOT NULL,
  aggregation_type text NOT NULL,
  expression_ast jsonb NOT NULL,
  unit text NOT NULL,
  owner_id uuid NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE dashboard_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  dashboard_id uuid NOT NULL,
  revision integer NOT NULL,
  layout_json jsonb NOT NULL,
  metric_versions jsonb NOT NULL,
  filter_mappings jsonb NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE drill_context (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  subject_scope_hash char(64) NOT NULL,
  metric_version_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  filters_ast jsonb NOT NULL,
  path jsonb NOT NULL,
  as_of timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE license_revision (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  serial text NOT NULL,
  revision integer NOT NULL,
  entitlement_version_id uuid NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  grace_until timestamptz NOT NULL,
  status text NOT NULL,
  signed_claims text NOT NULL,
  key_id text NOT NULL,
  supersedes_id uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE subscription (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  plan_version_id uuid NOT NULL,
  cycle text NOT NULL,
  billing_anchor date NOT NULL,
  status text NOT NULL,
  payment_terms jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE usage_meter_event (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  meter text NOT NULL,
  external_event_key text NOT NULL,
  quantity numeric(24,6) NOT NULL,
  occurred_at timestamptz NOT NULL,
  source_reference text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE invoice_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  meter text NOT NULL,
  quantity numeric(24,6) NOT NULL,
  unit_price numeric(24,8) NOT NULL,
  amount numeric(24,8) NOT NULL,
  currency char(3) NOT NULL,
  pricing_version_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE master_record_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  master_type text NOT NULL,
  code text NOT NULL,
  revision integer NOT NULL,
  label text NOT NULL,
  parent_id uuid,
  attributes jsonb NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL,
  approved_by uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE data_contract_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  dataset_id uuid NOT NULL,
  revision integer NOT NULL,
  grain text NOT NULL,
  schema_json jsonb NOT NULL,
  owner_id uuid NOT NULL,
  quality_rules jsonb NOT NULL,
  retention_policy_id uuid NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE quality_incident (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  affected_refs jsonb NOT NULL,
  severity text NOT NULL,
  owner_id uuid NOT NULL,
  status text NOT NULL,
  due_at timestamptz NOT NULL,
  resolution text,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE maturity_assessment (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  period_code text NOT NULL,
  rubric_version text NOT NULL,
  coverage_percent numeric(5,2) NOT NULL,
  status text NOT NULL,
  reviewer_id uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE audit_event (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  safe_diff jsonb NOT NULL,
  reason text,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE outbox_event (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  aggregate_id uuid NOT NULL,
  type text NOT NULL,
  schema_version integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE procurement_package (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  budget_vnd numeric(24,0) NOT NULL,
  method text NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL,
  approved_decision_id uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE contract (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  package_id uuid NOT NULL,
  contractor_id uuid NOT NULL,
  code text NOT NULL,
  type text NOT NULL,
  currency char(3) NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE contract_revision (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  revision integer NOT NULL,
  amount_vnd numeric(24,0) NOT NULL,
  document_version_id uuid NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE boq_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_revision_id uuid NOT NULL,
  business_key text NOT NULL,
  description text NOT NULL,
  unit_code text NOT NULL,
  quantity numeric(24,6) NOT NULL,
  unit_price numeric(24,6) NOT NULL,
  rounding_rule text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE guarantee (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  kind text NOT NULL,
  issuer text NOT NULL,
  amount_vnd numeric(24,0) NOT NULL,
  expires_at timestamptz NOT NULL,
  verification_status text NOT NULL,
  release_evidence_id uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE change_request (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  baseline_revision_id uuid NOT NULL,
  amount_delta_vnd numeric(24,0) NOT NULL,
  schedule_impact_days integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE site_diary (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  record_date date NOT NULL,
  client_operation_id uuid NOT NULL,
  content jsonb NOT NULL,
  author_id uuid NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE measurement (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_revision_id uuid NOT NULL,
  boq_line_id uuid NOT NULL,
  period_id uuid NOT NULL,
  quantity_period numeric(24,6) NOT NULL,
  quantity_cumulative numeric(24,6) NOT NULL,
  revision integer NOT NULL,
  status text NOT NULL,
  evidence_refs jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE acceptance (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  measurement_ids jsonb NOT NULL,
  document_version_id uuid NOT NULL,
  approved_at timestamptz,
  signer_refs jsonb NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE payment_request (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  acceptance_id uuid NOT NULL,
  currency char(3) NOT NULL,
  gross_vnd numeric(24,0) NOT NULL,
  advance_recovery_vnd numeric(24,0) NOT NULL,
  retention_vnd numeric(24,0) NOT NULL,
  tax_adjustment_vnd numeric(24,0) NOT NULL,
  net_vnd numeric(24,0) NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE advance_ledger_entry (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  payment_request_id uuid,
  entry_kind text NOT NULL,
  amount_vnd numeric(24,0) NOT NULL,
  reversal_of_id uuid,
  posted_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE quality_nonconformance (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  measurement_id uuid,
  severity text NOT NULL,
  action_owner_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL,
  closure_evidence jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE handover (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  recipient_unit_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  punch_list jsonb NOT NULL,
  accepted_at timestamptz,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE asset_record (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  handover_id uuid NOT NULL,
  asset_code text NOT NULL,
  value_vnd numeric(24,0) NOT NULL,
  recipient_unit_id uuid NOT NULL,
  warranty_until date,
  external_asset_id text,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE settlement_revision (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_id uuid,
  revision integer NOT NULL,
  settled_amount_vnd numeric(24,0) NOT NULL,
  outstanding_vnd numeric(24,0) NOT NULL,
  unrecovered_advance_vnd numeric(24,0) NOT NULL,
  audit_finding_refs jsonb NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE workflow_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  business_type text NOT NULL,
  revision integer NOT NULL,
  definition_json jsonb NOT NULL,
  status text NOT NULL,
  published_by uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE workflow_instance (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  resource_version bigint NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE approval_task (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  workflow_instance_id uuid NOT NULL,
  assignee_id uuid NOT NULL,
  delegated_from_id uuid,
  due_at timestamptz NOT NULL,
  decision text,
  reason text,
  decided_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE channel_account (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  channel text NOT NULL,
  external_account_id text NOT NULL,
  credential_secret_ref text NOT NULL,
  capability_version text NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE notification_template_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  channel text NOT NULL,
  locale text NOT NULL,
  revision integer NOT NULL,
  content_ast jsonb NOT NULL,
  variable_schema jsonb NOT NULL,
  provider_template_id text,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE contact (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  display_name text NOT NULL,
  verified_identities jsonb NOT NULL,
  classification text NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE device_registration (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  device_public_id text NOT NULL,
  push_secret_ref text NOT NULL,
  platform text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE ai_eval_run (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  profile_version_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  results_json jsonb NOT NULL,
  cost numeric(24,8) NOT NULL,
  review_status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE pricing_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  currency char(3) NOT NULL,
  effective_from timestamptz NOT NULL,
  input_per_million numeric(24,8) NOT NULL,
  cached_per_million numeric(24,8) NOT NULL,
  output_per_million numeric(24,8) NOT NULL,
  source_url text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE dataset_contract (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  dataset_code text NOT NULL,
  revision integer NOT NULL,
  owner_id uuid NOT NULL,
  schema_json jsonb NOT NULL,
  quality_json jsonb NOT NULL,
  freshness_seconds bigint NOT NULL,
  classification text NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE quality_rule_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  code text NOT NULL,
  revision integer NOT NULL,
  expression_ast jsonb NOT NULL,
  severity text NOT NULL,
  threshold_json jsonb NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE quality_run (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  dataset_contract_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  rule_version_ids jsonb NOT NULL,
  passed_count bigint NOT NULL,
  failed_count bigint NOT NULL,
  quarantined_count bigint NOT NULL,
  finished_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE quality_exception (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  run_id uuid NOT NULL,
  record_reference jsonb NOT NULL,
  owner_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL,
  waiver_expires_at timestamptz,
  evidence jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE maturity_evidence (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  pillar_code text NOT NULL,
  criterion_code text NOT NULL,
  level integer,
  evidence_refs jsonb NOT NULL,
  review_status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE legal_hold (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  resource_scope jsonb NOT NULL,
  authority_reference text NOT NULL,
  reason text NOT NULL,
  effective_at timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE idempotency_record (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  subject_id uuid NOT NULL,
  operation text NOT NULL,
  key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  response_ref jsonb NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE integration_cursor (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  connector_code text NOT NULL,
  source_scope text NOT NULL,
  cursor_json jsonb NOT NULL,
  last_success_at timestamptz,
  schema_version text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE integration_event_inbox (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  provider text NOT NULL,
  event_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  payload_reference text NOT NULL,
  received_at timestamptz NOT NULL,
  status text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE support_access_grant (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  ticket_reference text NOT NULL,
  operator_id uuid NOT NULL,
  owner_approved_by uuid NOT NULL,
  scope_json jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE project ADD FOREIGN KEY (tenant_id,owner_unit_id) REFERENCES organization_unit(tenant_id,id);

ALTER TABLE organization_unit ADD FOREIGN KEY (tenant_id,parent_id) REFERENCES organization_unit(tenant_id,id);

ALTER TABLE membership ADD FOREIGN KEY (tenant_id,organization_id) REFERENCES organization_unit(tenant_id,id);

ALTER TABLE role_grant ADD FOREIGN KEY (tenant_id,membership_id) REFERENCES membership(tenant_id,id);

ALTER TABLE plan_version ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);

ALTER TABLE allocation_line ADD FOREIGN KEY (tenant_id,plan_version_id) REFERENCES plan_version(tenant_id,id);

ALTER TABLE report_revision ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);

ALTER TABLE report_revision ADD FOREIGN KEY (tenant_id,period_id) REFERENCES reporting_period(tenant_id,id);

ALTER TABLE report_revision ADD FOREIGN KEY (tenant_id,plan_version_id) REFERENCES plan_version(tenant_id,id);

ALTER TABLE funding_snapshot_line ADD FOREIGN KEY (tenant_id,report_revision_id) REFERENCES report_revision(tenant_id,id);

ALTER TABLE progress_snapshot ADD FOREIGN KEY (tenant_id,report_revision_id) REFERENCES report_revision(tenant_id,id);

ALTER TABLE treasury_transaction ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);

ALTER TABLE issue ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);

ALTER TABLE proposal ADD FOREIGN KEY (tenant_id,contractor_id) REFERENCES contractor(tenant_id,id);

ALTER TABLE proposal ADD FOREIGN KEY (tenant_id,package_id) REFERENCES procurement_package(tenant_id,id);

ALTER TABLE analysis_run ADD FOREIGN KEY (tenant_id,proposal_id) REFERENCES proposal(tenant_id,id);

ALTER TABLE analysis_run ADD FOREIGN KEY (tenant_id,criteria_version_id) REFERENCES criteria_version(tenant_id,id);

ALTER TABLE analysis_finding ADD FOREIGN KEY (tenant_id,run_id) REFERENCES analysis_run(tenant_id,id);

ALTER TABLE procurement_package ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);

ALTER TABLE contract ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);

ALTER TABLE contract ADD FOREIGN KEY (tenant_id,package_id) REFERENCES procurement_package(tenant_id,id);

ALTER TABLE contract ADD FOREIGN KEY (tenant_id,contractor_id) REFERENCES contractor(tenant_id,id);

ALTER TABLE contract_revision ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES contract(tenant_id,id);

ALTER TABLE boq_line ADD FOREIGN KEY (tenant_id,contract_revision_id) REFERENCES contract_revision(tenant_id,id);

ALTER TABLE guarantee ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES contract(tenant_id,id);

ALTER TABLE change_request ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES contract(tenant_id,id);

ALTER TABLE measurement ADD FOREIGN KEY (tenant_id,boq_line_id) REFERENCES boq_line(tenant_id,id);

ALTER TABLE measurement ADD FOREIGN KEY (tenant_id,contract_revision_id) REFERENCES contract_revision(tenant_id,id);

ALTER TABLE acceptance ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES contract(tenant_id,id);

ALTER TABLE payment_request ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES contract(tenant_id,id);

ALTER TABLE payment_request ADD FOREIGN KEY (tenant_id,acceptance_id) REFERENCES acceptance(tenant_id,id);

ALTER TABLE handover ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES contract(tenant_id,id);

ALTER TABLE asset_record ADD FOREIGN KEY (tenant_id,handover_id) REFERENCES handover(tenant_id,id);

ALTER TABLE quality_exception ADD FOREIGN KEY (tenant_id,run_id) REFERENCES quality_run(tenant_id,id);

ALTER TABLE quality_rule_version ADD FOREIGN KEY (tenant_id,contract_id) REFERENCES dataset_contract(tenant_id,id);

ALTER TABLE maturity_evidence ADD FOREIGN KEY (tenant_id,assessment_id) REFERENCES maturity_assessment(tenant_id,id);

ALTER TABLE delivery_attempt ADD FOREIGN KEY (tenant_id,notification_id) REFERENCES notification_instance(tenant_id,id);

ALTER TABLE delivery_attempt ADD FOREIGN KEY (tenant_id,channel_account_id) REFERENCES channel_account(tenant_id,id);

ALTER TABLE channel_message ADD FOREIGN KEY (tenant_id,conversation_id) REFERENCES conversation(tenant_id,id);

ALTER TABLE conversation ADD FOREIGN KEY (tenant_id,channel_account_id) REFERENCES channel_account(tenant_id,id);

ALTER TABLE device_registration ADD FOREIGN KEY (tenant_id,membership_id) REFERENCES membership(tenant_id,id);

ALTER TABLE approval_task ADD FOREIGN KEY (tenant_id,workflow_instance_id) REFERENCES workflow_instance(tenant_id,id);

ALTER TABLE allocation_line ADD CHECK (amount_vnd >= 0 AND ctmtqg_subset_vnd >= 0 AND ctmtqg_subset_vnd <= amount_vnd);

ALTER TABLE reporting_period ADD CHECK (start_date <= end_date);

ALTER TABLE contract_revision ADD CHECK (valid_until IS NULL OR valid_from < valid_until);

ALTER TABLE maturity_evidence ADD CHECK (level IS NULL OR level BETWEEN 1 AND 5);

CREATE UNIQUE INDEX report_revision_number ON report_revision (tenant_id,project_id,period_id,revision);

CREATE UNIQUE INDEX current_report ON report_revision (tenant_id,project_id,period_id) WHERE is_current;

CREATE UNIQUE INDEX treasury_source_event ON treasury_transaction (tenant_id,provider,external_id);

CREATE UNIQUE INDEX diary_client_operation ON site_diary (tenant_id,client_operation_id);

CREATE UNIQUE INDEX inbound_event_dedupe ON integration_event_inbox (tenant_id,provider,event_key);

CREATE UNIQUE INDEX command_dedupe ON idempotency_record (tenant_id,subject_id,operation,key_hash);

ALTER TABLE organization_unit ENABLE ROW LEVEL SECURITY;

ALTER TABLE organization_unit FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON organization_unit USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;

ALTER TABLE membership FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON membership USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE role_grant ENABLE ROW LEVEL SECURITY;

ALTER TABLE role_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON role_grant USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE project ENABLE ROW LEVEL SECURITY;

ALTER TABLE project FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON project USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE plan_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE plan_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON plan_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE allocation_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE allocation_line FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON allocation_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE reporting_period ENABLE ROW LEVEL SECURITY;

ALTER TABLE reporting_period FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON reporting_period USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE report_revision ENABLE ROW LEVEL SECURITY;

ALTER TABLE report_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON report_revision USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE funding_snapshot_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE funding_snapshot_line FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON funding_snapshot_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE progress_snapshot ENABLE ROW LEVEL SECURITY;

ALTER TABLE progress_snapshot FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON progress_snapshot USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE treasury_transaction ENABLE ROW LEVEL SECURITY;

ALTER TABLE treasury_transaction FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON treasury_transaction USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE document_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE document_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON document_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE issue ENABLE ROW LEVEL SECURITY;

ALTER TABLE issue FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON issue USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE contractor ENABLE ROW LEVEL SECURITY;

ALTER TABLE contractor FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON contractor USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE proposal ENABLE ROW LEVEL SECURITY;

ALTER TABLE proposal FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON proposal USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE criteria_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE criteria_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON criteria_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE analysis_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE analysis_run FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON analysis_run USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE analysis_finding ENABLE ROW LEVEL SECURITY;

ALTER TABLE analysis_finding FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON analysis_finding USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE llm_attempt ENABLE ROW LEVEL SECURITY;

ALTER TABLE llm_attempt FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON llm_attempt USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE budget_reservation ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget_reservation FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON budget_reservation USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE model_profile_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE model_profile_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON model_profile_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE notification_instance ENABLE ROW LEVEL SECURITY;

ALTER TABLE notification_instance FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON notification_instance USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE delivery_attempt ENABLE ROW LEVEL SECURITY;

ALTER TABLE delivery_attempt FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON delivery_attempt USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;

ALTER TABLE conversation FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON conversation USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE channel_message ENABLE ROW LEVEL SECURITY;

ALTER TABLE channel_message FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON channel_message USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE contact_consent ENABLE ROW LEVEL SECURITY;

ALTER TABLE contact_consent FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON contact_consent USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE metric_definition ENABLE ROW LEVEL SECURITY;

ALTER TABLE metric_definition FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON metric_definition USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE dashboard_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE dashboard_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON dashboard_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE drill_context ENABLE ROW LEVEL SECURITY;

ALTER TABLE drill_context FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON drill_context USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE license_revision ENABLE ROW LEVEL SECURITY;

ALTER TABLE license_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON license_revision USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;

ALTER TABLE subscription FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON subscription USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE usage_meter_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE usage_meter_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON usage_meter_event USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE invoice_line FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON invoice_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE master_record_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE master_record_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON master_record_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE data_contract_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE data_contract_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON data_contract_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE quality_incident ENABLE ROW LEVEL SECURITY;

ALTER TABLE quality_incident FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON quality_incident USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE maturity_assessment ENABLE ROW LEVEL SECURITY;

ALTER TABLE maturity_assessment FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON maturity_assessment USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON audit_event USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;

ALTER TABLE outbox_event FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON outbox_event USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE procurement_package ENABLE ROW LEVEL SECURITY;

ALTER TABLE procurement_package FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON procurement_package USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE contract ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON contract USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE contract_revision ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON contract_revision USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE boq_line ENABLE ROW LEVEL SECURITY;

ALTER TABLE boq_line FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON boq_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE guarantee ENABLE ROW LEVEL SECURITY;

ALTER TABLE guarantee FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON guarantee USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE change_request ENABLE ROW LEVEL SECURITY;

ALTER TABLE change_request FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON change_request USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE site_diary ENABLE ROW LEVEL SECURITY;

ALTER TABLE site_diary FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON site_diary USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE measurement ENABLE ROW LEVEL SECURITY;

ALTER TABLE measurement FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON measurement USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE acceptance ENABLE ROW LEVEL SECURITY;

ALTER TABLE acceptance FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON acceptance USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE payment_request ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_request FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON payment_request USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE advance_ledger_entry ENABLE ROW LEVEL SECURITY;

ALTER TABLE advance_ledger_entry FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON advance_ledger_entry USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE quality_nonconformance ENABLE ROW LEVEL SECURITY;

ALTER TABLE quality_nonconformance FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON quality_nonconformance USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE handover ENABLE ROW LEVEL SECURITY;

ALTER TABLE handover FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON handover USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE asset_record ENABLE ROW LEVEL SECURITY;

ALTER TABLE asset_record FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON asset_record USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE settlement_revision ENABLE ROW LEVEL SECURITY;

ALTER TABLE settlement_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON settlement_revision USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE workflow_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE workflow_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON workflow_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE workflow_instance ENABLE ROW LEVEL SECURITY;

ALTER TABLE workflow_instance FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON workflow_instance USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE approval_task ENABLE ROW LEVEL SECURITY;

ALTER TABLE approval_task FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON approval_task USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE channel_account ENABLE ROW LEVEL SECURITY;

ALTER TABLE channel_account FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON channel_account USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE notification_template_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE notification_template_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON notification_template_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE contact ENABLE ROW LEVEL SECURITY;

ALTER TABLE contact FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON contact USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE device_registration ENABLE ROW LEVEL SECURITY;

ALTER TABLE device_registration FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON device_registration USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE ai_eval_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE ai_eval_run FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON ai_eval_run USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE pricing_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE pricing_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON pricing_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE dataset_contract ENABLE ROW LEVEL SECURITY;

ALTER TABLE dataset_contract FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON dataset_contract USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE quality_rule_version ENABLE ROW LEVEL SECURITY;

ALTER TABLE quality_rule_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON quality_rule_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE quality_run ENABLE ROW LEVEL SECURITY;

ALTER TABLE quality_run FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON quality_run USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE quality_exception ENABLE ROW LEVEL SECURITY;

ALTER TABLE quality_exception FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON quality_exception USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE maturity_evidence ENABLE ROW LEVEL SECURITY;

ALTER TABLE maturity_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON maturity_evidence USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE legal_hold ENABLE ROW LEVEL SECURITY;

ALTER TABLE legal_hold FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON legal_hold USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE idempotency_record ENABLE ROW LEVEL SECURITY;

ALTER TABLE idempotency_record FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON idempotency_record USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE integration_cursor ENABLE ROW LEVEL SECURITY;

ALTER TABLE integration_cursor FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON integration_cursor USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE integration_event_inbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE integration_event_inbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON integration_event_inbox USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE support_access_grant ENABLE ROW LEVEL SECURITY;

ALTER TABLE support_access_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_boundary ON support_access_grant USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

-- Bind app.tenant_id from a verified server identity using SET LOCAL inside each transaction.

-- Pool reset mandatory. Missing setting denies rows. RLS above enforces tenant boundary only;

-- organization/project/role scopes and field masking need application policy or additional RLS.

-- tenant is a control-plane table: no data-plane runtime grant; separate operator service.

-- Published revision immutability, maker-checker, subset/basis rules and outbox atomicity are service invariants.

-- JSON evidence lists are logical references; normalize into junction tables with composite FKs before physical rollout.

-- Theme extension: reference DDL, not executed. Existing deployments require expand/backfill/verify before removing legacy branding_version_id.
CREATE TABLE tenant_theme_asset (
 tenant_id uuid NOT NULL REFERENCES tenant(id), id uuid NOT NULL,
 content_hash char(64) NOT NULL, mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576), storage_key text NOT NULL UNIQUE,
 scan_status text NOT NULL CHECK(scan_status IN ('pending','clean','rejected')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE tenant_theme_version (
 tenant_id uuid NOT NULL REFERENCES tenant(id), version bigint NOT NULL CHECK(version>0),
 config_json jsonb NOT NULL, config_hash char(64) NOT NULL, source_version bigint,
 published_by uuid NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), reason text,
 PRIMARY KEY(tenant_id,version), FOREIGN KEY(tenant_id,source_version) REFERENCES tenant_theme_version(tenant_id,version),
 CHECK(source_version IS NULL OR (reason IS NOT NULL AND length(trim(reason))>=10))
);
CREATE TABLE tenant_theme_pointer (
 tenant_id uuid PRIMARY KEY REFERENCES tenant(id), current_version bigint NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,current_version) REFERENCES tenant_theme_version(tenant_id,version)
);
CREATE TABLE tenant_theme_draft (
 tenant_id uuid PRIMARY KEY REFERENCES tenant(id), revision bigint NOT NULL CHECK(revision>=0),
 config_json jsonb NOT NULL, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_theme_review (
 tenant_id uuid NOT NULL REFERENCES tenant(id), id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE,
 actor_id uuid NOT NULL, base_version bigint NOT NULL, draft_revision bigint, source_version bigint,
 candidate_json jsonb NOT NULL, candidate_hash char(64) NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,base_version) REFERENCES tenant_theme_version(tenant_id,version),
 FOREIGN KEY(tenant_id,source_version) REFERENCES tenant_theme_version(tenant_id,version)
);
CREATE INDEX theme_review_expiry ON tenant_theme_review(expires_at) WHERE consumed_at IS NULL;
-- No data-plane runtime grants to theme write tables. Control-plane service validates SystemAdmin and sets tenant context per transaction.
-- Asset references in config_json MUST be checked/normalized to a version-asset junction before physical production rollout.
-- Immutable versions require restricted UPDATE/DELETE grants and migration-owner separation; SQL below alone is not role authorization.
ALTER TABLE tenant_theme_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_theme_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_theme_draft USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_theme_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_theme_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_theme_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_theme_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_theme_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_theme_review USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_theme_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_theme_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_theme_asset USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_theme_pointer ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_theme_pointer FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_theme_pointer USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
