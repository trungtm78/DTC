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

-- BEGIN module capital
-- Group "capital" (MDM, PRJ, CAP, DIS, HOME, MNE) — M1 design, reference only; not executed.
-- Existing owned tables are extended with ALTER TABLE; NOT NULL on new columns of existing tables is applied after backfill (see 05_modules/*.md §6).

-- PRJ: project (existing, extended)
ALTER TABLE project ADD COLUMN IF NOT EXISTS national_project_code text;
ALTER TABLE project ADD COLUMN IF NOT EXISTS project_group text;
ALTER TABLE project ADD COLUMN IF NOT EXISTS investor_unit_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS decision_authority_unit_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS sector_master_version_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS project_type_master_version_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS program_master_version_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS policy_decision_document_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS investment_decision_document_id uuid;
ALTER TABLE project ADD COLUMN IF NOT EXISTS start_year integer;
ALTER TABLE project ADD COLUMN IF NOT EXISTS end_year integer;
ALTER TABLE project ADD COLUMN IF NOT EXISTS appraisal_score numeric(5,2);
ALTER TABLE project ADD COLUMN IF NOT EXISTS pipeline_priority integer;
ALTER TABLE project ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE project ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE project ADD COLUMN IF NOT EXISTS created_by uuid;
-- migration: backfill project.created_by, then ALTER TABLE project ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE project ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE project ADD COLUMN IF NOT EXISTS updated_by uuid;
-- migration: backfill project.updated_by, then ALTER TABLE project ALTER COLUMN updated_by SET NOT NULL;
CREATE POLICY tenant_guard ON project AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE project ADD CONSTRAINT project_status_chk CHECK (status IN ('CONCEPT','APPRAISAL','PIPELINE','BUDGETED','IMPLEMENTATION','SUSPENDED','COMPLETED','SETTLED','CLOSED','REJECTED','CANCELLED'));
ALTER TABLE project ADD CONSTRAINT project_group_chk CHECK (project_group IS NULL OR project_group IN ('QTQG','A','B','C'));
ALTER TABLE project ADD CONSTRAINT project_group_required_chk CHECK (status IN ('CONCEPT','APPRAISAL','REJECTED','CANCELLED') OR project_group IS NOT NULL);
ALTER TABLE project ADD CONSTRAINT project_classification_chk CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL'));
ALTER TABLE project ADD CONSTRAINT project_money_chk CHECK (total_investment_vnd >= 0);
ALTER TABLE project ADD CONSTRAINT project_years_chk CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year);
ALTER TABLE project ADD CONSTRAINT project_score_chk CHECK (appraisal_score IS NULL OR appraisal_score BETWEEN 0 AND 100);
CREATE UNIQUE INDEX project_code_uq ON project (tenant_id, code);
CREATE UNIQUE INDEX project_national_code_uq ON project (tenant_id, national_project_code) WHERE national_project_code IS NOT NULL;
CREATE INDEX project_status_idx ON project (tenant_id, status);

-- PRJ: project_revision
CREATE TABLE project_revision (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  change_kind text NOT NULL CHECK (change_kind IN ('ADJUST_INVESTMENT','ADJUST_SCHEDULE','ADJUST_SCOPE','ADJUST_INVESTOR','INITIAL')),
  before_json jsonb NOT NULL,
  after_json jsonb NOT NULL,
  total_investment_vnd numeric(24,0) CHECK (total_investment_vnd IS NULL OR total_investment_vnd >= 0),
  decision_document_id uuid,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
  effective_from date,
  supersedes_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_revision USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_revision AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE project_revision ADD CONSTRAINT project_revision_decision_chk CHECK (status <> 'APPROVED' OR (decision_document_id IS NOT NULL AND effective_from IS NOT NULL));
ALTER TABLE project_revision ADD CONSTRAINT project_revision_sod_chk CHECK (decided_by IS NULL OR decided_by <> created_by);
CREATE UNIQUE INDEX project_revision_no_uq ON project_revision (tenant_id, project_id, revision);

-- PRJ: project_component
CREATE TABLE project_component (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_component_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  planned_value_vnd numeric(24,0) NOT NULL DEFAULT 0 CHECK (planned_value_vnd >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_component FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_component USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_component AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX project_component_code_uq ON project_component (tenant_id, project_id, code);

-- PRJ: project_milestone
CREATE TABLE project_milestone (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  component_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  baseline_date date NOT NULL,
  planned_date date NOT NULL,
  actual_date date,
  depends_on_milestone_id uuid,
  status text NOT NULL CHECK (status IN ('PLANNED','DONE','DELAYED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestone FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_milestone USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_milestone AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX project_milestone_code_uq ON project_milestone (tenant_id, project_id, code);
ALTER TABLE project_milestone ADD CONSTRAINT project_milestone_done_chk CHECK (status <> 'DONE' OR actual_date IS NOT NULL);

-- PRJ: project_appraisal
CREATE TABLE project_appraisal (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  round integer NOT NULL CHECK (round > 0),
  criteria_set_version_id uuid NOT NULL,
  appraiser_membership_id uuid NOT NULL,
  scores_json jsonb NOT NULL,
  total_score numeric(5,2) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  recommendation text NOT NULL CHECK (recommendation IN ('ADMIT','REJECT','RETURN')),
  status text NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','DECIDED','VOID')),
  decision text CHECK (decision IS NULL OR decision IN ('ADMIT','REJECT','RETURN')),
  decided_by uuid,
  decided_at timestamptz,
  decision_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_appraisal ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_appraisal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_appraisal USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_appraisal AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX project_appraisal_round_uq ON project_appraisal (tenant_id, project_id, round, appraiser_membership_id);
ALTER TABLE project_appraisal ADD CONSTRAINT project_appraisal_decided_chk CHECK (status <> 'DECIDED' OR (decision IS NOT NULL AND decided_by IS NOT NULL));

-- PRJ: project_risk
CREATE TABLE project_risk (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  category_master_version_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  likelihood smallint NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score smallint GENERATED ALWAYS AS (likelihood * impact) STORED,
  owner_membership_id uuid NOT NULL,
  mitigation text NOT NULL,
  due_date date NOT NULL,
  linked_issue_id uuid,
  status text NOT NULL CHECK (status IN ('OPEN','MITIGATING','ESCALATED','ACCEPTED','CLOSED')),
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_risk ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_risk FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_risk USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_risk AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX project_risk_code_uq ON project_risk (tenant_id, project_id, code);
ALTER TABLE project_risk ADD CONSTRAINT project_risk_close_chk CHECK (status NOT IN ('CLOSED','ACCEPTED') OR closed_reason IS NOT NULL);

-- PRJ: project_accountability
CREATE TABLE project_accountability (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  leader_membership_id uuid NOT NULL,
  accountability_role text NOT NULL CHECK (accountability_role IN ('LEADER_IN_CHARGE','DEPUTY_LEADER','FOCAL_OFFICER')),
  assignment_document_id uuid,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL CHECK (status IN ('ACTIVE','ENDED')),
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_accountability ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_accountability FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_accountability USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_accountability AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX project_accountability_leader_uq ON project_accountability (tenant_id, project_id) WHERE accountability_role = 'LEADER_IN_CHARGE' AND status = 'ACTIVE';
ALTER TABLE project_accountability ADD CONSTRAINT project_accountability_end_chk CHECK (status <> 'ENDED' OR (valid_until IS NOT NULL AND end_reason IS NOT NULL));

-- PRJ: task_force
CREATE TABLE task_force (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL,
  lead_membership_id uuid NOT NULL,
  scope_unit_id uuid NOT NULL,
  establishment_document_id uuid,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL CHECK (status IN ('ACTIVE','DISSOLVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE task_force ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_force FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON task_force USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON task_force AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX task_force_code_uq ON task_force (tenant_id, code);

-- PRJ: task_force_member
CREATE TABLE task_force_member (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  task_force_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('LEAD','MEMBER','SECRETARY')),
  project_id uuid,
  valid_from date NOT NULL,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE task_force_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_force_member FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON task_force_member USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON task_force_member AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX task_force_member_active_uq ON task_force_member (tenant_id, task_force_id, membership_id, project_id) NULLS NOT DISTINCT WHERE valid_until IS NULL;

-- PRJ: explanation_request
CREATE TABLE explanation_request (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('PROJECT','UNIT')),
  project_id uuid,
  unit_id uuid,
  period_id uuid,
  warning_id uuid,
  trigger_code text NOT NULL,
  question text NOT NULL,
  requested_from_membership_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  response_text text,
  response_document_id uuid,
  responded_by uuid,
  responded_at timestamptz,
  is_late boolean NOT NULL DEFAULT false,
  reviewed_by uuid,
  review_note text,
  status text NOT NULL CHECK (status IN ('REQUESTED','RESPONDED','ACCEPTED','RETURNED','OVERDUE','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE explanation_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE explanation_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON explanation_request USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON explanation_request AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE explanation_request ADD CONSTRAINT explanation_subject_chk CHECK ((subject_kind = 'PROJECT' AND project_id IS NOT NULL) OR (subject_kind = 'UNIT' AND unit_id IS NOT NULL));
ALTER TABLE explanation_request ADD CONSTRAINT explanation_sod_chk CHECK (reviewed_by IS NULL OR (reviewed_by <> responded_by));
ALTER TABLE explanation_request ADD CONSTRAINT explanation_response_chk CHECK (status NOT IN ('RESPONDED','ACCEPTED') OR response_text IS NOT NULL);

-- PRJ: project_transfer
CREATE TABLE project_transfer (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  from_unit_id uuid NOT NULL,
  to_unit_id uuid NOT NULL,
  transfer_scope text NOT NULL CHECK (transfer_scope IN ('OWNER_UNIT','INVESTOR_UNIT')),
  effective_date date NOT NULL,
  decision_document_id uuid,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','APPLIED','REJECTED','CANCELLED')),
  approved_by uuid,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE project_transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_transfer FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON project_transfer USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON project_transfer AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE project_transfer ADD CONSTRAINT project_transfer_units_chk CHECK (from_unit_id <> to_unit_id);
ALTER TABLE project_transfer ADD CONSTRAINT project_transfer_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);
CREATE UNIQUE INDEX project_transfer_open_uq ON project_transfer (tenant_id, project_id, transfer_scope) WHERE status IN ('REQUESTED','APPROVED');

-- CAP: capital_plan
CREATE TABLE capital_plan (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  plan_code text NOT NULL,
  plan_kind text NOT NULL CHECK (plan_kind IN ('MEDIUM_TERM','ANNUAL')),
  plan_year integer,
  period_from_year integer NOT NULL,
  period_to_year integer NOT NULL,
  scope_unit_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','SUPERSEDED','REJECTED')),
  decision_document_id uuid,
  supersedes_id uuid,
  submitted_by uuid,
  approved_by uuid,
  published_at timestamptz,
  effective_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE capital_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON capital_plan USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON capital_plan AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX capital_plan_rev_uq ON capital_plan (tenant_id, plan_code, revision);
CREATE UNIQUE INDEX capital_plan_published_uq ON capital_plan (tenant_id, plan_code) WHERE status = 'PUBLISHED';
ALTER TABLE capital_plan ADD CONSTRAINT capital_plan_publish_chk CHECK (status NOT IN ('PUBLISHED','SUPERSEDED') OR (decision_document_id IS NOT NULL AND effective_at IS NOT NULL));
ALTER TABLE capital_plan ADD CONSTRAINT capital_plan_sod_chk CHECK (approved_by IS NULL OR approved_by <> submitted_by);
ALTER TABLE capital_plan ADD CONSTRAINT capital_plan_year_chk CHECK ((plan_kind = 'ANNUAL' AND plan_year IS NOT NULL AND plan_year = period_from_year AND plan_year = period_to_year) OR (plan_kind = 'MEDIUM_TERM' AND period_from_year < period_to_year));

-- CAP: plan_version (existing, extended)
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS capital_plan_id uuid;
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS superseded_by_id uuid;
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS created_by uuid;
-- migration: backfill plan_version.created_by, then ALTER TABLE plan_version ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS updated_by uuid;
-- migration: backfill plan_version.updated_by, then ALTER TABLE plan_version ALTER COLUMN updated_by SET NOT NULL;
ALTER TABLE plan_version ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE POLICY tenant_guard ON plan_version AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE plan_version ADD CONSTRAINT plan_version_status_chk CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','SUPERSEDED','REJECTED'));
CREATE UNIQUE INDEX plan_version_plan_project_uq ON plan_version (tenant_id, capital_plan_id, project_id);

-- CAP: appropriation
CREATE TABLE appropriation (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  capital_plan_id uuid,
  fund_source_version_id uuid NOT NULL,
  plan_year integer NOT NULL,
  origin text NOT NULL CHECK (origin IN ('PM_ASSIGNED','LOCAL_ADDED','CARRYOVER','CENTRAL_SUPPORT','REVENUE_INCREASE')),
  budget_level text NOT NULL CHECK (budget_level IN ('CENTRAL','LOCAL')),
  program_master_version_id uuid,
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd >= 0),
  allocated_total_vnd numeric(24,0) NOT NULL DEFAULT 0 CHECK (allocated_total_vnd >= 0),
  decision_document_id uuid NOT NULL,
  issuing_authority text NOT NULL,
  is_extended boolean NOT NULL DEFAULT false,
  extended_to date,
  extension_document_id uuid,
  source_year integer NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id uuid,
  status text NOT NULL CHECK (status IN ('DRAFT','APPROVED','PUBLISHED','SUPERSEDED')),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE appropriation ENABLE ROW LEVEL SECURITY;
ALTER TABLE appropriation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON appropriation USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON appropriation AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE appropriation ADD CONSTRAINT appropriation_ceiling_chk CHECK (allocated_total_vnd <= amount_vnd);
ALTER TABLE appropriation ADD CONSTRAINT appropriation_extension_chk CHECK ((is_extended = (extended_to IS NOT NULL)) AND (NOT is_extended OR extension_document_id IS NOT NULL));
ALTER TABLE appropriation ADD CONSTRAINT appropriation_carryover_chk CHECK (origin <> 'CARRYOVER' OR (is_extended AND source_year < plan_year));
ALTER TABLE appropriation ADD CONSTRAINT appropriation_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);

-- CAP: allocation_line (existing, extended)
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS appropriation_id uuid;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS budget_level text;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS is_extended boolean NOT NULL DEFAULT false;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS extended_to date;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS extension_document_id uuid;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS program_master_version_id uuid;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS previous_line_id uuid;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS created_by uuid;
-- migration: backfill allocation_line.created_by, then ALTER TABLE allocation_line ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS updated_by uuid;
-- migration: backfill allocation_line.updated_by, then ALTER TABLE allocation_line ALTER COLUMN updated_by SET NOT NULL;
ALTER TABLE allocation_line ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE POLICY tenant_guard ON allocation_line AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE allocation_line ADD CONSTRAINT allocation_line_bucket_chk CHECK (bucket IN ('CURRENT_YEAR','CARRYOVER','OTHER'));
ALTER TABLE allocation_line ADD CONSTRAINT allocation_line_level_chk CHECK (budget_level IS NULL OR budget_level IN ('CENTRAL','LOCAL'));
ALTER TABLE allocation_line ADD CONSTRAINT allocation_line_extension_chk CHECK ((is_extended = (extended_to IS NOT NULL)) AND (NOT is_extended OR extension_document_id IS NOT NULL));
ALTER TABLE allocation_line ADD CONSTRAINT allocation_line_carryover_chk CHECK (bucket <> 'CARRYOVER' OR is_extended);
CREATE UNIQUE INDEX allocation_line_key_uq ON allocation_line (tenant_id, plan_version_id, appropriation_id, bucket, source_year);

-- CAP: allocation_balance
CREATE TABLE allocation_balance (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  allocation_line_id uuid NOT NULL,
  allocated_vnd numeric(24,0) NOT NULL CHECK (allocated_vnd >= 0),
  reserved_vnd numeric(24,0) NOT NULL DEFAULT 0 CHECK (reserved_vnd >= 0),
  committed_vnd numeric(24,0) NOT NULL DEFAULT 0 CHECK (committed_vnd >= 0),
  disbursed_vnd numeric(24,0) NOT NULL DEFAULT 0 CHECK (disbursed_vnd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE allocation_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON allocation_balance USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON allocation_balance AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX allocation_balance_line_uq ON allocation_balance (tenant_id, allocation_line_id);
ALTER TABLE allocation_balance ADD CONSTRAINT allocation_balance_revised_ge_committed_chk CHECK (allocated_vnd >= committed_vnd + disbursed_vnd);

-- CAP: capital_ledger_entry
CREATE TABLE capital_ledger_entry (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  appropriation_id uuid NOT NULL,
  allocation_line_id uuid,
  project_id uuid,
  entry_type text NOT NULL CHECK (entry_type IN ('APPROPRIATE','ALLOCATE','REDUCE','TRANSFER_OUT','TRANSFER_IN','RESERVE','RELEASE','COMMIT','UNCOMMIT','DISBURSE','EXTEND_OUT','EXTEND_IN','LAPSE','REVERSAL')),
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd > 0),
  plan_year integer NOT NULL,
  source_ref_kind text NOT NULL CHECK (source_ref_kind IN ('CAPITAL_PLAN','APPROPRIATION','RESERVATION','PAYMENT_REQUEST','TREASURY_TRANSACTION','REALLOCATION','EXTENSION','YEAR_CLOSE')),
  source_ref_id uuid NOT NULL,
  reversal_of_id uuid,
  reason text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE capital_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_ledger_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON capital_ledger_entry USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON capital_ledger_entry AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX capital_ledger_dedupe_uq ON capital_ledger_entry (tenant_id, source_ref_kind, source_ref_id, entry_type, allocation_line_id) NULLS NOT DISTINCT;
ALTER TABLE capital_ledger_entry ADD CONSTRAINT capital_ledger_reversal_chk CHECK ((entry_type = 'REVERSAL') = (reversal_of_id IS NOT NULL));
REVOKE UPDATE, DELETE, TRUNCATE ON capital_ledger_entry FROM PUBLIC, machvon_app; -- append-only: runtime role machvon_app may only INSERT/SELECT

-- CAP: fund_reservation
CREATE TABLE fund_reservation (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  allocation_line_id uuid NOT NULL,
  project_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('CONTRACT_PENDING','ADVANCE_PENDING','LAND_CLEARANCE','OTHER')),
  reference_kind text,
  reference_id uuid,
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd > 0),
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  release_reason text,
  avc_warning_acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE fund_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_reservation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON fund_reservation USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON fund_reservation AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE fund_reservation ADD CONSTRAINT fund_reservation_release_chk CHECK (status <> 'RELEASED' OR release_reason IS NOT NULL);

-- CAP: avc_policy
CREATE TABLE avc_policy (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  policy_code text NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('TENANT','FUND_SOURCE','UNIT','PROJECT_GROUP')),
  scope_ref_id uuid,
  scope_value text,
  control_object text NOT NULL CHECK (control_object IN ('ALLOCATION_LINE','APPROPRIATION')),
  warn_pct numeric(5,2) NOT NULL CHECK (warn_pct BETWEEN 0 AND 100),
  block_pct numeric(5,2) NOT NULL CHECK (block_pct BETWEEN 0 AND 100),
  include_reservations boolean NOT NULL DEFAULT true,
  legal_basis text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE avc_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE avc_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON avc_policy USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON avc_policy AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE avc_policy ADD CONSTRAINT avc_policy_threshold_chk CHECK (warn_pct <= block_pct);
CREATE UNIQUE INDEX avc_policy_rev_uq ON avc_policy (tenant_id, policy_code, revision);
ALTER TABLE avc_policy ADD CONSTRAINT avc_policy_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);

-- CAP: reallocation_proposal
CREATE TABLE reallocation_proposal (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  plan_year integer NOT NULL,
  scope_unit_id uuid NOT NULL,
  basis_snapshot_id uuid NOT NULL,
  source_capital_plan_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','APPLIED','REJECTED','WITHDRAWN')),
  decision_document_id uuid,
  resulting_capital_plan_id uuid,
  submitted_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE reallocation_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE reallocation_proposal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON reallocation_proposal USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON reallocation_proposal AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX reallocation_proposal_code_uq ON reallocation_proposal (tenant_id, code);
ALTER TABLE reallocation_proposal ADD CONSTRAINT reallocation_sod_chk CHECK (approved_by IS NULL OR approved_by <> submitted_by);
ALTER TABLE reallocation_proposal ADD CONSTRAINT reallocation_applied_chk CHECK (status <> 'APPLIED' OR (decision_document_id IS NOT NULL AND resulting_capital_plan_id IS NOT NULL));

-- CAP: reallocation_line
CREATE TABLE reallocation_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  from_allocation_line_id uuid NOT NULL,
  from_project_id uuid NOT NULL,
  to_project_id uuid NOT NULL,
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd > 0),
  rationale_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE reallocation_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE reallocation_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON reallocation_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON reallocation_line AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE reallocation_line ADD CONSTRAINT reallocation_line_distinct_chk CHECK (from_project_id <> to_project_id);

-- CAP: allocation_extension
CREATE TABLE allocation_extension (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  allocation_line_id uuid NOT NULL,
  project_id uuid NOT NULL,
  from_plan_year integer NOT NULL,
  extended_to date NOT NULL,
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd > 0),
  reason_code text NOT NULL,
  approving_document_id uuid,
  status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','APPLIED','REJECTED','LAPSED')),
  new_allocation_line_id uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE allocation_extension ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_extension FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON allocation_extension USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON allocation_extension AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE allocation_extension ADD CONSTRAINT allocation_extension_doc_chk CHECK (status NOT IN ('APPROVED','APPLIED') OR approving_document_id IS NOT NULL);
ALTER TABLE allocation_extension ADD CONSTRAINT allocation_extension_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);

-- CAP: fiscal_year_control
CREATE TABLE fiscal_year_control (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  plan_year integer NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','SOFT_CLOSED','LOCKED')),
  soft_closed_at timestamptz,
  locked_at timestamptz,
  locked_by uuid,
  reopen_reason text,
  reopened_until timestamptz,
  reopen_approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE fiscal_year_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_year_control FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON fiscal_year_control USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON fiscal_year_control AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX fiscal_year_control_uq ON fiscal_year_control (tenant_id, plan_year);
ALTER TABLE fiscal_year_control ADD CONSTRAINT fiscal_year_lock_chk CHECK ((status = 'LOCKED') = (locked_at IS NOT NULL));

-- CAP: disbursement_schedule_line
CREATE TABLE disbursement_schedule_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  allocation_line_id uuid,
  plan_year integer NOT NULL,
  granularity text NOT NULL CHECK (granularity IN ('WEEK','MONTH')),
  period_id uuid,
  month smallint CHECK (month IS NULL OR month BETWEEN 1 AND 13),
  bucket text NOT NULL CHECK (bucket IN ('CURRENT_YEAR','CARRYOVER','OTHER')),
  budget_level text NOT NULL CHECK (budget_level IN ('CENTRAL','LOCAL')),
  kind text NOT NULL CHECK (kind IN ('REGISTERED','FORECAST','WEEKLY_COMMITMENT')),
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd >= 0),
  ctmtqg_subset_vnd numeric(24,0),
  assumption text,
  revision integer NOT NULL CHECK (revision > 0),
  is_current boolean NOT NULL DEFAULT true,
  source_report_revision_id uuid,
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE disbursement_schedule_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement_schedule_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON disbursement_schedule_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON disbursement_schedule_line AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE disbursement_schedule_line ADD CONSTRAINT schedule_subset_chk CHECK (ctmtqg_subset_vnd IS NULL OR (ctmtqg_subset_vnd >= 0 AND ctmtqg_subset_vnd <= amount_vnd));
ALTER TABLE disbursement_schedule_line ADD CONSTRAINT schedule_grain_chk CHECK ((granularity = 'MONTH' AND month IS NOT NULL) OR (granularity = 'WEEK' AND period_id IS NOT NULL));
CREATE UNIQUE INDEX schedule_current_uq ON disbursement_schedule_line (tenant_id, project_id, plan_year, granularity, kind, bucket, budget_level, month, period_id) NULLS NOT DISTINCT WHERE is_current;

-- CAP: allocation_scenario
CREATE TABLE allocation_scenario (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  plan_year integer NOT NULL,
  input_snapshot_id uuid,
  base_capital_plan_id uuid NOT NULL,
  constraints_json jsonb NOT NULL,
  assumptions_json jsonb NOT NULL,
  result_json jsonb,
  status text NOT NULL CHECK (status IN ('DRAFT','RUN','PROMOTED','ARCHIVED')),
  promoted_proposal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE allocation_scenario ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_scenario FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON allocation_scenario USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON allocation_scenario AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX allocation_scenario_code_uq ON allocation_scenario (tenant_id, code);

-- DIS: reporting_period (existing, extended)
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS calendar_code text NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'WEEK';
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS fiscal_year integer;
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'OPEN';
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS soft_closed_at timestamptz;
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS locked_by uuid;
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS created_by uuid;
-- migration: backfill reporting_period.created_by, then ALTER TABLE reporting_period ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS updated_by uuid;
-- migration: backfill reporting_period.updated_by, then ALTER TABLE reporting_period ALTER COLUMN updated_by SET NOT NULL;
ALTER TABLE reporting_period ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE POLICY tenant_guard ON reporting_period AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reporting_period ADD CONSTRAINT reporting_period_type_chk CHECK (period_type IN ('WEEK','MONTH','QUARTER','HALF_YEAR','YEAR'));
ALTER TABLE reporting_period ADD CONSTRAINT reporting_period_status_chk CHECK (status IN ('OPEN','SOFT_CLOSED','LOCKED'));
ALTER TABLE reporting_period ADD CONSTRAINT reporting_period_lock_chk CHECK ((status = 'LOCKED') = (locked_at IS NOT NULL));
ALTER TABLE reporting_period ADD CONSTRAINT reporting_period_no_overlap EXCLUDE USING gist (tenant_id WITH =, calendar_code WITH =, period_type WITH =, daterange(start_date, end_date, '[]') WITH &&);
CREATE UNIQUE INDEX reporting_period_code_uq ON reporting_period (tenant_id, calendar_code, code);

-- DIS: period_reopen
CREATE TABLE period_reopen (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  period_id uuid NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('PERIOD','PROJECTS')),
  scope_project_ids uuid[],
  reason text NOT NULL CHECK (length(reason) >= 20),
  requested_by uuid NOT NULL,
  approved_by uuid,
  window_until timestamptz,
  status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','EXPIRED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE period_reopen ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_reopen FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON period_reopen USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON period_reopen AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE period_reopen ADD CONSTRAINT period_reopen_sod_chk CHECK (approved_by IS NULL OR approved_by <> requested_by);
ALTER TABLE period_reopen ADD CONSTRAINT period_reopen_scope_chk CHECK (scope_kind = 'PERIOD' OR cardinality(scope_project_ids) > 0);
ALTER TABLE period_reopen ADD CONSTRAINT period_reopen_window_chk CHECK (status <> 'APPROVED' OR window_until IS NOT NULL);

-- DIS: report_revision (existing, extended)
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'WEEKLY';
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS amendment_reason text;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS is_late boolean NOT NULL DEFAULT false;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS accepted_by uuid;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS returned_reason text;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS workflow_version_id uuid;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS client_operation_id uuid;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS deleted_reason text;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS created_by uuid;
-- migration: backfill report_revision.created_by, then ALTER TABLE report_revision ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE report_revision ADD COLUMN IF NOT EXISTS updated_by uuid;
-- migration: backfill report_revision.updated_by, then ALTER TABLE report_revision ALTER COLUMN updated_by SET NOT NULL;
CREATE POLICY tenant_guard ON report_revision AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE report_revision ADD CONSTRAINT report_revision_status_chk CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED','RETURNED','AMENDMENT_REQUESTED','SUPERSEDED','WITHDRAWN'));
ALTER TABLE report_revision ADD CONSTRAINT report_revision_type_chk CHECK (report_type IN ('WEEKLY','MONTHLY'));
ALTER TABLE report_revision ADD CONSTRAINT report_revision_source_chk CHECK (source_kind IN ('MANUAL','IMPORT','MOBILE','INTEGRATION'));
ALTER TABLE report_revision ADD CONSTRAINT report_revision_amend_chk CHECK (revision = 1 OR amendment_reason IS NOT NULL);
ALTER TABLE report_revision ADD CONSTRAINT report_revision_sod_chk CHECK (accepted_by IS NULL OR accepted_by <> submitted_by);
ALTER TABLE report_revision ADD CONSTRAINT report_revision_delete_chk CHECK (deleted_at IS NULL OR status = 'DRAFT');
CREATE UNIQUE INDEX report_revision_client_op_uq ON report_revision (tenant_id, client_operation_id) WHERE client_operation_id IS NOT NULL;

-- DIS: funding_snapshot_line (existing, extended)
ALTER TABLE funding_snapshot_line ADD COLUMN IF NOT EXISTS allocated_vnd numeric(24,0);
ALTER TABLE funding_snapshot_line ADD COLUMN IF NOT EXISTS next_month_ctmtqg_subset_vnd numeric(24,0);
ALTER TABLE funding_snapshot_line ADD COLUMN IF NOT EXISTS source_year integer;
ALTER TABLE funding_snapshot_line ADD COLUMN IF NOT EXISTS fund_source_version_id uuid;
ALTER TABLE funding_snapshot_line ADD COLUMN IF NOT EXISTS allocation_line_id uuid;
ALTER TABLE funding_snapshot_line ADD COLUMN IF NOT EXISTS source_reference text;
CREATE POLICY tenant_guard ON funding_snapshot_line AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE funding_snapshot_line ADD CONSTRAINT funding_line_bucket_chk CHECK (bucket IN ('CURRENT_YEAR','CARRYOVER','OTHER') AND budget_level IN ('CENTRAL','LOCAL'));
ALTER TABLE funding_snapshot_line ADD CONSTRAINT funding_line_money_chk CHECK (disbursed_cumulative_vnd >= 0 AND next_month_registered_vnd >= 0);
ALTER TABLE funding_snapshot_line ADD CONSTRAINT funding_line_subset_chk CHECK ((ctmtqg_subset_vnd IS NULL OR ctmtqg_subset_vnd <= disbursed_cumulative_vnd) AND (next_month_ctmtqg_subset_vnd IS NULL OR next_month_ctmtqg_subset_vnd <= next_month_registered_vnd));
ALTER TABLE funding_snapshot_line ADD CONSTRAINT funding_line_ctmtqg_bucket_chk CHECK (bucket <> 'OTHER' OR ctmtqg_subset_vnd IS NULL);
CREATE UNIQUE INDEX funding_line_cell_uq ON funding_snapshot_line (tenant_id, report_revision_id, bucket, budget_level);

-- DIS: progress_snapshot (existing, extended)
ALTER TABLE progress_snapshot ADD COLUMN IF NOT EXISTS as_of_date date;
ALTER TABLE progress_snapshot ADD COLUMN IF NOT EXISTS physical_progress_pct numeric(5,2);
CREATE POLICY tenant_guard ON progress_snapshot AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE progress_snapshot ADD CONSTRAINT progress_basis_chk CHECK (measurement_basis IN ('PERIOD','YTD','PROJECT_TO_DATE'));
ALTER TABLE progress_snapshot ADD CONSTRAINT progress_money_chk CHECK (construction_value_vnd >= 0 AND acceptance_value_vnd >= 0 AND treasury_submitted_value_vnd >= 0 AND preparing_dossier_value_vnd >= 0);
ALTER TABLE progress_snapshot ADD CONSTRAINT progress_pct_chk CHECK (physical_progress_pct IS NULL OR physical_progress_pct BETWEEN 0 AND 100);
CREATE UNIQUE INDEX progress_snapshot_revision_uq ON progress_snapshot (tenant_id, report_revision_id);

-- DIS: report_narrative
CREATE TABLE report_narrative (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  report_revision_id uuid NOT NULL,
  results_text text NOT NULL,
  causes_text text NOT NULL,
  solutions_text text NOT NULL,
  proposals_text text,
  linked_issue_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE report_narrative ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_narrative FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON report_narrative USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON report_narrative AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX report_narrative_revision_uq ON report_narrative (tenant_id, report_revision_id);

-- DIS: report_import_batch
CREATE TABLE report_import_batch (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  period_id uuid NOT NULL,
  file_object_key text NOT NULL,
  file_sha256 char(64) NOT NULL,
  mapping_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRY_RUN','VALIDATED','APPLIED','FAILED','CANCELLED')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  errors_json jsonb NOT NULL DEFAULT '[]',
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE report_import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_import_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON report_import_batch USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON report_import_batch AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX report_import_applied_uq ON report_import_batch (tenant_id, period_id, file_sha256) WHERE status = 'APPLIED';
ALTER TABLE report_import_batch ADD CONSTRAINT report_import_apply_chk CHECK (status <> 'APPLIED' OR error_rows = 0);

-- DIS: period_snapshot
CREATE TABLE period_snapshot (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  period_id uuid NOT NULL,
  snapshot_kind text NOT NULL CHECK (snapshot_kind IN ('PERIOD_CLOSE','ADHOC','MNE')),
  as_of_at timestamptz NOT NULL,
  as_of_date date NOT NULL,
  treasury_cutoff_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('BUILDING','FROZEN','SUPERSEDED','FAILED')),
  metric_set_version text NOT NULL,
  definition_status text NOT NULL CHECK (definition_status IN ('PROPOSED_PENDING_SIGNOFF','SIGNED')),
  row_count integer NOT NULL DEFAULT 0,
  payload_sha256 char(64),
  frozen_by uuid,
  frozen_at timestamptz,
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE period_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON period_snapshot USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON period_snapshot AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE period_snapshot ADD CONSTRAINT period_snapshot_frozen_chk CHECK (status NOT IN ('FROZEN','SUPERSEDED') OR (frozen_at IS NOT NULL AND payload_sha256 IS NOT NULL));
CREATE UNIQUE INDEX period_snapshot_current_uq ON period_snapshot (tenant_id, period_id, snapshot_kind) WHERE status = 'FROZEN';

-- DIS: period_snapshot_line
CREATE TABLE period_snapshot_line (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  fund_source_version_id uuid,
  bucket text NOT NULL CHECK (bucket IN ('CURRENT_YEAR','CARRYOVER','OTHER')),
  budget_level text NOT NULL CHECK (budget_level IN ('CENTRAL','LOCAL')),
  plan_pm_assigned_vnd numeric(24,0) NOT NULL DEFAULT 0,
  plan_local_added_vnd numeric(24,0) NOT NULL DEFAULT 0,
  plan_total_vnd numeric(24,0) NOT NULL DEFAULT 0,
  disbursed_treasury_vnd numeric(24,0),
  disbursed_reported_vnd numeric(24,0),
  period_delta_vnd numeric(24,0),
  registered_month_vnd numeric(24,0),
  forecast_eac_vnd numeric(24,0),
  ctmtqg_subset_vnd numeric(24,0),
  rate_pm_pct numeric(9,4),
  rate_total_pct numeric(9,4),
  rate_null_reason text,
  treasury_coverage text NOT NULL CHECK (treasury_coverage IN ('COMPLETE','PARTIAL','NONE')),
  report_revision_id uuid,
  plan_version_id uuid,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE period_snapshot_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_snapshot_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON period_snapshot_line USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON period_snapshot_line AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE period_snapshot_line ADD CONSTRAINT snapshot_line_plan_chk CHECK (plan_total_vnd = plan_pm_assigned_vnd + plan_local_added_vnd);
ALTER TABLE period_snapshot_line ADD CONSTRAINT snapshot_line_rate_chk CHECK ((rate_total_pct IS NOT NULL) OR rate_null_reason IN ('ZERO_DENOMINATOR','NO_DATA','TREASURY_COVERAGE_NONE'));
CREATE UNIQUE INDEX snapshot_line_cell_uq ON period_snapshot_line (tenant_id, snapshot_id, project_id, bucket, budget_level);

-- DIS: early_warning_rule
CREATE TABLE early_warning_rule (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_code text NOT NULL,
  name text NOT NULL,
  metric_code text NOT NULL,
  comparator text NOT NULL CHECK (comparator IN ('LT','LTE','GT','GTE','EQ','MISSING','CONSECUTIVE_ZERO','DAYS_TO_DEADLINE_LTE')),
  threshold_json jsonb NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('PROJECT','UNIT','TENANT')),
  auto_explanation boolean NOT NULL DEFAULT false,
  legal_basis text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE early_warning_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_warning_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON early_warning_rule USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON early_warning_rule AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX early_warning_rule_rev_uq ON early_warning_rule (tenant_id, rule_code, revision);
ALTER TABLE early_warning_rule ADD CONSTRAINT early_warning_rule_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);

-- DIS: early_warning
CREATE TABLE early_warning (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  project_id uuid,
  unit_id uuid,
  period_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  observed_json jsonb NOT NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','EXPLANATION_REQUESTED','RESOLVED','DISMISSED')),
  owner_membership_id uuid,
  explanation_request_id uuid,
  resolution_reason text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE early_warning ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_warning FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON early_warning USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON early_warning AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX early_warning_open_uq ON early_warning (tenant_id, dedupe_key) WHERE status IN ('OPEN','ACKNOWLEDGED','EXPLANATION_REQUESTED');
ALTER TABLE early_warning ADD CONSTRAINT early_warning_close_chk CHECK (status NOT IN ('RESOLVED','DISMISSED') OR (resolution_reason IS NOT NULL AND closed_at IS NOT NULL));
ALTER TABLE early_warning ADD CONSTRAINT early_warning_subject_chk CHECK (project_id IS NOT NULL OR unit_id IS NOT NULL);

-- DIS: disbursement_ranking
CREATE TABLE disbursement_ranking (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  comparison_group text NOT NULL,
  unit_id uuid NOT NULL,
  denominator_kind text NOT NULL CHECK (denominator_kind IN ('PM_ASSIGNED','TOTAL_INCL_LOCAL')),
  plan_vnd numeric(24,0) NOT NULL,
  disbursed_vnd numeric(24,0),
  rate_pct numeric(9,4),
  rank integer,
  excluded_reason text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE disbursement_ranking ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursement_ranking FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON disbursement_ranking USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON disbursement_ranking AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX disbursement_ranking_uq ON disbursement_ranking (tenant_id, snapshot_id, comparison_group, denominator_kind, unit_id);
ALTER TABLE disbursement_ranking ADD CONSTRAINT disbursement_ranking_rank_chk CHECK ((rank IS NULL) = (excluded_reason IS NOT NULL));

-- MDM: master_record
CREATE TABLE master_record (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  namespace text NOT NULL CHECK (namespace IN ('PLATFORM','TENANT')),
  master_type text NOT NULL,
  business_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','EFFECTIVE','RETIRED','MERGED')),
  steward_membership_id uuid,
  current_version_id uuid,
  merged_into_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE master_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON master_record USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON master_record AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX master_record_key_uq ON master_record (tenant_id, namespace, master_type, business_key);
ALTER TABLE master_record ADD CONSTRAINT master_record_merged_chk CHECK ((status = 'MERGED') = (merged_into_id IS NOT NULL));

-- MDM: master_record_version (existing, extended)
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS master_record_id uuid;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'TENANT';
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS change_request_id uuid;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS legal_basis text;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS content_sha256 char(64);
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS recorded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS created_by uuid;
-- migration: backfill master_record_version.created_by, then ALTER TABLE master_record_version ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS updated_by uuid;
-- migration: backfill master_record_version.updated_by, then ALTER TABLE master_record_version ALTER COLUMN updated_by SET NOT NULL;
ALTER TABLE master_record_version ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE POLICY tenant_guard ON master_record_version AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE master_record_version ADD CONSTRAINT master_version_status_chk CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','EFFECTIVE','RETIRED'));
ALTER TABLE master_record_version ADD CONSTRAINT master_version_range_chk CHECK (valid_until IS NULL OR valid_until > valid_from);
ALTER TABLE master_record_version ADD CONSTRAINT master_version_no_overlap EXCLUDE USING gist (tenant_id WITH =, master_record_id WITH =, daterange(valid_from, valid_until, '[)') WITH &&) WHERE (status IN ('APPROVED','EFFECTIVE','RETIRED'));
CREATE UNIQUE INDEX master_version_rev_uq ON master_record_version (tenant_id, master_record_id, revision);
CREATE INDEX master_version_type_code_idx ON master_record_version (tenant_id, master_type, code);

-- MDM: master_change_request
CREATE TABLE master_change_request (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('CREATE','UPDATE','RETIRE','MERGE','UNMERGE','RESTRUCTURE','SUCCESSION')),
  master_type text NOT NULL,
  master_record_id uuid,
  proposed_json jsonb NOT NULL,
  before_json jsonb,
  reason text NOT NULL,
  evidence_document_id uuid,
  impact_json jsonb,
  batch_id uuid,
  effective_from date NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','APPLIED','CANCELLED')),
  reviewed_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE master_change_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_change_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON master_change_request USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON master_change_request AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE master_change_request ADD CONSTRAINT master_cr_sod_chk CHECK (reviewed_by IS NULL OR reviewed_by <> created_by);
ALTER TABLE master_change_request ADD CONSTRAINT master_cr_impact_chk CHECK (status IN ('DRAFT','CANCELLED') OR impact_json IS NOT NULL);

-- MDM: master_crosswalk
CREATE TABLE master_crosswalk (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  master_record_id uuid NOT NULL,
  source_system text NOT NULL,
  external_type text NOT NULL,
  external_code text NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  match_method text NOT NULL CHECK (match_method IN ('MANUAL','IMPORT','RULE')),
  confidence numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE master_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_crosswalk FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON master_crosswalk USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON master_crosswalk AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX master_crosswalk_active_uq ON master_crosswalk (tenant_id, source_system, external_type, external_code) WHERE status = 'ACTIVE';

-- MDM: master_merge
CREATE TABLE master_merge (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  survivor_record_id uuid NOT NULL,
  merged_record_id uuid NOT NULL,
  survivorship_json jsonb NOT NULL,
  alias_json jsonb NOT NULL,
  repointed_refs_json jsonb NOT NULL,
  reason text NOT NULL,
  change_request_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLIED','REVERTED')),
  applied_at timestamptz NOT NULL,
  reverted_by uuid,
  reverted_at timestamptz,
  revert_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE master_merge ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_merge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON master_merge USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON master_merge AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE master_merge ADD CONSTRAINT master_merge_distinct_chk CHECK (survivor_record_id <> merged_record_id);
ALTER TABLE master_merge ADD CONSTRAINT master_merge_revert_chk CHECK (status <> 'REVERTED' OR (reverted_by IS NOT NULL AND revert_reason IS NOT NULL));
CREATE UNIQUE INDEX master_merge_active_uq ON master_merge (tenant_id, merged_record_id) WHERE status = 'APPLIED';

-- MDM: survivorship_rule
CREATE TABLE survivorship_rule (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  master_type text NOT NULL,
  attribute_name text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('SOURCE_PRIORITY','MOST_RECENT','MOST_COMPLETE','STEWARD_DECISION')),
  source_priority text[],
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  effective_from date NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE survivorship_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE survivorship_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON survivorship_rule USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON survivorship_rule AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX survivorship_rule_rev_uq ON survivorship_rule (tenant_id, master_type, attribute_name, revision);
ALTER TABLE survivorship_rule ADD CONSTRAINT survivorship_priority_chk CHECK (strategy <> 'SOURCE_PRIORITY' OR cardinality(source_priority) > 0);

-- MDM: glossary_term
CREATE TABLE glossary_term (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  term_code text NOT NULL,
  term_vi text NOT NULL,
  definition text NOT NULL,
  formula_ref text,
  domain text NOT NULL,
  owner_membership_id uuid NOT NULL,
  legal_basis text,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','DEPRECATED','REJECTED')),
  approved_by uuid,
  effective_from date,
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE glossary_term ENABLE ROW LEVEL SECURITY;
ALTER TABLE glossary_term FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON glossary_term USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON glossary_term AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX glossary_term_rev_uq ON glossary_term (tenant_id, term_code, revision);
CREATE UNIQUE INDEX glossary_term_published_uq ON glossary_term (tenant_id, term_code) WHERE status = 'PUBLISHED';
ALTER TABLE glossary_term ADD CONSTRAINT glossary_term_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);

-- MDM: master_import_batch
CREATE TABLE master_import_batch (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  master_type text NOT NULL,
  file_object_key text NOT NULL,
  file_sha256 char(64) NOT NULL,
  mapping_json jsonb NOT NULL,
  mode text NOT NULL CHECK (mode IN ('ATOMIC','PARTIAL')),
  status text NOT NULL CHECK (status IN ('STAGED','VALIDATED','IN_REVIEW','APPLIED','FAILED','CANCELLED')),
  total_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  errors_json jsonb NOT NULL DEFAULT '[]',
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE master_import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_import_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON master_import_batch USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON master_import_batch AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX master_import_applied_uq ON master_import_batch (tenant_id, master_type, file_sha256) WHERE status = 'APPLIED';
ALTER TABLE master_import_batch ADD CONSTRAINT master_import_atomic_chk CHECK (status <> 'APPLIED' OR mode = 'PARTIAL' OR error_rows = 0);

-- MDM: master_succession
CREATE TABLE master_succession (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  predecessor_record_id uuid NOT NULL,
  successor_record_id uuid NOT NULL,
  succession_kind text NOT NULL CHECK (succession_kind IN ('MERGE','SPLIT','RENAME','RELEVEL','ABOLISH_LEVEL')),
  effective_date date NOT NULL,
  share_pct numeric(5,2) CHECK (share_pct IS NULL OR share_pct BETWEEN 0 AND 100),
  legal_basis text NOT NULL,
  change_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE master_succession ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_succession FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON master_succession USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON master_succession AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE master_succession ADD CONSTRAINT master_succession_distinct_chk CHECK (predecessor_record_id <> successor_record_id);
CREATE UNIQUE INDEX master_succession_uq ON master_succession (tenant_id, predecessor_record_id, successor_record_id, effective_date);

-- MDM: integration_cursor (existing, extended)
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS adapter_status text NOT NULL DEFAULT 'PROPOSED';
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS last_file_sha256 char(64);
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS reset_reason text;
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE integration_cursor ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
CREATE POLICY tenant_guard ON integration_cursor AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE integration_cursor ADD CONSTRAINT integration_cursor_adapter_chk CHECK (adapter_status IN ('VERIFIED','PROPOSED','MOCK','MISSING') AND status IN ('ACTIVE','PAUSED','FAILED'));
CREATE UNIQUE INDEX integration_cursor_scope_uq ON integration_cursor (tenant_id, connector_code, source_scope);

-- MNE: mne_report_form
CREATE TABLE mne_report_form (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  form_code text NOT NULL,
  title text NOT NULL,
  report_kind text NOT NULL CHECK (report_kind IN ('OVERALL_SEMIANNUAL','OVERALL_ANNUAL','PROJECT_START','PROJECT_ADJUST','PROJECT_COMPLETION','PROJECT_PERIODIC','EVALUATION','WEEKLY_QUICK')),
  legal_basis text NOT NULL,
  legal_confirmation_ref text,
  effective_from date NOT NULL,
  effective_until date,
  schema_json jsonb NOT NULL,
  doc_template_code text NOT NULL,
  export_formats text[] NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE mne_report_form ENABLE ROW LEVEL SECURITY;
ALTER TABLE mne_report_form FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON mne_report_form USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON mne_report_form AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX mne_form_rev_uq ON mne_report_form (tenant_id, form_code, revision);
ALTER TABLE mne_report_form ADD CONSTRAINT mne_form_range_chk CHECK (effective_until IS NULL OR effective_until > effective_from);

-- MNE: mne_obligation_rule
CREATE TABLE mne_obligation_rule (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_code text NOT NULL,
  form_id uuid NOT NULL,
  reporting_role text NOT NULL CHECK (reporting_role IN ('INVESTOR','PROJECT_OWNER_AGENCY','PROVINCIAL_PEOPLE_COMMITTEE','PLANNING_AGENCY')),
  recipient text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('WEEKLY','SEMIANNUAL','ANNUAL','EVENT')),
  due_rule_json jsonb NOT NULL,
  legal_basis text NOT NULL,
  legal_confirmation_ref text,
  effective_from date NOT NULL,
  effective_until date,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE mne_obligation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE mne_obligation_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON mne_obligation_rule USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON mne_obligation_rule AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX mne_obligation_rev_uq ON mne_obligation_rule (tenant_id, rule_code, revision);

-- MNE: mne_report
CREATE TABLE mne_report (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  form_id uuid NOT NULL,
  obligation_rule_id uuid,
  report_year integer NOT NULL,
  period_label text NOT NULL,
  period_id uuid,
  scope_unit_id uuid NOT NULL,
  project_id uuid,
  snapshot_id uuid,
  due_date date NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','ISSUING','ISSUED','EXPORTED','SUBMITTED_EXTERNAL','RETURNED','SUPERSEDED')),
  is_late boolean NOT NULL DEFAULT false,
  payload_json jsonb NOT NULL,
  payload_sha256 char(64),
  doc_document_id uuid,
  supersedes_id uuid,
  correction_reason text,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE mne_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE mne_report FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON mne_report USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON mne_report AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE UNIQUE INDEX mne_report_rev_uq ON mne_report (tenant_id, form_id, scope_unit_id, project_id, report_year, period_label, revision) NULLS NOT DISTINCT;
ALTER TABLE mne_report ADD CONSTRAINT mne_report_correction_chk CHECK (revision = 1 OR correction_reason IS NOT NULL);
ALTER TABLE mne_report ADD CONSTRAINT mne_report_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);
ALTER TABLE mne_report ADD CONSTRAINT mne_report_issued_chk CHECK (status NOT IN ('ISSUED','EXPORTED','SUBMITTED_EXTERNAL') OR (doc_document_id IS NOT NULL AND payload_sha256 IS NOT NULL));

-- MNE: mne_export_package
CREATE TABLE mne_export_package (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  mne_report_id uuid NOT NULL,
  target_system text NOT NULL CHECK (target_system IN ('NATIONAL_PIM_SYSTEM','RECIPIENT_AGENCY','LGSP')),
  format text NOT NULL CHECK (format IN ('XLSX','PDF','XML','CSV')),
  object_key text NOT NULL,
  file_sha256 char(64) NOT NULL,
  adapter_status text NOT NULL CHECK (adapter_status IN ('VERIFIED','PROPOSED','MOCK','MISSING')),
  status text NOT NULL CHECK (status IN ('GENERATED','DOWNLOADED','SUBMISSION_CONFIRMED','REJECTED','EXPIRED')),
  receipt_reference text,
  receipt_document_id uuid,
  receipt_recorded_by uuid,
  receipt_recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE mne_export_package ENABLE ROW LEVEL SECURITY;
ALTER TABLE mne_export_package FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON mne_export_package USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON mne_export_package AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE mne_export_package ADD CONSTRAINT mne_export_receipt_chk CHECK (status <> 'SUBMISSION_CONFIRMED' OR (receipt_reference IS NOT NULL AND receipt_recorded_at IS NOT NULL));
CREATE UNIQUE INDEX mne_export_file_uq ON mne_export_package (tenant_id, mne_report_id, target_system, format, file_sha256);

-- MNE: mne_evaluation
CREATE TABLE mne_evaluation (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  evaluation_kind text NOT NULL CHECK (evaluation_kind IN ('INITIAL','MIDTERM','FINAL','IMPACT','AD_HOC')),
  evaluator_kind text NOT NULL CHECK (evaluator_kind IN ('INTERNAL','INDEPENDENT_CONSULTANT')),
  evaluator_name text NOT NULL,
  scope_text text NOT NULL,
  findings_json jsonb NOT NULL DEFAULT '[]',
  conclusion text CHECK (conclusion IS NULL OR conclusion IN ('SATISFACTORY','PARTIALLY_SATISFACTORY','UNSATISFACTORY')),
  recommendations_text text,
  status text NOT NULL CHECK (status IN ('PLANNED','IN_PROGRESS','SUBMITTED','APPROVED','RETURNED')),
  report_document_id uuid,
  mne_report_id uuid,
  planned_date date NOT NULL,
  completed_date date,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE mne_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mne_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON mne_evaluation USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON mne_evaluation AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE mne_evaluation ADD CONSTRAINT mne_evaluation_submit_chk CHECK (status NOT IN ('SUBMITTED','APPROVED') OR (conclusion IS NOT NULL AND completed_date IS NOT NULL));
ALTER TABLE mne_evaluation ADD CONSTRAINT mne_evaluation_sod_chk CHECK (approved_by IS NULL OR approved_by <> created_by);

-- Foreign keys (composite, tenant-scoped)
ALTER TABLE project ADD FOREIGN KEY (tenant_id, investor_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE project ADD FOREIGN KEY (tenant_id, decision_authority_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE project ADD FOREIGN KEY (tenant_id, sector_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE project ADD FOREIGN KEY (tenant_id, project_type_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE project ADD FOREIGN KEY (tenant_id, program_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE project ADD FOREIGN KEY (tenant_id, area_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE project_revision ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_revision ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES project_revision(tenant_id, id);
ALTER TABLE project_component ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_component ADD FOREIGN KEY (tenant_id, parent_component_id) REFERENCES project_component(tenant_id, id);
ALTER TABLE project_milestone ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_milestone ADD FOREIGN KEY (tenant_id, component_id) REFERENCES project_component(tenant_id, id);
ALTER TABLE project_milestone ADD FOREIGN KEY (tenant_id, depends_on_milestone_id) REFERENCES project_milestone(tenant_id, id);
ALTER TABLE project_appraisal ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_appraisal ADD FOREIGN KEY (tenant_id, criteria_set_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE project_appraisal ADD FOREIGN KEY (tenant_id, appraiser_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE project_risk ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_risk ADD FOREIGN KEY (tenant_id, category_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE project_risk ADD FOREIGN KEY (tenant_id, owner_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE project_risk ADD FOREIGN KEY (tenant_id, linked_issue_id) REFERENCES issue(tenant_id, id);
ALTER TABLE project_accountability ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_accountability ADD FOREIGN KEY (tenant_id, leader_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE task_force ADD FOREIGN KEY (tenant_id, lead_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE task_force ADD FOREIGN KEY (tenant_id, scope_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE task_force_member ADD FOREIGN KEY (tenant_id, task_force_id) REFERENCES task_force(tenant_id, id);
ALTER TABLE task_force_member ADD FOREIGN KEY (tenant_id, membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE task_force_member ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE explanation_request ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE explanation_request ADD FOREIGN KEY (tenant_id, unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE explanation_request ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE explanation_request ADD FOREIGN KEY (tenant_id, requested_from_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE project_transfer ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE project_transfer ADD FOREIGN KEY (tenant_id, from_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE project_transfer ADD FOREIGN KEY (tenant_id, to_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE capital_plan ADD FOREIGN KEY (tenant_id, scope_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE capital_plan ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES capital_plan(tenant_id, id);
ALTER TABLE plan_version ADD FOREIGN KEY (tenant_id, capital_plan_id) REFERENCES capital_plan(tenant_id, id);
ALTER TABLE plan_version ADD FOREIGN KEY (tenant_id, superseded_by_id) REFERENCES plan_version(tenant_id, id);
ALTER TABLE appropriation ADD FOREIGN KEY (tenant_id, capital_plan_id) REFERENCES capital_plan(tenant_id, id);
ALTER TABLE appropriation ADD FOREIGN KEY (tenant_id, fund_source_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE appropriation ADD FOREIGN KEY (tenant_id, program_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE appropriation ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES appropriation(tenant_id, id);
ALTER TABLE allocation_line ADD FOREIGN KEY (tenant_id, appropriation_id) REFERENCES appropriation(tenant_id, id);
ALTER TABLE allocation_line ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE allocation_line ADD FOREIGN KEY (tenant_id, program_master_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE allocation_line ADD FOREIGN KEY (tenant_id, previous_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE allocation_line ADD FOREIGN KEY (tenant_id, fund_source_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE allocation_balance ADD FOREIGN KEY (tenant_id, allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE capital_ledger_entry ADD FOREIGN KEY (tenant_id, appropriation_id) REFERENCES appropriation(tenant_id, id);
ALTER TABLE capital_ledger_entry ADD FOREIGN KEY (tenant_id, allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE capital_ledger_entry ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE capital_ledger_entry ADD FOREIGN KEY (tenant_id, reversal_of_id) REFERENCES capital_ledger_entry(tenant_id, id);
ALTER TABLE fund_reservation ADD FOREIGN KEY (tenant_id, allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE fund_reservation ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE reallocation_proposal ADD FOREIGN KEY (tenant_id, scope_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE reallocation_proposal ADD FOREIGN KEY (tenant_id, basis_snapshot_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE reallocation_proposal ADD FOREIGN KEY (tenant_id, source_capital_plan_id) REFERENCES capital_plan(tenant_id, id);
ALTER TABLE reallocation_proposal ADD FOREIGN KEY (tenant_id, resulting_capital_plan_id) REFERENCES capital_plan(tenant_id, id);
ALTER TABLE reallocation_line ADD FOREIGN KEY (tenant_id, proposal_id) REFERENCES reallocation_proposal(tenant_id, id);
ALTER TABLE reallocation_line ADD FOREIGN KEY (tenant_id, from_allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE reallocation_line ADD FOREIGN KEY (tenant_id, from_project_id) REFERENCES project(tenant_id, id);
ALTER TABLE reallocation_line ADD FOREIGN KEY (tenant_id, to_project_id) REFERENCES project(tenant_id, id);
ALTER TABLE allocation_extension ADD FOREIGN KEY (tenant_id, allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE allocation_extension ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE allocation_extension ADD FOREIGN KEY (tenant_id, new_allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE disbursement_schedule_line ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE disbursement_schedule_line ADD FOREIGN KEY (tenant_id, allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE disbursement_schedule_line ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE disbursement_schedule_line ADD FOREIGN KEY (tenant_id, source_report_revision_id) REFERENCES report_revision(tenant_id, id);
ALTER TABLE disbursement_schedule_line ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES disbursement_schedule_line(tenant_id, id);
ALTER TABLE allocation_scenario ADD FOREIGN KEY (tenant_id, input_snapshot_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE allocation_scenario ADD FOREIGN KEY (tenant_id, base_capital_plan_id) REFERENCES capital_plan(tenant_id, id);
ALTER TABLE allocation_scenario ADD FOREIGN KEY (tenant_id, promoted_proposal_id) REFERENCES reallocation_proposal(tenant_id, id);
ALTER TABLE period_reopen ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE report_revision ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES report_revision(tenant_id, id);
ALTER TABLE report_revision ADD FOREIGN KEY (tenant_id, workflow_version_id) REFERENCES workflow_version(tenant_id, id);
ALTER TABLE report_revision ADD FOREIGN KEY (tenant_id, import_batch_id) REFERENCES report_import_batch(tenant_id, id);
ALTER TABLE funding_snapshot_line ADD FOREIGN KEY (tenant_id, fund_source_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE funding_snapshot_line ADD FOREIGN KEY (tenant_id, allocation_line_id) REFERENCES allocation_line(tenant_id, id);
ALTER TABLE report_narrative ADD FOREIGN KEY (tenant_id, report_revision_id) REFERENCES report_revision(tenant_id, id);
ALTER TABLE report_import_batch ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE period_snapshot ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE period_snapshot ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE period_snapshot_line ADD FOREIGN KEY (tenant_id, snapshot_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE period_snapshot_line ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE period_snapshot_line ADD FOREIGN KEY (tenant_id, unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE period_snapshot_line ADD FOREIGN KEY (tenant_id, fund_source_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE period_snapshot_line ADD FOREIGN KEY (tenant_id, report_revision_id) REFERENCES report_revision(tenant_id, id);
ALTER TABLE period_snapshot_line ADD FOREIGN KEY (tenant_id, plan_version_id) REFERENCES plan_version(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, rule_id) REFERENCES early_warning_rule(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, snapshot_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, owner_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE early_warning ADD FOREIGN KEY (tenant_id, explanation_request_id) REFERENCES explanation_request(tenant_id, id);
ALTER TABLE disbursement_ranking ADD FOREIGN KEY (tenant_id, snapshot_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE disbursement_ranking ADD FOREIGN KEY (tenant_id, unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE master_record ADD FOREIGN KEY (tenant_id, steward_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE master_record ADD FOREIGN KEY (tenant_id, merged_into_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_record_version ADD FOREIGN KEY (tenant_id, master_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_record_version ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE master_record_version ADD FOREIGN KEY (tenant_id, change_request_id) REFERENCES master_change_request(tenant_id, id);
ALTER TABLE master_change_request ADD FOREIGN KEY (tenant_id, master_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_change_request ADD FOREIGN KEY (tenant_id, batch_id) REFERENCES master_import_batch(tenant_id, id);
ALTER TABLE master_crosswalk ADD FOREIGN KEY (tenant_id, master_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_merge ADD FOREIGN KEY (tenant_id, survivor_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_merge ADD FOREIGN KEY (tenant_id, merged_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_merge ADD FOREIGN KEY (tenant_id, change_request_id) REFERENCES master_change_request(tenant_id, id);
ALTER TABLE glossary_term ADD FOREIGN KEY (tenant_id, owner_membership_id) REFERENCES membership(tenant_id, id);
ALTER TABLE glossary_term ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES glossary_term(tenant_id, id);
ALTER TABLE master_succession ADD FOREIGN KEY (tenant_id, predecessor_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_succession ADD FOREIGN KEY (tenant_id, successor_record_id) REFERENCES master_record(tenant_id, id);
ALTER TABLE master_succession ADD FOREIGN KEY (tenant_id, change_request_id) REFERENCES master_change_request(tenant_id, id);
ALTER TABLE mne_obligation_rule ADD FOREIGN KEY (tenant_id, form_id) REFERENCES mne_report_form(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, form_id) REFERENCES mne_report_form(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, obligation_rule_id) REFERENCES mne_obligation_rule(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, period_id) REFERENCES reporting_period(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, scope_unit_id) REFERENCES organization_unit(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, snapshot_id) REFERENCES period_snapshot(tenant_id, id);
ALTER TABLE mne_report ADD FOREIGN KEY (tenant_id, supersedes_id) REFERENCES mne_report(tenant_id, id);
ALTER TABLE mne_export_package ADD FOREIGN KEY (tenant_id, mne_report_id) REFERENCES mne_report(tenant_id, id);
ALTER TABLE mne_evaluation ADD FOREIGN KEY (tenant_id, project_id) REFERENCES project(tenant_id, id);
ALTER TABLE mne_evaluation ADD FOREIGN KEY (tenant_id, mne_report_id) REFERENCES mne_report(tenant_id, id);
ALTER TABLE explanation_request ADD FOREIGN KEY (tenant_id, warning_id) REFERENCES early_warning(tenant_id, id);
ALTER TABLE master_record ADD FOREIGN KEY (tenant_id, current_version_id) REFERENCES master_record_version(tenant_id, id);
ALTER TABLE master_record_version ADD FOREIGN KEY (tenant_id, parent_id) REFERENCES master_record(tenant_id, id);

-- Index for every *_id column of owned tables (tenant_id leading)
CREATE INDEX IF NOT EXISTS project_owner_unit_id_idx ON project (tenant_id, owner_unit_id);
CREATE INDEX IF NOT EXISTS project_area_master_version_id_idx ON project (tenant_id, area_master_version_id);
CREATE INDEX IF NOT EXISTS project_investor_unit_id_idx ON project (tenant_id, investor_unit_id);
CREATE INDEX IF NOT EXISTS project_decision_authority_unit_id_idx ON project (tenant_id, decision_authority_unit_id);
CREATE INDEX IF NOT EXISTS project_sector_master_version_id_idx ON project (tenant_id, sector_master_version_id);
CREATE INDEX IF NOT EXISTS project_project_type_master_version_id_idx ON project (tenant_id, project_type_master_version_id);
CREATE INDEX IF NOT EXISTS project_program_master_version_id_idx ON project (tenant_id, program_master_version_id);
CREATE INDEX IF NOT EXISTS project_policy_decision_document_id_idx ON project (tenant_id, policy_decision_document_id);
CREATE INDEX IF NOT EXISTS project_investment_decision_document_id_idx ON project (tenant_id, investment_decision_document_id);
CREATE INDEX IF NOT EXISTS project_revision_project_id_idx ON project_revision (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_revision_decision_document_id_idx ON project_revision (tenant_id, decision_document_id);
CREATE INDEX IF NOT EXISTS project_revision_supersedes_id_idx ON project_revision (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS project_component_project_id_idx ON project_component (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_component_parent_component_id_idx ON project_component (tenant_id, parent_component_id);
CREATE INDEX IF NOT EXISTS project_milestone_project_id_idx ON project_milestone (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_milestone_component_id_idx ON project_milestone (tenant_id, component_id);
CREATE INDEX IF NOT EXISTS project_milestone_depends_on_milestone_id_idx ON project_milestone (tenant_id, depends_on_milestone_id);
CREATE INDEX IF NOT EXISTS project_appraisal_project_id_idx ON project_appraisal (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_appraisal_criteria_set_version_id_idx ON project_appraisal (tenant_id, criteria_set_version_id);
CREATE INDEX IF NOT EXISTS project_appraisal_appraiser_membership_id_idx ON project_appraisal (tenant_id, appraiser_membership_id);
CREATE INDEX IF NOT EXISTS project_appraisal_decision_document_id_idx ON project_appraisal (tenant_id, decision_document_id);
CREATE INDEX IF NOT EXISTS project_risk_project_id_idx ON project_risk (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_risk_category_master_version_id_idx ON project_risk (tenant_id, category_master_version_id);
CREATE INDEX IF NOT EXISTS project_risk_owner_membership_id_idx ON project_risk (tenant_id, owner_membership_id);
CREATE INDEX IF NOT EXISTS project_risk_linked_issue_id_idx ON project_risk (tenant_id, linked_issue_id);
CREATE INDEX IF NOT EXISTS project_accountability_project_id_idx ON project_accountability (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_accountability_leader_membership_id_idx ON project_accountability (tenant_id, leader_membership_id);
CREATE INDEX IF NOT EXISTS project_accountability_assignment_document_id_idx ON project_accountability (tenant_id, assignment_document_id);
CREATE INDEX IF NOT EXISTS task_force_lead_membership_id_idx ON task_force (tenant_id, lead_membership_id);
CREATE INDEX IF NOT EXISTS task_force_scope_unit_id_idx ON task_force (tenant_id, scope_unit_id);
CREATE INDEX IF NOT EXISTS task_force_establishment_document_id_idx ON task_force (tenant_id, establishment_document_id);
CREATE INDEX IF NOT EXISTS task_force_member_task_force_id_idx ON task_force_member (tenant_id, task_force_id);
CREATE INDEX IF NOT EXISTS task_force_member_membership_id_idx ON task_force_member (tenant_id, membership_id);
CREATE INDEX IF NOT EXISTS task_force_member_project_id_idx ON task_force_member (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS explanation_request_project_id_idx ON explanation_request (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS explanation_request_unit_id_idx ON explanation_request (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS explanation_request_period_id_idx ON explanation_request (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS explanation_request_warning_id_idx ON explanation_request (tenant_id, warning_id);
CREATE INDEX IF NOT EXISTS explanation_request_requested_from_membership_id_idx ON explanation_request (tenant_id, requested_from_membership_id);
CREATE INDEX IF NOT EXISTS explanation_request_response_document_id_idx ON explanation_request (tenant_id, response_document_id);
CREATE INDEX IF NOT EXISTS project_transfer_project_id_idx ON project_transfer (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS project_transfer_from_unit_id_idx ON project_transfer (tenant_id, from_unit_id);
CREATE INDEX IF NOT EXISTS project_transfer_to_unit_id_idx ON project_transfer (tenant_id, to_unit_id);
CREATE INDEX IF NOT EXISTS project_transfer_decision_document_id_idx ON project_transfer (tenant_id, decision_document_id);
CREATE INDEX IF NOT EXISTS capital_plan_scope_unit_id_idx ON capital_plan (tenant_id, scope_unit_id);
CREATE INDEX IF NOT EXISTS capital_plan_decision_document_id_idx ON capital_plan (tenant_id, decision_document_id);
CREATE INDEX IF NOT EXISTS capital_plan_supersedes_id_idx ON capital_plan (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS plan_version_project_id_idx ON plan_version (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS plan_version_decision_id_idx ON plan_version (tenant_id, decision_id);
CREATE INDEX IF NOT EXISTS plan_version_capital_plan_id_idx ON plan_version (tenant_id, capital_plan_id);
CREATE INDEX IF NOT EXISTS plan_version_superseded_by_id_idx ON plan_version (tenant_id, superseded_by_id);
CREATE INDEX IF NOT EXISTS appropriation_capital_plan_id_idx ON appropriation (tenant_id, capital_plan_id);
CREATE INDEX IF NOT EXISTS appropriation_fund_source_version_id_idx ON appropriation (tenant_id, fund_source_version_id);
CREATE INDEX IF NOT EXISTS appropriation_program_master_version_id_idx ON appropriation (tenant_id, program_master_version_id);
CREATE INDEX IF NOT EXISTS appropriation_decision_document_id_idx ON appropriation (tenant_id, decision_document_id);
CREATE INDEX IF NOT EXISTS appropriation_extension_document_id_idx ON appropriation (tenant_id, extension_document_id);
CREATE INDEX IF NOT EXISTS appropriation_supersedes_id_idx ON appropriation (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS allocation_line_plan_version_id_idx ON allocation_line (tenant_id, plan_version_id);
CREATE INDEX IF NOT EXISTS allocation_line_fund_source_version_id_idx ON allocation_line (tenant_id, fund_source_version_id);
CREATE INDEX IF NOT EXISTS allocation_line_appropriation_id_idx ON allocation_line (tenant_id, appropriation_id);
CREATE INDEX IF NOT EXISTS allocation_line_project_id_idx ON allocation_line (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS allocation_line_extension_document_id_idx ON allocation_line (tenant_id, extension_document_id);
CREATE INDEX IF NOT EXISTS allocation_line_program_master_version_id_idx ON allocation_line (tenant_id, program_master_version_id);
CREATE INDEX IF NOT EXISTS allocation_line_previous_line_id_idx ON allocation_line (tenant_id, previous_line_id);
CREATE INDEX IF NOT EXISTS allocation_balance_allocation_line_id_idx ON allocation_balance (tenant_id, allocation_line_id);
CREATE INDEX IF NOT EXISTS capital_ledger_entry_appropriation_id_idx ON capital_ledger_entry (tenant_id, appropriation_id);
CREATE INDEX IF NOT EXISTS capital_ledger_entry_allocation_line_id_idx ON capital_ledger_entry (tenant_id, allocation_line_id);
CREATE INDEX IF NOT EXISTS capital_ledger_entry_project_id_idx ON capital_ledger_entry (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS capital_ledger_entry_source_ref_id_idx ON capital_ledger_entry (tenant_id, source_ref_id);
CREATE INDEX IF NOT EXISTS capital_ledger_entry_reversal_of_id_idx ON capital_ledger_entry (tenant_id, reversal_of_id);
CREATE INDEX IF NOT EXISTS fund_reservation_allocation_line_id_idx ON fund_reservation (tenant_id, allocation_line_id);
CREATE INDEX IF NOT EXISTS fund_reservation_project_id_idx ON fund_reservation (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS fund_reservation_reference_id_idx ON fund_reservation (tenant_id, reference_id);
CREATE INDEX IF NOT EXISTS avc_policy_scope_ref_id_idx ON avc_policy (tenant_id, scope_ref_id);
CREATE INDEX IF NOT EXISTS reallocation_proposal_scope_unit_id_idx ON reallocation_proposal (tenant_id, scope_unit_id);
CREATE INDEX IF NOT EXISTS reallocation_proposal_basis_snapshot_id_idx ON reallocation_proposal (tenant_id, basis_snapshot_id);
CREATE INDEX IF NOT EXISTS reallocation_proposal_source_capital_plan_id_idx ON reallocation_proposal (tenant_id, source_capital_plan_id);
CREATE INDEX IF NOT EXISTS reallocation_proposal_decision_document_id_idx ON reallocation_proposal (tenant_id, decision_document_id);
CREATE INDEX IF NOT EXISTS reallocation_proposal_resulting_capital_plan_id_idx ON reallocation_proposal (tenant_id, resulting_capital_plan_id);
CREATE INDEX IF NOT EXISTS reallocation_line_proposal_id_idx ON reallocation_line (tenant_id, proposal_id);
CREATE INDEX IF NOT EXISTS reallocation_line_from_allocation_line_id_idx ON reallocation_line (tenant_id, from_allocation_line_id);
CREATE INDEX IF NOT EXISTS reallocation_line_from_project_id_idx ON reallocation_line (tenant_id, from_project_id);
CREATE INDEX IF NOT EXISTS reallocation_line_to_project_id_idx ON reallocation_line (tenant_id, to_project_id);
CREATE INDEX IF NOT EXISTS allocation_extension_allocation_line_id_idx ON allocation_extension (tenant_id, allocation_line_id);
CREATE INDEX IF NOT EXISTS allocation_extension_project_id_idx ON allocation_extension (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS allocation_extension_approving_document_id_idx ON allocation_extension (tenant_id, approving_document_id);
CREATE INDEX IF NOT EXISTS allocation_extension_new_allocation_line_id_idx ON allocation_extension (tenant_id, new_allocation_line_id);
CREATE INDEX IF NOT EXISTS disbursement_schedule_line_project_id_idx ON disbursement_schedule_line (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS disbursement_schedule_line_allocation_line_id_idx ON disbursement_schedule_line (tenant_id, allocation_line_id);
CREATE INDEX IF NOT EXISTS disbursement_schedule_line_period_id_idx ON disbursement_schedule_line (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS disbursement_schedule_line_source_report_revision_id_idx ON disbursement_schedule_line (tenant_id, source_report_revision_id);
CREATE INDEX IF NOT EXISTS disbursement_schedule_line_supersedes_id_idx ON disbursement_schedule_line (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS allocation_scenario_input_snapshot_id_idx ON allocation_scenario (tenant_id, input_snapshot_id);
CREATE INDEX IF NOT EXISTS allocation_scenario_base_capital_plan_id_idx ON allocation_scenario (tenant_id, base_capital_plan_id);
CREATE INDEX IF NOT EXISTS allocation_scenario_promoted_proposal_id_idx ON allocation_scenario (tenant_id, promoted_proposal_id);
CREATE INDEX IF NOT EXISTS period_reopen_period_id_idx ON period_reopen (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS report_revision_project_id_idx ON report_revision (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS report_revision_period_id_idx ON report_revision (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS report_revision_plan_version_id_idx ON report_revision (tenant_id, plan_version_id);
CREATE INDEX IF NOT EXISTS report_revision_supersedes_id_idx ON report_revision (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS report_revision_workflow_version_id_idx ON report_revision (tenant_id, workflow_version_id);
CREATE INDEX IF NOT EXISTS report_revision_import_batch_id_idx ON report_revision (tenant_id, import_batch_id);
CREATE INDEX IF NOT EXISTS report_revision_client_operation_id_idx ON report_revision (tenant_id, client_operation_id);
CREATE INDEX IF NOT EXISTS funding_snapshot_line_report_revision_id_idx ON funding_snapshot_line (tenant_id, report_revision_id);
CREATE INDEX IF NOT EXISTS funding_snapshot_line_fund_source_version_id_idx ON funding_snapshot_line (tenant_id, fund_source_version_id);
CREATE INDEX IF NOT EXISTS funding_snapshot_line_allocation_line_id_idx ON funding_snapshot_line (tenant_id, allocation_line_id);
CREATE INDEX IF NOT EXISTS progress_snapshot_report_revision_id_idx ON progress_snapshot (tenant_id, report_revision_id);
CREATE INDEX IF NOT EXISTS report_narrative_report_revision_id_idx ON report_narrative (tenant_id, report_revision_id);
CREATE INDEX IF NOT EXISTS report_import_batch_period_id_idx ON report_import_batch (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS period_snapshot_period_id_idx ON period_snapshot (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS period_snapshot_supersedes_id_idx ON period_snapshot (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS period_snapshot_line_snapshot_id_idx ON period_snapshot_line (tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS period_snapshot_line_project_id_idx ON period_snapshot_line (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS period_snapshot_line_unit_id_idx ON period_snapshot_line (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS period_snapshot_line_fund_source_version_id_idx ON period_snapshot_line (tenant_id, fund_source_version_id);
CREATE INDEX IF NOT EXISTS period_snapshot_line_report_revision_id_idx ON period_snapshot_line (tenant_id, report_revision_id);
CREATE INDEX IF NOT EXISTS period_snapshot_line_plan_version_id_idx ON period_snapshot_line (tenant_id, plan_version_id);
CREATE INDEX IF NOT EXISTS early_warning_rule_id_idx ON early_warning (tenant_id, rule_id);
CREATE INDEX IF NOT EXISTS early_warning_project_id_idx ON early_warning (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS early_warning_unit_id_idx ON early_warning (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS early_warning_period_id_idx ON early_warning (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS early_warning_snapshot_id_idx ON early_warning (tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS early_warning_owner_membership_id_idx ON early_warning (tenant_id, owner_membership_id);
CREATE INDEX IF NOT EXISTS early_warning_explanation_request_id_idx ON early_warning (tenant_id, explanation_request_id);
CREATE INDEX IF NOT EXISTS disbursement_ranking_snapshot_id_idx ON disbursement_ranking (tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS disbursement_ranking_unit_id_idx ON disbursement_ranking (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS master_record_steward_membership_id_idx ON master_record (tenant_id, steward_membership_id);
CREATE INDEX IF NOT EXISTS master_record_current_version_id_idx ON master_record (tenant_id, current_version_id);
CREATE INDEX IF NOT EXISTS master_record_merged_into_id_idx ON master_record (tenant_id, merged_into_id);
CREATE INDEX IF NOT EXISTS master_record_version_parent_id_idx ON master_record_version (tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS master_record_version_master_record_id_idx ON master_record_version (tenant_id, master_record_id);
CREATE INDEX IF NOT EXISTS master_record_version_supersedes_id_idx ON master_record_version (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS master_record_version_change_request_id_idx ON master_record_version (tenant_id, change_request_id);
CREATE INDEX IF NOT EXISTS master_change_request_master_record_id_idx ON master_change_request (tenant_id, master_record_id);
CREATE INDEX IF NOT EXISTS master_change_request_evidence_document_id_idx ON master_change_request (tenant_id, evidence_document_id);
CREATE INDEX IF NOT EXISTS master_change_request_batch_id_idx ON master_change_request (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS master_crosswalk_master_record_id_idx ON master_crosswalk (tenant_id, master_record_id);
CREATE INDEX IF NOT EXISTS master_merge_survivor_record_id_idx ON master_merge (tenant_id, survivor_record_id);
CREATE INDEX IF NOT EXISTS master_merge_merged_record_id_idx ON master_merge (tenant_id, merged_record_id);
CREATE INDEX IF NOT EXISTS master_merge_change_request_id_idx ON master_merge (tenant_id, change_request_id);
CREATE INDEX IF NOT EXISTS glossary_term_owner_membership_id_idx ON glossary_term (tenant_id, owner_membership_id);
CREATE INDEX IF NOT EXISTS glossary_term_supersedes_id_idx ON glossary_term (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS master_succession_predecessor_record_id_idx ON master_succession (tenant_id, predecessor_record_id);
CREATE INDEX IF NOT EXISTS master_succession_successor_record_id_idx ON master_succession (tenant_id, successor_record_id);
CREATE INDEX IF NOT EXISTS master_succession_change_request_id_idx ON master_succession (tenant_id, change_request_id);
CREATE INDEX IF NOT EXISTS mne_obligation_rule_form_id_idx ON mne_obligation_rule (tenant_id, form_id);
CREATE INDEX IF NOT EXISTS mne_report_form_id_idx ON mne_report (tenant_id, form_id);
CREATE INDEX IF NOT EXISTS mne_report_obligation_rule_id_idx ON mne_report (tenant_id, obligation_rule_id);
CREATE INDEX IF NOT EXISTS mne_report_period_id_idx ON mne_report (tenant_id, period_id);
CREATE INDEX IF NOT EXISTS mne_report_scope_unit_id_idx ON mne_report (tenant_id, scope_unit_id);
CREATE INDEX IF NOT EXISTS mne_report_project_id_idx ON mne_report (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS mne_report_snapshot_id_idx ON mne_report (tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS mne_report_doc_document_id_idx ON mne_report (tenant_id, doc_document_id);
CREATE INDEX IF NOT EXISTS mne_report_supersedes_id_idx ON mne_report (tenant_id, supersedes_id);
CREATE INDEX IF NOT EXISTS mne_export_package_mne_report_id_idx ON mne_export_package (tenant_id, mne_report_id);
CREATE INDEX IF NOT EXISTS mne_export_package_receipt_document_id_idx ON mne_export_package (tenant_id, receipt_document_id);
CREATE INDEX IF NOT EXISTS mne_evaluation_project_id_idx ON mne_evaluation (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS mne_evaluation_report_document_id_idx ON mne_evaluation (tenant_id, report_document_id);
CREATE INDEX IF NOT EXISTS mne_evaluation_mne_report_id_idx ON mne_evaluation (tenant_id, mne_report_id);
-- END module capital

-- BEGIN module platform
-- Platform group (IAM, ADM, SAS, NOT, OMNI) — reference DDL, not executed. Owner: Platform/Backend.
-- Control-plane tables have no tenant_id and no data-plane runtime grant; tenant-plane tables use tenant_id + RLS ENABLE/FORCE.
-- Existing tables are extended with expand-only ALTERs; physical rollout = expand -> backfill -> verify -> contract.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===== Control plane (no tenant_id) =====
CREATE TABLE user_account (
  id uuid NOT NULL,
  idp_subject text NOT NULL,
  email_normalized text NOT NULL,
  display_name text NOT NULL,
  phone_e164 text,
  locale text NOT NULL DEFAULT 'vi-VN',
  time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL CHECK (status IN ('Active','Locked','Disabled')),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (idp_subject),
  UNIQUE (email_normalized)
);

CREATE TABLE placement (
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('POOL','SILO')),
  region text NOT NULL,
  db_cluster_ref text NOT NULL,
  kms_key_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('Active','Draining','Retired')),
  max_tenants integer CHECK (max_tenants IS NULL OR max_tenants > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE product_plan_version (
  id uuid NOT NULL,
  plan_code text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('Draft','Published','Retired')),
  billing_cycles text[] NOT NULL,
  base_price_vnd numeric(24,0) NOT NULL CHECK (base_price_vnd >= 0),
  vat_category text NOT NULL CHECK (vat_category IN ('NOT_SUBJECT','VAT_0','VAT_5','VAT_8','VAT_10')),
  legal_terms_ref text NOT NULL,
  published_by uuid,
  published_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE (plan_code, revision)
);

CREATE TABLE plan_feature (
  id uuid NOT NULL,
  plan_version_id uuid NOT NULL REFERENCES product_plan_version(id),
  feature_code text NOT NULL,
  limit_kind text NOT NULL CHECK (limit_kind IN ('BOOLEAN','QUOTA','METERED')),
  limit_value numeric(24,6),
  meter text,
  grace_behavior text NOT NULL CHECK (grace_behavior IN ('ALLOW','READ_ONLY','DENY')),
  expired_behavior text NOT NULL CHECK (expired_behavior IN ('READ_ONLY','EXPORT_ONLY','DENY')),
  PRIMARY KEY (id),
  UNIQUE (plan_version_id, feature_code)
);

CREATE TABLE license_signing_key (
  id text NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('EdDSA','ES256')),
  public_key_pem text NOT NULL,
  kms_key_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('Active','Retiring','Revoked')),
  not_before timestamptz NOT NULL,
  not_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (not_before < not_after)
);

CREATE TABLE feature_flag (
  id uuid NOT NULL,
  flag_key text NOT NULL,
  description text NOT NULL,
  rollout_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('Off','Rollout','On','Retired')),
  revision integer NOT NULL CHECK (revision > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE (flag_key)
);

CREATE TABLE notification_event_type (
  id uuid NOT NULL,
  event_type text NOT NULL,
  owning_module text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload_schema jsonb NOT NULL,
  allowed_purposes text[] NOT NULL,
  data_classification text NOT NULL CHECK (data_classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL')),
  status text NOT NULL CHECK (status IN ('Active','Deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (event_type, schema_version)
);

-- ===== Extend existing owned tables (expand only) =====
ALTER TABLE tenant ADD COLUMN governing_body_type text NOT NULL DEFAULT 'PROVINCE' CHECK (governing_body_type IN ('PROVINCE','MINISTRY','CENTRAL_AGENCY','PLATFORM_OPERATOR'));
ALTER TABLE tenant ADD COLUMN administrative_code text;
ALTER TABLE tenant ADD COLUMN isolation_mode text NOT NULL DEFAULT 'POOL' CHECK (isolation_mode IN ('POOL','SILO'));
ALTER TABLE tenant ADD COLUMN lifecycle_reason text;
ALTER TABLE tenant ADD COLUMN write_frozen_until timestamptz;
ALTER TABLE tenant ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tenant ADD COLUMN activated_at timestamptz;
ALTER TABLE tenant ADD COLUMN suspended_at timestamptz;
ALTER TABLE tenant ADD COLUMN offboarding_started_at timestamptz;
ALTER TABLE tenant ADD COLUMN archived_at timestamptz;
ALTER TABLE tenant ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE tenant ADD CONSTRAINT tenant_status_ck CHECK (status IN ('Requested','Provisioning','Active','Failed','Suspended','Offboarding','Archived'));
ALTER TABLE tenant ADD CONSTRAINT tenant_placement_fk FOREIGN KEY (placement_id) REFERENCES placement(id);

ALTER TABLE organization_unit ADD COLUMN unit_type text NOT NULL DEFAULT 'DEPARTMENT' CHECK (unit_type IN ('GOVERNING_BODY','DEPARTMENT','PROJECT_MANAGEMENT_BOARD','INVESTOR','COMMUNE','DIVISION','OTHER'));
ALTER TABLE organization_unit ADD COLUMN administrative_code text;
ALTER TABLE organization_unit ADD COLUMN is_investor boolean NOT NULL DEFAULT false;
ALTER TABLE organization_unit ADD COLUMN path text NOT NULL DEFAULT '/';
ALTER TABLE organization_unit ADD COLUMN depth integer NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 8);
ALTER TABLE organization_unit ADD COLUMN status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Planned','Active','Superseded','Dissolved'));
ALTER TABLE organization_unit ADD COLUMN legal_basis_ref text;
ALTER TABLE organization_unit ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE organization_unit ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE organization_unit ADD CONSTRAINT organization_unit_validity_ck CHECK (valid_until IS NULL OR valid_from < valid_until);
ALTER TABLE organization_unit ADD CONSTRAINT organization_unit_no_self_ck CHECK (parent_id IS DISTINCT FROM id AND successor_id IS DISTINCT FROM id);
ALTER TABLE organization_unit ADD FOREIGN KEY (tenant_id,successor_id) REFERENCES organization_unit(tenant_id,id);
CREATE UNIQUE INDEX organization_unit_active_code_uq ON organization_unit (tenant_id, code) WHERE status IN ('Planned','Active');
CREATE INDEX organization_unit_path_idx ON organization_unit (tenant_id, path text_pattern_ops);

ALTER TABLE membership ADD COLUMN membership_type text NOT NULL DEFAULT 'STAFF' CHECK (membership_type IN ('STAFF','GUEST_CONTRACTOR','SERVICE_ACCOUNT'));
ALTER TABLE membership ADD COLUMN contractor_id uuid;
ALTER TABLE membership ADD COLUMN valid_from timestamptz NOT NULL DEFAULT now();
ALTER TABLE membership ADD COLUMN invited_by uuid;
ALTER TABLE membership ADD COLUMN ended_reason text;
ALTER TABLE membership ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE membership ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE membership ADD CONSTRAINT membership_status_ck CHECK (status IN ('Invited','Active','Suspended','Ended','Expired'));
ALTER TABLE membership ADD CONSTRAINT membership_guest_ck CHECK ((membership_type = 'GUEST_CONTRACTOR') = (contractor_id IS NOT NULL));
ALTER TABLE membership ADD CONSTRAINT membership_guest_until_ck CHECK (membership_type <> 'GUEST_CONTRACTOR' OR valid_until IS NOT NULL);
ALTER TABLE membership ADD FOREIGN KEY (user_id) REFERENCES user_account(id);
ALTER TABLE membership ADD FOREIGN KEY (tenant_id,contractor_id) REFERENCES contractor(tenant_id,id);
CREATE UNIQUE INDEX membership_live_uq ON membership (tenant_id, user_id, organization_id) WHERE status IN ('Invited','Active','Suspended');

CREATE TABLE role_definition (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  permissions text[] NOT NULL,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 99),
  is_system boolean NOT NULL DEFAULT false,
  guest_allowed boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('Active','Retired')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (NOT (permissions && ARRAY['system.theme.manage','system.license.manage','system.tenant.manage','system.billing.manage']::text[]))
);

ALTER TABLE role_grant ADD COLUMN scope_kind text NOT NULL DEFAULT 'UNIT_SUBTREE' CHECK (scope_kind IN ('TENANT','UNIT_SUBTREE','UNIT_ONLY','PROJECT','CONTRACT'));
ALTER TABLE role_grant ADD COLUMN scope_ref_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE role_grant ADD COLUMN status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Revoked','Expired'));
ALTER TABLE role_grant ADD COLUMN granted_by uuid NOT NULL;
ALTER TABLE role_grant ADD COLUMN grant_reason text NOT NULL;
ALTER TABLE role_grant ADD COLUMN reorganization_id uuid;
ALTER TABLE role_grant ADD COLUMN revoked_by uuid;
ALTER TABLE role_grant ADD COLUMN revoked_at timestamptz;
ALTER TABLE role_grant ADD COLUMN revoke_reason text;
ALTER TABLE role_grant ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE role_grant ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE role_grant ADD CONSTRAINT role_grant_window_ck CHECK (effective_until IS NULL OR effective_from < effective_until);
ALTER TABLE role_grant ADD CONSTRAINT role_grant_scope_ck CHECK (scope_kind = 'TENANT' OR cardinality(scope_ref_ids) BETWEEN 1 AND 200);
ALTER TABLE role_grant ADD CONSTRAINT role_grant_revoke_ck CHECK ((status = 'Revoked') = (revoked_at IS NOT NULL));
ALTER TABLE role_grant ADD FOREIGN KEY (tenant_id,role_id) REFERENCES role_definition(tenant_id,id);

CREATE TABLE membership_invitation (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  email_hash char(64) NOT NULL,
  token_hash char(64) NOT NULL,
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  status text NOT NULL CHECK (status IN ('Pending','Accepted','Expired','Revoked')),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (token_hash)
);

CREATE TABLE delegation_grant (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  delegator_membership_id uuid NOT NULL,
  delegate_membership_id uuid NOT NULL,
  permissions text[] NOT NULL,
  scope_json jsonb NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  reason text NOT NULL,
  legal_basis_ref text,
  status text NOT NULL CHECK (status IN ('Scheduled','Active','Ended','Revoked')),
  revoked_by uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (delegator_membership_id <> delegate_membership_id),
  CHECK (valid_from < valid_until AND valid_until <= valid_from + interval '90 days')
);

CREATE TABLE unit_reorganization (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('MERGE','SPLIT','TRANSFER','RENAME','DISSOLVE')),
  effective_from date NOT NULL,
  legal_basis_ref text NOT NULL,
  mapping_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('Draft','PendingApproval','Approved','Applying','Applied','Failed','Cancelled')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  temporal_workflow_id text,
  result_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE organization_unit_succession (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  reorganization_id uuid NOT NULL,
  predecessor_unit_id uuid NOT NULL,
  successor_unit_id uuid NOT NULL,
  effective_from date NOT NULL,
  mapping_note text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, predecessor_unit_id, successor_unit_id),
  CHECK (predecessor_unit_id <> successor_unit_id)
);

-- ===== ADM: approval workflow, DoA, calendar, signatures, policies =====
ALTER TABLE workflow_version ADD COLUMN kind text NOT NULL DEFAULT 'APPROVAL' CHECK (kind IN ('APPROVAL','NOTIFICATION'));
ALTER TABLE workflow_version ADD COLUMN event_type text;
ALTER TABLE workflow_version ADD COLUMN created_by uuid NOT NULL;
ALTER TABLE workflow_version ADD COLUMN published_at timestamptz;
ALTER TABLE workflow_version ADD COLUMN effective_from timestamptz;
ALTER TABLE workflow_version ADD COLUMN supersedes_id uuid;
ALTER TABLE workflow_version ADD COLUMN definition_hash char(64) NOT NULL;
ALTER TABLE workflow_version ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE workflow_version ADD CONSTRAINT workflow_version_status_ck CHECK (status IN ('Draft','Published','Superseded','Retired'));
ALTER TABLE workflow_version ADD CONSTRAINT workflow_version_publisher_ck CHECK (published_by IS NULL OR published_by <> created_by);
ALTER TABLE workflow_version ADD CONSTRAINT workflow_version_event_ck CHECK (kind <> 'NOTIFICATION' OR event_type IS NOT NULL);
ALTER TABLE workflow_version ADD FOREIGN KEY (tenant_id,supersedes_id) REFERENCES workflow_version(tenant_id,id);
CREATE UNIQUE INDEX workflow_version_revision_uq ON workflow_version (tenant_id, kind, business_type, revision);
CREATE UNIQUE INDEX workflow_version_one_published_uq ON workflow_version (tenant_id, kind, business_type) WHERE status = 'Published';

ALTER TABLE workflow_instance ADD COLUMN temporal_workflow_id text NOT NULL;
ALTER TABLE workflow_instance ADD COLUMN temporal_run_id text;
ALTER TABLE workflow_instance ADD COLUMN initiator_membership_id uuid NOT NULL;
ALTER TABLE workflow_instance ADD COLUMN initiator_user_id uuid NOT NULL;
ALTER TABLE workflow_instance ADD COLUMN document_type text NOT NULL;
ALTER TABLE workflow_instance ADD COLUMN amount_vnd numeric(24,0) CHECK (amount_vnd IS NULL OR amount_vnd >= 0);
ALTER TABLE workflow_instance ADD COLUMN unit_id uuid NOT NULL;
ALTER TABLE workflow_instance ADD COLUMN doa_matrix_version_id uuid;
ALTER TABLE workflow_instance ADD COLUMN outcome text CHECK (outcome IN ('APPROVED','REJECTED','RETURNED','CANCELLED','GUARD_REJECTED'));
ALTER TABLE workflow_instance ADD COLUMN ended_at timestamptz;
ALTER TABLE workflow_instance ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_ck CHECK (status IN ('Running','Completed','Cancelled','Failed'));
ALTER TABLE workflow_instance ADD FOREIGN KEY (tenant_id,workflow_version_id) REFERENCES workflow_version(tenant_id,id);
ALTER TABLE workflow_instance ADD FOREIGN KEY (tenant_id,unit_id) REFERENCES organization_unit(tenant_id,id);
CREATE UNIQUE INDEX workflow_instance_temporal_uq ON workflow_instance (tenant_id, temporal_workflow_id);
CREATE UNIQUE INDEX workflow_instance_one_running_uq ON workflow_instance (tenant_id, resource_type, resource_id) WHERE status = 'Running';

ALTER TABLE approval_task ADD COLUMN step_id text NOT NULL;
ALTER TABLE approval_task ADD COLUMN status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Decided','Reassigned','Expired','Cancelled'));
ALTER TABLE approval_task ADD COLUMN required_role_id uuid;
ALTER TABLE approval_task ADD COLUMN decided_by uuid;
ALTER TABLE approval_task ADD COLUMN on_behalf_of_id uuid;
ALTER TABLE approval_task ADD COLUMN delegation_id uuid;
ALTER TABLE approval_task ADD COLUMN signature_ref text;
ALTER TABLE approval_task ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE approval_task ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE approval_task ADD CONSTRAINT approval_task_decision_ck CHECK (decision IS NULL OR decision IN ('approve','return','reject'));
ALTER TABLE approval_task ADD CONSTRAINT approval_task_decided_ck CHECK ((status = 'Decided') = (decision IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL));
ALTER TABLE approval_task ADD CONSTRAINT approval_task_reason_ck CHECK (decision IS NULL OR decision = 'approve' OR length(trim(reason)) >= 10);
ALTER TABLE approval_task ADD FOREIGN KEY (tenant_id,assignee_id) REFERENCES membership(tenant_id,id);
ALTER TABLE approval_task ADD FOREIGN KEY (tenant_id,required_role_id) REFERENCES role_definition(tenant_id,id);
ALTER TABLE approval_task ADD FOREIGN KEY (tenant_id,delegation_id) REFERENCES delegation_grant(tenant_id,id);
CREATE UNIQUE INDEX approval_task_open_step_uq ON approval_task (tenant_id, workflow_instance_id, step_id, assignee_id) WHERE status = 'Pending';

CREATE TABLE doa_matrix_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('Draft','PendingApproval','Published','Superseded','Rejected')),
  effective_from date NOT NULL,
  effective_until date,
  legal_basis_ref text NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid,
  published_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, revision),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (effective_until IS NULL OR effective_from < effective_until)
);

CREATE TABLE doa_rule (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  matrix_version_id uuid NOT NULL,
  document_type text NOT NULL,
  unit_id uuid NOT NULL,
  include_subtree boolean NOT NULL DEFAULT true,
  amount_min_vnd numeric(24,0) NOT NULL DEFAULT 0,
  amount_max_vnd numeric(24,0),
  approver_role_id uuid NOT NULL,
  approval_levels integer NOT NULL DEFAULT 1 CHECK (approval_levels BETWEEN 1 AND 5),
  requires_distinct_approvers boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  CHECK (amount_min_vnd >= 0 AND (amount_max_vnd IS NULL OR amount_max_vnd > amount_min_vnd))
);
ALTER TABLE doa_rule ADD CONSTRAINT doa_rule_no_overlap EXCLUDE USING gist (tenant_id WITH =, matrix_version_id WITH =, document_type WITH =, unit_id WITH =, numrange(amount_min_vnd, amount_max_vnd, '[)') WITH &&);

CREATE TABLE work_calendar_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  calendar_code text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  revision integer NOT NULL CHECK (revision > 0),
  working_days jsonb NOT NULL,
  holidays jsonb NOT NULL,
  compensated_workdays jsonb NOT NULL DEFAULT '[]',
  legal_basis_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('Draft','Published','Superseded')),
  created_by uuid NOT NULL,
  published_by uuid,
  published_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, calendar_code, year, revision)
);
CREATE UNIQUE INDEX work_calendar_one_published_uq ON work_calendar_version (tenant_id, calendar_code, year) WHERE status = 'Published';

CREATE TABLE signing_certificate (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PERSONAL','ORGANIZATION')),
  holder_membership_id uuid,
  organization_unit_id uuid,
  certificate_serial text NOT NULL,
  issuer_dn text NOT NULL,
  subject_dn text NOT NULL,
  provider_code text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  fingerprint_sha256 char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('Active','Expired','Revoked','Suspended')),
  status_reason text,
  registered_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, fingerprint_sha256),
  CHECK (valid_from < valid_until),
  CHECK ((kind = 'PERSONAL' AND holder_membership_id IS NOT NULL) OR (kind = 'ORGANIZATION' AND organization_unit_id IS NOT NULL))
);

CREATE TABLE data_retention_policy (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  record_class text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  retention_years integer CHECK (retention_years IS NULL OR retention_years > 0),
  retention_basis text NOT NULL CHECK (retention_basis IN ('FROM_CREATED','FROM_CLOSED','FROM_CONTRACT_END','PERMANENT')),
  legal_basis_ref text NOT NULL,
  end_action text NOT NULL CHECK (end_action IN ('REVIEW_FOR_DESTRUCTION','ARCHIVE_TRANSFER','AUTO_PURGE_TECHNICAL')),
  effective_from date NOT NULL,
  status text NOT NULL CHECK (status IN ('Draft','Published','Superseded')),
  created_by uuid NOT NULL,
  approved_by uuid,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, record_class, revision),
  CHECK ((retention_basis = 'PERMANENT') = (retention_years IS NULL)),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE TABLE migration_batch (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  source_system text NOT NULL,
  target_entity text NOT NULL,
  file_sha256 char(64) NOT NULL,
  file_storage_key text NOT NULL,
  mapping_version text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  status text NOT NULL CHECK (status IN ('Uploaded','Validating','Validated','DryRunPassed','DryRunFailed','PendingApproval','Applying','Applied','Failed','RolledBack')),
  dry_run_report_ref text,
  control_totals jsonb,
  created_by uuid NOT NULL,
  approved_by uuid,
  applied_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, target_entity, file_sha256),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE TABLE security_policy_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  policy_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('Draft','Published','Superseded')),
  created_by uuid NOT NULL,
  approved_by uuid,
  published_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, revision),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE TABLE integration_connector (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  connector_code text NOT NULL,
  adapter_status text NOT NULL CHECK (adapter_status IN ('VERIFIED','PROPOSED','MOCK','MISSING')),
  mode text NOT NULL CHECK (mode IN ('FILE_IMPORT','FILE_EXPORT','API','LGSP')),
  config_json jsonb NOT NULL,
  credential_secret_ref text,
  mapping_version text,
  status text NOT NULL CHECK (status IN ('Draft','Active','Disabled')),
  last_test_at timestamptz,
  last_test_result text,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, connector_code),
  CHECK (status <> 'Active' OR adapter_status IN ('VERIFIED','MOCK'))
);

CREATE TABLE user_session (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  user_account_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  idp_session_id text NOT NULL,
  device_registration_id uuid,
  assurance_level text NOT NULL CHECK (assurance_level IN ('aal1','aal2')),
  ip_hash char(64) NOT NULL,
  user_agent_summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idp_session_id)
);

CREATE TABLE support_ticket (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  ticket_code text NOT NULL,
  requester_membership_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('ACCESS','DATA','BILLING','INCIDENT','HOWTO','OTHER')),
  subject text NOT NULL,
  description_ref text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
  status text NOT NULL CHECK (status IN ('Open','InProgress','WaitingCustomer','Resolved','Closed')),
  assignee_operator_id uuid,
  sla_due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, ticket_code)
);

-- ===== SAS: provisioning, placement, domain, entitlement, billing, license =====
CREATE TABLE tenant_provisioning_run (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  temporal_workflow_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('Running','Succeeded','Failed','Compensating','Abandoned')),
  current_step text NOT NULL,
  steps_json jsonb NOT NULL,
  error_code text,
  requested_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, attempt)
);

CREATE TABLE tenant_placement_migration (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  from_placement_id uuid NOT NULL REFERENCES placement(id),
  to_placement_id uuid NOT NULL REFERENCES placement(id),
  status text NOT NULL CHECK (status IN ('Planned','Copying','Verifying','AwaitingCutover','CutoverFrozen','Switched','Completed','Aborted','RolledBack')),
  write_freeze_max_minutes integer NOT NULL CHECK (write_freeze_max_minutes BETWEEN 5 AND 240),
  write_freeze_started_at timestamptz,
  verification_report_ref text,
  checksum_match boolean,
  requested_by uuid NOT NULL,
  cutover_approved_by uuid,
  temporal_workflow_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (from_placement_id <> to_placement_id),
  CHECK (cutover_approved_by IS NULL OR cutover_approved_by <> requested_by)
);
CREATE UNIQUE INDEX tenant_placement_migration_open_uq ON tenant_placement_migration (tenant_id) WHERE status NOT IN ('Completed','Aborted','RolledBack');

CREATE TABLE tenant_domain (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  hostname text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PLATFORM_SUBDOMAIN','CUSTOM')),
  txt_token_hash char(64),
  status text NOT NULL CHECK (status IN ('PendingVerification','Verified','Active','Failed','Revoked')),
  verified_at timestamptz,
  tls_status text NOT NULL CHECK (tls_status IN ('Pending','Issued','Renewing','Failed')),
  tls_expires_at timestamptz,
  last_checked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX tenant_domain_hostname_uq ON tenant_domain (lower(hostname)) WHERE status <> 'Revoked';

CREATE TABLE entitlement_version (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  version_no bigint NOT NULL CHECK (version_no > 0),
  subscription_id uuid,
  plan_version_id uuid NOT NULL REFERENCES product_plan_version(id),
  features_json jsonb NOT NULL,
  entitlements_hash char(64) NOT NULL,
  cause text NOT NULL CHECK (cause IN ('PROVISIONING','SUBSCRIPTION_CHANGE','OVERRIDE','LICENSE_CHANGE','TENANT_STATUS','EXPIRY')),
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, version_no)
);

CREATE TABLE entitlement_override (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  feature_code text NOT NULL,
  enabled boolean NOT NULL,
  limit_value numeric(24,6),
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('PendingApproval','Active','Revoked','Expired','Rejected')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (valid_from < valid_until),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE usage_counter (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  feature_code text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  used_value numeric(24,6) NOT NULL DEFAULT 0 CHECK (used_value >= 0),
  limit_value numeric(24,6),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, feature_code, window_start),
  CHECK (window_start < window_end)
);

ALTER TABLE subscription ADD COLUMN started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscription ADD COLUMN trial_ends_at timestamptz;
ALTER TABLE subscription ADD COLUMN current_period_start date NOT NULL;
ALTER TABLE subscription ADD COLUMN current_period_end date NOT NULL;
ALTER TABLE subscription ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false;
ALTER TABLE subscription ADD COLUMN pending_plan_version_id uuid;
ALTER TABLE subscription ADD COLUMN pending_effective_at timestamptz;
ALTER TABLE subscription ADD COLUMN past_due_since timestamptz;
ALTER TABLE subscription ADD COLUMN procurement_contract_ref text;
ALTER TABLE subscription ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE subscription ADD CONSTRAINT subscription_status_ck CHECK (status IN ('Trialing','Active','PastDue','Paused','Cancelled','Expired'));
ALTER TABLE subscription ADD CONSTRAINT subscription_cycle_ck CHECK (cycle IN ('MONTHLY','QUARTERLY','ANNUAL','CONTRACT_TERM'));
ALTER TABLE subscription ADD CONSTRAINT subscription_period_ck CHECK (current_period_start < current_period_end);
ALTER TABLE subscription ADD FOREIGN KEY (plan_version_id) REFERENCES product_plan_version(id);
ALTER TABLE subscription ADD FOREIGN KEY (pending_plan_version_id) REFERENCES product_plan_version(id);
CREATE UNIQUE INDEX subscription_one_live_uq ON subscription (tenant_id) WHERE status IN ('Trialing','Active','PastDue','Paused');

ALTER TABLE usage_meter_event ADD COLUMN unit text NOT NULL DEFAULT 'count';
ALTER TABLE usage_meter_event ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE usage_meter_event ADD CONSTRAINT usage_meter_event_qty_ck CHECK (quantity >= 0);
CREATE UNIQUE INDEX usage_meter_event_key_uq ON usage_meter_event (tenant_id, meter, external_event_key);

CREATE TABLE invoice (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  invoice_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ORIGINAL','ADJUSTMENT','REPLACEMENT')),
  related_invoice_id uuid,
  correction_reason text,
  agreement_document_ref text,
  status text NOT NULL CHECK (status IN ('Draft','Discarded','PendingIssue','IssueFailed','Issued','Sent','PartiallyPaid','Paid','Overdue','Adjusted','Replaced')),
  subtotal_vnd numeric(24,0) NOT NULL,
  vat_vnd numeric(24,0) NOT NULL,
  total_vnd numeric(24,0) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  buyer_snapshot jsonb NOT NULL,
  einvoice_provider text,
  einvoice_template_code text,
  einvoice_series text,
  einvoice_number text,
  tax_authority_code text,
  lookup_code text,
  provider_ref text,
  issued_at timestamptz,
  due_at date,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, invoice_code),
  CHECK (total_vnd = subtotal_vnd + vat_vnd),
  CHECK (kind = 'ORIGINAL' OR (related_invoice_id IS NOT NULL AND length(trim(correction_reason)) >= 10)),
  CHECK (kind <> 'ORIGINAL' OR subtotal_vnd >= 0),
  CHECK (period_start <= period_end)
);
CREATE UNIQUE INDEX invoice_einvoice_number_uq ON invoice (einvoice_provider, einvoice_template_code, einvoice_series, einvoice_number) WHERE einvoice_number IS NOT NULL;
CREATE UNIQUE INDEX invoice_single_replacement_uq ON invoice (tenant_id, related_invoice_id) WHERE kind = 'REPLACEMENT' AND status NOT IN ('Discarded','IssueFailed');

ALTER TABLE invoice_line ADD COLUMN line_kind text NOT NULL DEFAULT 'SUBSCRIPTION' CHECK (line_kind IN ('SUBSCRIPTION','USAGE','ADJUSTMENT','DISCOUNT'));
ALTER TABLE invoice_line ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE invoice_line ADD COLUMN amount_vnd numeric(24,0) NOT NULL DEFAULT 0;
ALTER TABLE invoice_line ADD COLUMN vat_category text NOT NULL DEFAULT 'NOT_SUBJECT' CHECK (vat_category IN ('NOT_SUBJECT','VAT_0','VAT_5','VAT_8','VAT_10'));
ALTER TABLE invoice_line ADD COLUMN vat_vnd numeric(24,0) NOT NULL DEFAULT 0;
ALTER TABLE invoice_line ADD FOREIGN KEY (tenant_id,invoice_id) REFERENCES invoice(tenant_id,id);
ALTER TABLE invoice_line ADD FOREIGN KEY (tenant_id,pricing_version_id) REFERENCES pricing_version(tenant_id,id);

CREATE TABLE billing_payment (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  invoice_id uuid,
  provider text NOT NULL,
  provider_txn_ref text NOT NULL,
  amount_vnd numeric(24,0) NOT NULL CHECK (amount_vnd > 0),
  method text NOT NULL CHECK (method IN ('BANK_TRANSFER','GATEWAY','TREASURY_TRANSFER')),
  received_at timestamptz NOT NULL,
  match_status text NOT NULL CHECK (match_status IN ('Matched','Unmatched','PendingReview','Reversed')),
  matched_by uuid,
  inbox_event_id uuid,
  reversal_of_id uuid,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (provider, provider_txn_ref)
);

ALTER TABLE license_revision ADD COLUMN edition text NOT NULL DEFAULT 'STANDARD' CHECK (edition IN ('PILOT','STANDARD','ENTERPRISE','PRIVATE'));
ALTER TABLE license_revision ADD COLUMN seats integer CHECK (seats IS NULL OR seats > 0);
ALTER TABLE license_revision ADD COLUMN quota_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE license_revision ADD COLUMN issuer text NOT NULL DEFAULT 'machvon-platform';
ALTER TABLE license_revision ADD COLUMN issued_by uuid;
ALTER TABLE license_revision ADD COLUMN issued_at timestamptz;
ALTER TABLE license_revision ADD COLUMN status_reason text;
ALTER TABLE license_revision ADD COLUMN deployment_binding text;
ALTER TABLE license_revision ADD COLUMN offline_lease_until timestamptz;
ALTER TABLE license_revision ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE license_revision ADD CONSTRAINT license_revision_status_ck CHECK (status IN ('Draft','Issued','Active','Grace','Expired','Suspended','Revoked','Superseded'));
ALTER TABLE license_revision ADD CONSTRAINT license_revision_window_ck CHECK (valid_from < valid_until AND valid_until <= grace_until);
ALTER TABLE license_revision ADD CONSTRAINT license_revision_lease_ck CHECK (offline_lease_until IS NULL OR (edition = 'PRIVATE' AND offline_lease_until <= grace_until));
ALTER TABLE license_revision ADD CONSTRAINT license_revision_reason_ck CHECK (status NOT IN ('Suspended','Revoked') OR length(trim(status_reason)) >= 10);
ALTER TABLE license_revision ADD FOREIGN KEY (tenant_id,entitlement_version_id) REFERENCES entitlement_version(tenant_id,id);
ALTER TABLE license_revision ADD FOREIGN KEY (tenant_id,supersedes_id) REFERENCES license_revision(tenant_id,id);
ALTER TABLE license_revision ADD FOREIGN KEY (key_id) REFERENCES license_signing_key(id);
CREATE UNIQUE INDEX license_revision_serial_uq ON license_revision (tenant_id, serial, revision);
CREATE UNIQUE INDEX license_revision_one_current_uq ON license_revision (tenant_id, serial) WHERE status IN ('Issued','Active','Grace','Suspended');

ALTER TABLE support_access_grant ALTER COLUMN owner_approved_by DROP NOT NULL;
ALTER TABLE support_access_grant ADD COLUMN request_reason text NOT NULL;
ALTER TABLE support_access_grant ADD COLUMN access_mode text NOT NULL DEFAULT 'READ_ONLY' CHECK (access_mode IN ('READ_ONLY','READ_WRITE'));
ALTER TABLE support_access_grant ADD COLUMN status text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Approved','Active','Expired','Revoked','Rejected'));
ALTER TABLE support_access_grant ADD COLUMN requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE support_access_grant ADD COLUMN starts_at timestamptz;
ALTER TABLE support_access_grant ADD COLUMN second_approver_id uuid;
ALTER TABLE support_access_grant ADD COLUMN revoke_reason text;
ALTER TABLE support_access_grant ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE support_access_grant ADD CONSTRAINT support_access_grant_owner_ck CHECK (owner_approved_by IS NULL OR owner_approved_by <> operator_id);
ALTER TABLE support_access_grant ADD CONSTRAINT support_access_grant_window_ck CHECK (starts_at IS NULL OR (expires_at > starts_at AND expires_at <= starts_at + interval '8 hours'));
ALTER TABLE support_access_grant ADD CONSTRAINT support_access_grant_rw_ck CHECK (access_mode = 'READ_ONLY' OR (second_approver_id IS NOT NULL AND second_approver_id <> owner_approved_by));

CREATE TABLE tenant_export_job (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  scope_json jsonb NOT NULL,
  format text NOT NULL CHECK (format IN ('JSONL_CSV_BUNDLE')),
  status text NOT NULL CHECK (status IN ('Requested','Running','Ready','Delivered','Failed','Expired')),
  manifest_storage_key text,
  manifest_sha256 char(64),
  file_count integer CHECK (file_count IS NULL OR file_count >= 0),
  total_bytes bigint,
  row_counts jsonb,
  encryption_key_fingerprint text,
  requested_by uuid NOT NULL,
  expires_at timestamptz,
  downloaded_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (status NOT IN ('Ready','Delivered') OR (manifest_sha256 IS NOT NULL AND file_count IS NOT NULL))
);

CREATE TABLE tenant_restore_request (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  recovery_point timestamptz NOT NULL,
  target text NOT NULL CHECK (target IN ('SANDBOX','IN_PLACE')),
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  status text NOT NULL CHECK (status IN ('Requested','Approved','Restoring','Verifying','Completed','Failed','Rejected')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  verification_report_ref text,
  temporal_workflow_id text,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

ALTER TABLE legal_hold ADD COLUMN hold_kind text NOT NULL DEFAULT 'INSPECTION' CHECK (hold_kind IN ('INSPECTION','AUDIT','LITIGATION','INVESTIGATION','CONTRACT_END'));
ALTER TABLE legal_hold ADD COLUMN status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Released'));
ALTER TABLE legal_hold ADD COLUMN placed_by uuid NOT NULL;
ALTER TABLE legal_hold ADD COLUMN released_by uuid;
ALTER TABLE legal_hold ADD COLUMN release_reason text;
ALTER TABLE legal_hold ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE legal_hold ADD CONSTRAINT legal_hold_release_ck CHECK ((status = 'Released') = (released_at IS NOT NULL AND released_by IS NOT NULL AND length(trim(release_reason)) >= 10));
ALTER TABLE legal_hold ADD CONSTRAINT legal_hold_four_eyes_ck CHECK (released_by IS NULL OR released_by <> placed_by);

-- ===== Platform services: audit, outbox, idempotency, inbox =====
CREATE SEQUENCE IF NOT EXISTS audit_event_seq;
ALTER TABLE audit_event ADD COLUMN seq bigint NOT NULL DEFAULT nextval('audit_event_seq');
ALTER TABLE audit_event ADD COLUMN impersonator_id uuid;
ALTER TABLE audit_event ADD COLUMN on_behalf_of_id uuid;
ALTER TABLE audit_event ADD COLUMN request_id uuid NOT NULL;
ALTER TABLE audit_event ADD COLUMN outcome text NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS','DENIED','FAILED'));
ALTER TABLE audit_event ADD COLUMN classification text NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL'));
ALTER TABLE audit_event ADD COLUMN ip_hash char(64);
ALTER TABLE audit_event ADD COLUMN schema_version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX audit_event_seq_uq ON audit_event (tenant_id, seq);
CREATE INDEX audit_event_resource_time_idx ON audit_event (tenant_id, resource_type, resource_id, occurred_at);

CREATE TABLE audit_seal (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  from_seq bigint NOT NULL,
  to_seq bigint NOT NULL,
  merkle_root char(64) NOT NULL,
  prev_seal_hash char(64),
  seal_hash char(64) NOT NULL,
  sealed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, to_seq),
  CHECK (from_seq <= to_seq)
);

ALTER TABLE outbox_event ADD COLUMN aggregate_type text NOT NULL;
ALTER TABLE outbox_event ADD COLUMN aggregate_version bigint NOT NULL;
ALTER TABLE outbox_event ADD COLUMN event_key text NOT NULL;
ALTER TABLE outbox_event ADD COLUMN correlation_id uuid NOT NULL;
ALTER TABLE outbox_event ADD COLUMN causation_id uuid;
ALTER TABLE outbox_event ADD COLUMN status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','DEAD'));
ALTER TABLE outbox_event ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20);
ALTER TABLE outbox_event ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox_event ADD COLUMN last_error text;
CREATE UNIQUE INDEX outbox_event_key_uq ON outbox_event (tenant_id, event_key);
CREATE INDEX outbox_event_pending_idx ON outbox_event (next_attempt_at) WHERE status = 'PENDING';

ALTER TABLE idempotency_record ADD COLUMN http_status integer;
ALTER TABLE idempotency_record ADD COLUMN resource_type text;
ALTER TABLE idempotency_record ADD COLUMN resource_id uuid;
ALTER TABLE idempotency_record ADD COLUMN locked_until timestamptz;
ALTER TABLE idempotency_record ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE idempotency_record ADD COLUMN completed_at timestamptz;
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_status_ck CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED_RETRYABLE'));
ALTER TABLE idempotency_record ADD CONSTRAINT idempotency_record_ttl_ck CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days');
CREATE INDEX idempotency_record_expiry_idx ON idempotency_record (expires_at);

ALTER TABLE integration_event_inbox ADD COLUMN provider_event_type text;
ALTER TABLE integration_event_inbox ADD COLUMN channel_account_id uuid;
ALTER TABLE integration_event_inbox ADD COLUMN signature_key_id text NOT NULL;
ALTER TABLE integration_event_inbox ADD COLUMN provider_timestamp timestamptz;
ALTER TABLE integration_event_inbox ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10);
ALTER TABLE integration_event_inbox ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE integration_event_inbox ADD COLUMN processed_at timestamptz;
ALTER TABLE integration_event_inbox ADD COLUMN error_code text;
ALTER TABLE integration_event_inbox ADD CONSTRAINT integration_event_inbox_status_ck CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','DEAD'));
ALTER TABLE integration_event_inbox ADD FOREIGN KEY (tenant_id,channel_account_id) REFERENCES channel_account(tenant_id,id);

-- ===== NOT / OMNI =====
ALTER TABLE channel_account ADD COLUMN display_name text NOT NULL DEFAULT '';
ALTER TABLE channel_account ADD COLUMN webhook_secret_ref text;
ALTER TABLE channel_account ADD COLUMN verified_at timestamptz;
ALTER TABLE channel_account ADD COLUMN daily_send_cap integer CHECK (daily_send_cap IS NULL OR daily_send_cap > 0);
ALTER TABLE channel_account ADD COLUMN monthly_budget_vnd numeric(24,0) CHECK (monthly_budget_vnd IS NULL OR monthly_budget_vnd >= 0);
ALTER TABLE channel_account ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE channel_account ADD CONSTRAINT channel_account_channel_ck CHECK (channel IN ('EMAIL','SMS','PUSH_FCM','PUSH_APNS','ZALO_OA','ZALO_ZNS','WHATSAPP'));
ALTER TABLE channel_account ADD CONSTRAINT channel_account_status_ck CHECK (status IN ('PendingVerification','Active','Disabled','CredentialExpired'));
ALTER TABLE channel_account ADD CONSTRAINT channel_account_active_ck CHECK (status <> 'Active' OR verified_at IS NOT NULL);
CREATE UNIQUE INDEX channel_account_external_uq ON channel_account (tenant_id, channel, external_account_id);

ALTER TABLE notification_template_version ADD COLUMN purpose text NOT NULL DEFAULT 'OPERATIONAL';
ALTER TABLE notification_template_version ADD COLUMN lockscreen_safe boolean NOT NULL DEFAULT false;
ALTER TABLE notification_template_version ADD COLUMN provider_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (provider_status IN ('NOT_REQUIRED','PENDING_PROVIDER','PROVIDER_APPROVED','PROVIDER_REJECTED'));
ALTER TABLE notification_template_version ADD COLUMN provider_reviewed_at timestamptz;
ALTER TABLE notification_template_version ADD COLUMN content_hash char(64) NOT NULL;
ALTER TABLE notification_template_version ADD COLUMN created_by uuid NOT NULL;
ALTER TABLE notification_template_version ADD COLUMN approved_by uuid;
ALTER TABLE notification_template_version ADD COLUMN supersedes_id uuid;
ALTER TABLE notification_template_version ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE notification_template_version ADD CONSTRAINT notification_template_status_ck CHECK (status IN ('Draft','InReview','PendingProvider','Active','Rejected','Retired'));
ALTER TABLE notification_template_version ADD CONSTRAINT notification_template_provider_ck CHECK (channel NOT IN ('ZALO_ZNS','WHATSAPP') OR status NOT IN ('Active') OR (provider_status = 'PROVIDER_APPROVED' AND provider_template_id IS NOT NULL));
ALTER TABLE notification_template_version ADD CONSTRAINT notification_template_push_ck CHECK (channel NOT IN ('PUSH_FCM','PUSH_APNS') OR lockscreen_safe);
ALTER TABLE notification_template_version ADD CONSTRAINT notification_template_approver_ck CHECK (approved_by IS NULL OR approved_by <> created_by);
ALTER TABLE notification_template_version ADD FOREIGN KEY (tenant_id,supersedes_id) REFERENCES notification_template_version(tenant_id,id);
CREATE UNIQUE INDEX notification_template_revision_uq ON notification_template_version (tenant_id, code, channel, locale, revision);

CREATE TABLE notification_preference (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  event_category text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','PUSH','SMS','ZALO','WHATSAPP')),
  enabled boolean NOT NULL,
  digest_mode text NOT NULL DEFAULT 'IMMEDIATE' CHECK (digest_mode IN ('IMMEDIATE','HOURLY','DAILY')),
  quiet_start time,
  quiet_end time,
  time_zone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, membership_id, event_category, channel),
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

CREATE TABLE notification_campaign (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('ANNOUNCEMENT','REMINDER','OPERATIONAL')),
  template_version_id uuid NOT NULL,
  segment_json jsonb NOT NULL,
  scheduled_at timestamptz,
  preview_recipient_count integer CHECK (preview_recipient_count IS NULL OR preview_recipient_count >= 0),
  preview_excluded_count integer CHECK (preview_excluded_count IS NULL OR preview_excluded_count >= 0),
  preview_hash char(64),
  previewed_at timestamptz,
  status text NOT NULL CHECK (status IN ('Draft','Previewed','PendingApproval','Approved','Scheduled','Sending','Completed','Rejected','Cancelled')),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (status NOT IN ('Approved','Scheduled','Sending','Completed') OR (approved_by IS NOT NULL AND preview_hash IS NOT NULL))
);

ALTER TABLE notification_instance ADD COLUMN recipient_kind text NOT NULL DEFAULT 'MEMBERSHIP' CHECK (recipient_kind IN ('MEMBERSHIP','CONTACT'));
ALTER TABLE notification_instance ADD COLUMN source_event_type text NOT NULL;
ALTER TABLE notification_instance ADD COLUMN event_version integer NOT NULL DEFAULT 1;
ALTER TABLE notification_instance ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('CRITICAL','HIGH','NORMAL','LOW'));
ALTER TABLE notification_instance ADD COLUMN channel_plan text[] NOT NULL DEFAULT '{IN_APP}';
ALTER TABLE notification_instance ADD COLUMN scheduled_for timestamptz;
ALTER TABLE notification_instance ADD COLUMN digest_bucket_key text;
ALTER TABLE notification_instance ADD COLUMN campaign_id uuid;
ALTER TABLE notification_instance ADD COLUMN ack_required boolean NOT NULL DEFAULT false;
ALTER TABLE notification_instance ADD COLUMN read_at timestamptz;
ALTER TABLE notification_instance ADD COLUMN acknowledged_at timestamptz;
ALTER TABLE notification_instance ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE notification_instance ADD COLUMN suppression_reason text;
ALTER TABLE notification_instance ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE notification_instance ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE notification_instance ADD CONSTRAINT notification_instance_status_ck CHECK (status IN ('Created','Scheduled','Queued','Sending','ProviderAccepted','Delivered','Read','Suppressed','Expired','Cancelled','Failed','Unknown'));
ALTER TABLE notification_instance ADD CONSTRAINT notification_instance_ack_ck CHECK (acknowledged_at IS NULL OR (ack_required AND read_at IS NOT NULL AND acknowledged_at >= read_at));
ALTER TABLE notification_instance ADD CONSTRAINT notification_instance_dedupe_ck CHECK (dedupe_key ~ '^n1:[0-9a-f]{64}

-- BEGIN module mobile
CREATE TABLE sync_membership_scope (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('unit_subtree','project','contract')),
  scope_ref_id uuid NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  PRIMARY KEY (tenant_id, id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
ALTER TABLE sync_membership_scope ADD FOREIGN KEY (tenant_id, membership_id) REFERENCES membership(tenant_id, id);
CREATE INDEX sync_membership_scope_membership_id_idx ON sync_membership_scope (tenant_id, membership_id);
CREATE INDEX sync_membership_scope_scope_ref_id_idx ON sync_membership_scope (tenant_id, scope_ref_id);
ALTER TABLE sync_membership_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_membership_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON sync_membership_scope USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON sync_membership_scope AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE sync_command_receipt (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  device_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) >= 16),
  command_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted','rejected','conflict')),
  result_ref text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, device_id, idempotency_key)
);
ALTER TABLE sync_command_receipt ADD FOREIGN KEY (tenant_id, device_id) REFERENCES device_registration(tenant_id, id);
CREATE INDEX sync_command_receipt_device_id_idx ON sync_command_receipt (tenant_id, device_id);
ALTER TABLE sync_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON sync_command_receipt USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON sync_command_receipt AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE sync_attachment (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  device_id uuid NOT NULL,
  sha256 char(64) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  status text NOT NULL CHECK (status IN ('UPLOADING','SCANNING','CLEAN','INFECTED')),
  storage_key text NOT NULL UNIQUE,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE sync_attachment ADD FOREIGN KEY (tenant_id, device_id) REFERENCES device_registration(tenant_id, id);
CREATE INDEX sync_attachment_device_id_idx ON sync_attachment (tenant_id, device_id);
ALTER TABLE sync_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON sync_attachment USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON sync_attachment AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
-- END module mobile
);
ALTER TABLE notification_instance ADD FOREIGN KEY (tenant_id,workflow_version_id) REFERENCES workflow_version(tenant_id,id);
ALTER TABLE notification_instance ADD FOREIGN KEY (tenant_id,campaign_id) REFERENCES notification_campaign(tenant_id,id);
CREATE UNIQUE INDEX notification_instance_dedupe_uq ON notification_instance (tenant_id, dedupe_key);
CREATE INDEX notification_instance_inbox_idx ON notification_instance (tenant_id, recipient_id, created_at DESC) WHERE recipient_kind = 'MEMBERSHIP';

ALTER TABLE delivery_attempt ADD COLUMN channel text NOT NULL;
ALTER TABLE delivery_attempt ADD COLUMN template_version_id uuid NOT NULL;
ALTER TABLE delivery_attempt ADD COLUMN failure_class text CHECK (failure_class IN ('RETRYABLE','PERMANENT','UNKNOWN'));
ALTER TABLE delivery_attempt ADD COLUMN next_retry_at timestamptz;
ALTER TABLE delivery_attempt ADD COLUMN accepted_at timestamptz;
ALTER TABLE delivery_attempt ADD COLUMN read_at timestamptz;
ALTER TABLE delivery_attempt ADD COLUMN cost_currency char(3) NOT NULL DEFAULT 'VND';
ALTER TABLE delivery_attempt ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE delivery_attempt ADD CONSTRAINT delivery_attempt_no_ck CHECK (attempt_no BETWEEN 1 AND 5);
ALTER TABLE delivery_attempt ADD CONSTRAINT delivery_attempt_status_ck CHECK (status IN ('Queued','Sending','ProviderAccepted','Delivered','Read','Failed','Unknown','Cancelled','Suppressed'));
ALTER TABLE delivery_attempt ADD CONSTRAINT delivery_attempt_cost_ck CHECK (cost >= 0);
ALTER TABLE delivery_attempt ADD FOREIGN KEY (tenant_id,template_version_id) REFERENCES notification_template_version(tenant_id,id);
CREATE UNIQUE INDEX delivery_attempt_seq_uq ON delivery_attempt (tenant_id, notification_id, channel, attempt_no);
CREATE UNIQUE INDEX delivery_attempt_provider_msg_uq ON delivery_attempt (tenant_id, channel_account_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE device_registration ADD COLUMN token_fingerprint char(64) NOT NULL;
ALTER TABLE device_registration ADD COLUMN permission_state text NOT NULL DEFAULT 'unknown' CHECK (permission_state IN ('granted','denied','provisional','unknown'));
ALTER TABLE device_registration ADD COLUMN app_version text NOT NULL;
ALTER TABLE device_registration ADD COLUMN locale text NOT NULL DEFAULT 'vi-VN';
ALTER TABLE device_registration ADD COLUMN revoke_reason text;
ALTER TABLE device_registration ADD CONSTRAINT device_registration_platform_ck CHECK (platform IN ('ios','android','web'));
CREATE UNIQUE INDEX device_registration_live_uq ON device_registration (tenant_id, membership_id, device_public_id) WHERE revoked_at IS NULL;

ALTER TABLE contact ADD COLUMN phone_hash char(64);
ALTER TABLE contact ADD COLUMN email_hash char(64);
ALTER TABLE contact ADD COLUMN preferred_channel text;
ALTER TABLE contact ADD COLUMN merged_into_id uuid;
ALTER TABLE contact ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE contact ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE contact ADD CONSTRAINT contact_status_ck CHECK (status IN ('Unverified','Verified','Merged','Blocked'));
ALTER TABLE contact ADD CONSTRAINT contact_merge_ck CHECK ((status = 'Merged') = (merged_into_id IS NOT NULL));
ALTER TABLE contact ADD FOREIGN KEY (tenant_id,merged_into_id) REFERENCES contact(tenant_id,id);

CREATE TABLE contact_identity (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('PHONE','EMAIL','ZALO','WHATSAPP')),
  external_id_hash char(64) NOT NULL,
  external_id_masked text NOT NULL,
  verification_method text CHECK (verification_method IN ('OTP','PROVIDER_VERIFIED','ADMIN_DOCUMENT')),
  verified_at timestamptz,
  verified_by uuid,
  status text NOT NULL CHECK (status IN ('Pending','Verified','Revoked')),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, channel, external_id_hash),
  CHECK ((status = 'Verified') = (verified_at IS NOT NULL AND verification_method IS NOT NULL))
);

ALTER TABLE contact_consent ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE contact_consent ADD COLUMN membership_id uuid;
ALTER TABLE contact_consent ADD COLUMN legal_basis text NOT NULL DEFAULT 'CONSENT' CHECK (legal_basis IN ('CONSENT','PUBLIC_DUTY','CONTRACT','LEGAL_OBLIGATION'));
ALTER TABLE contact_consent ADD COLUMN consent_text_version text NOT NULL;
ALTER TABLE contact_consent ADD COLUMN capture_method text NOT NULL CHECK (capture_method IN ('IN_APP','WEB_FORM','CHANNEL_OPT_IN','PAPER_SCANNED'));
ALTER TABLE contact_consent ADD COLUMN withdrawn_reason text;
ALTER TABLE contact_consent ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE contact_consent ADD CONSTRAINT contact_consent_subject_ck CHECK ((contact_id IS NULL) <> (membership_id IS NULL));
ALTER TABLE contact_consent ADD CONSTRAINT contact_consent_status_ck CHECK (status IN ('Granted','Withdrawn','Expired'));
ALTER TABLE contact_consent ADD CONSTRAINT contact_consent_withdraw_ck CHECK ((status = 'Withdrawn') = (revoked_at IS NOT NULL));
ALTER TABLE contact_consent ADD FOREIGN KEY (tenant_id,contact_id) REFERENCES contact(tenant_id,id);
ALTER TABLE contact_consent ADD FOREIGN KEY (tenant_id,membership_id) REFERENCES membership(tenant_id,id);
CREATE UNIQUE INDEX contact_consent_live_uq ON contact_consent (tenant_id, coalesce(contact_id, membership_id), channel, purpose) WHERE status = 'Granted';

CREATE TABLE conversation_routing_policy (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  rules_json jsonb NOT NULL,
  calendar_code text NOT NULL,
  first_response_minutes integer NOT NULL CHECK (first_response_minutes > 0),
  resolution_hours integer NOT NULL CHECK (resolution_hours > 0),
  status text NOT NULL CHECK (status IN ('Draft','Published','Superseded')),
  created_by uuid NOT NULL,
  published_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, revision)
);

ALTER TABLE conversation ALTER COLUMN verified_contact_id DROP NOT NULL;
ALTER TABLE conversation ALTER COLUMN assignee_id DROP NOT NULL;
ALTER TABLE conversation ADD COLUMN contact_id uuid NOT NULL;
ALTER TABLE conversation ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH','NORMAL','LOW'));
ALTER TABLE conversation ADD COLUMN routing_policy_id uuid;
ALTER TABLE conversation ADD COLUMN last_inbound_at timestamptz;
ALTER TABLE conversation ADD COLUMN window_expires_at timestamptz;
ALTER TABLE conversation ADD COLUMN sla_first_response_due_at timestamptz;
ALTER TABLE conversation ADD COLUMN sla_resolution_due_at timestamptz;
ALTER TABLE conversation ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conversation ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE conversation ADD CONSTRAINT conversation_status_ck CHECK (status IN ('New','Assigned','InProgress','PendingCustomer','Resolved','Closed'));
ALTER TABLE conversation ADD CONSTRAINT conversation_assignee_ck CHECK (status = 'New' OR assignee_id IS NOT NULL);
ALTER TABLE conversation ADD FOREIGN KEY (tenant_id,contact_id) REFERENCES contact(tenant_id,id);
ALTER TABLE conversation ADD FOREIGN KEY (tenant_id,verified_contact_id) REFERENCES contact(tenant_id,id);
ALTER TABLE conversation ADD FOREIGN KEY (tenant_id,assignee_id) REFERENCES membership(tenant_id,id);
ALTER TABLE conversation ADD FOREIGN KEY (tenant_id,routing_policy_id) REFERENCES conversation_routing_policy(tenant_id,id);
CREATE UNIQUE INDEX conversation_thread_uq ON conversation (tenant_id, channel_account_id, external_thread_id);

ALTER TABLE channel_message ALTER COLUMN provider_message_id DROP NOT NULL;
ALTER TABLE channel_message ADD COLUMN direction text NOT NULL DEFAULT 'INBOUND' CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL_NOTE'));
ALTER TABLE channel_message ADD COLUMN author_membership_id uuid;
ALTER TABLE channel_message ADD COLUMN purpose text;
ALTER TABLE channel_message ADD COLUMN template_version_id uuid;
ALTER TABLE channel_message ADD COLUMN delivery_status text CHECK (delivery_status IN ('Queued','ProviderAccepted','Delivered','Read','Failed'));
ALTER TABLE channel_message ADD COLUMN classification text NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL'));
ALTER TABLE channel_message ADD COLUMN inbox_event_id uuid;
ALTER TABLE channel_message ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE channel_message ADD CONSTRAINT channel_message_note_ck CHECK (direction <> 'INTERNAL_NOTE' OR (provider_message_id IS NULL AND delivery_status IS NULL));
ALTER TABLE channel_message ADD CONSTRAINT channel_message_outbound_ck CHECK (direction <> 'OUTBOUND' OR (author_membership_id IS NOT NULL AND purpose IS NOT NULL));
ALTER TABLE channel_message ADD FOREIGN KEY (tenant_id,author_membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE channel_message ADD FOREIGN KEY (tenant_id,template_version_id) REFERENCES notification_template_version(tenant_id,id);
ALTER TABLE channel_message ADD FOREIGN KEY (tenant_id,inbox_event_id) REFERENCES integration_event_inbox(tenant_id,id);
CREATE UNIQUE INDEX channel_message_provider_uq ON channel_message (tenant_id, conversation_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE canned_reply (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  body_text text NOT NULL,
  channels text[] NOT NULL,
  classification text NOT NULL CHECK (classification IN ('PUBLIC','INTERNAL')),
  status text NOT NULL CHECK (status IN ('Active','Retired')),
  created_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

-- ===== Composite foreign keys for new tenant tables =====
ALTER TABLE membership_invitation ADD FOREIGN KEY (tenant_id,membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE delegation_grant ADD FOREIGN KEY (tenant_id,delegator_membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE delegation_grant ADD FOREIGN KEY (tenant_id,delegate_membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE organization_unit_succession ADD FOREIGN KEY (tenant_id,reorganization_id) REFERENCES unit_reorganization(tenant_id,id);
ALTER TABLE organization_unit_succession ADD FOREIGN KEY (tenant_id,predecessor_unit_id) REFERENCES organization_unit(tenant_id,id);
ALTER TABLE organization_unit_succession ADD FOREIGN KEY (tenant_id,successor_unit_id) REFERENCES organization_unit(tenant_id,id);
ALTER TABLE role_grant ADD FOREIGN KEY (tenant_id,reorganization_id) REFERENCES unit_reorganization(tenant_id,id);
ALTER TABLE doa_rule ADD FOREIGN KEY (tenant_id,matrix_version_id) REFERENCES doa_matrix_version(tenant_id,id);
ALTER TABLE doa_rule ADD FOREIGN KEY (tenant_id,unit_id) REFERENCES organization_unit(tenant_id,id);
ALTER TABLE doa_rule ADD FOREIGN KEY (tenant_id,approver_role_id) REFERENCES role_definition(tenant_id,id);
ALTER TABLE workflow_instance ADD FOREIGN KEY (tenant_id,doa_matrix_version_id) REFERENCES doa_matrix_version(tenant_id,id);
ALTER TABLE workflow_instance ADD FOREIGN KEY (tenant_id,initiator_membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE signing_certificate ADD FOREIGN KEY (tenant_id,holder_membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE signing_certificate ADD FOREIGN KEY (tenant_id,organization_unit_id) REFERENCES organization_unit(tenant_id,id);
ALTER TABLE user_session ADD FOREIGN KEY (user_account_id) REFERENCES user_account(id);
ALTER TABLE user_session ADD FOREIGN KEY (tenant_id,membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE user_session ADD FOREIGN KEY (tenant_id,device_registration_id) REFERENCES device_registration(tenant_id,id);
ALTER TABLE support_ticket ADD FOREIGN KEY (tenant_id,requester_membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE entitlement_version ADD FOREIGN KEY (tenant_id,subscription_id) REFERENCES subscription(tenant_id,id);
ALTER TABLE invoice ADD FOREIGN KEY (tenant_id,subscription_id) REFERENCES subscription(tenant_id,id);
ALTER TABLE invoice ADD FOREIGN KEY (tenant_id,related_invoice_id) REFERENCES invoice(tenant_id,id);
ALTER TABLE billing_payment ADD FOREIGN KEY (tenant_id,invoice_id) REFERENCES invoice(tenant_id,id);
ALTER TABLE billing_payment ADD FOREIGN KEY (tenant_id,inbox_event_id) REFERENCES integration_event_inbox(tenant_id,id);
ALTER TABLE billing_payment ADD FOREIGN KEY (tenant_id,reversal_of_id) REFERENCES billing_payment(tenant_id,id);
ALTER TABLE support_access_grant ADD FOREIGN KEY (tenant_id,owner_approved_by) REFERENCES membership(tenant_id,id);
ALTER TABLE notification_preference ADD FOREIGN KEY (tenant_id,membership_id) REFERENCES membership(tenant_id,id);
ALTER TABLE notification_campaign ADD FOREIGN KEY (tenant_id,template_version_id) REFERENCES notification_template_version(tenant_id,id);
ALTER TABLE contact_identity ADD FOREIGN KEY (tenant_id,contact_id) REFERENCES contact(tenant_id,id);
ALTER TABLE tenant_provisioning_run ADD FOREIGN KEY (tenant_id) REFERENCES tenant(id);
ALTER TABLE tenant_placement_migration ADD FOREIGN KEY (tenant_id) REFERENCES tenant(id);
ALTER TABLE tenant_domain ADD FOREIGN KEY (tenant_id) REFERENCES tenant(id);

-- ===== Indexes: every *_id column, tenant_id leading (control-plane tables without tenant_id use the column alone) =====
CREATE INDEX tenant_placement_id_idx ON tenant (placement_id);
CREATE INDEX plan_feature_plan_version_id_idx ON plan_feature (plan_version_id);
CREATE INDEX organization_unit_parent_id_idx ON organization_unit (tenant_id, parent_id);
CREATE INDEX organization_unit_successor_id_idx ON organization_unit (tenant_id, successor_id);
CREATE INDEX membership_user_id_idx ON membership (tenant_id, user_id);
CREATE INDEX membership_organization_id_idx ON membership (tenant_id, organization_id);
CREATE INDEX membership_contractor_id_idx ON membership (tenant_id, contractor_id);
CREATE INDEX role_grant_membership_id_idx ON role_grant (tenant_id, membership_id);
CREATE INDEX role_grant_role_id_idx ON role_grant (tenant_id, role_id);
CREATE INDEX role_grant_reorganization_id_idx ON role_grant (tenant_id, reorganization_id);
CREATE INDEX role_grant_scope_ref_ids_idx ON role_grant USING gin (scope_ref_ids);
CREATE INDEX membership_invitation_membership_id_idx ON membership_invitation (tenant_id, membership_id);
CREATE INDEX delegation_grant_delegator_membership_id_idx ON delegation_grant (tenant_id, delegator_membership_id);
CREATE INDEX delegation_grant_delegate_membership_id_idx ON delegation_grant (tenant_id, delegate_membership_id);
CREATE INDEX unit_reorganization_temporal_workflow_id_idx ON unit_reorganization (tenant_id, temporal_workflow_id);
CREATE INDEX tenant_restore_request_temporal_workflow_id_idx ON tenant_restore_request (tenant_id, temporal_workflow_id);
CREATE INDEX organization_unit_succession_reorganization_id_idx ON organization_unit_succession (tenant_id, reorganization_id);
CREATE INDEX organization_unit_succession_predecessor_unit_id_idx ON organization_unit_succession (tenant_id, predecessor_unit_id);
CREATE INDEX organization_unit_succession_successor_unit_id_idx ON organization_unit_succession (tenant_id, successor_unit_id);
CREATE INDEX workflow_version_supersedes_id_idx ON workflow_version (tenant_id, supersedes_id);
CREATE INDEX workflow_instance_workflow_version_id_idx ON workflow_instance (tenant_id, workflow_version_id);
CREATE INDEX workflow_instance_resource_id_idx ON workflow_instance (tenant_id, resource_id);
CREATE INDEX workflow_instance_temporal_workflow_id_idx ON workflow_instance (tenant_id, temporal_workflow_id);
CREATE INDEX workflow_instance_temporal_run_id_idx ON workflow_instance (tenant_id, temporal_run_id);
CREATE INDEX workflow_instance_initiator_membership_id_idx ON workflow_instance (tenant_id, initiator_membership_id);
CREATE INDEX workflow_instance_initiator_user_id_idx ON workflow_instance (tenant_id, initiator_user_id);
CREATE INDEX workflow_instance_unit_id_idx ON workflow_instance (tenant_id, unit_id);
CREATE INDEX workflow_instance_doa_matrix_version_id_idx ON workflow_instance (tenant_id, doa_matrix_version_id);
CREATE INDEX approval_task_workflow_instance_id_idx ON approval_task (tenant_id, workflow_instance_id);
CREATE INDEX approval_task_assignee_id_idx ON approval_task (tenant_id, assignee_id);
CREATE INDEX approval_task_delegated_from_id_idx ON approval_task (tenant_id, delegated_from_id);
CREATE INDEX approval_task_step_id_idx ON approval_task (tenant_id, step_id);
CREATE INDEX approval_task_required_role_id_idx ON approval_task (tenant_id, required_role_id);
CREATE INDEX approval_task_on_behalf_of_id_idx ON approval_task (tenant_id, on_behalf_of_id);
CREATE INDEX approval_task_delegation_id_idx ON approval_task (tenant_id, delegation_id);
CREATE INDEX doa_rule_matrix_version_id_idx ON doa_rule (tenant_id, matrix_version_id);
CREATE INDEX doa_rule_unit_id_idx ON doa_rule (tenant_id, unit_id);
CREATE INDEX doa_rule_approver_role_id_idx ON doa_rule (tenant_id, approver_role_id);
CREATE INDEX signing_certificate_holder_membership_id_idx ON signing_certificate (tenant_id, holder_membership_id);
CREATE INDEX signing_certificate_organization_unit_id_idx ON signing_certificate (tenant_id, organization_unit_id);
CREATE INDEX user_session_user_account_id_idx ON user_session (tenant_id, user_account_id);
CREATE INDEX user_session_membership_id_idx ON user_session (tenant_id, membership_id);
CREATE INDEX user_session_idp_session_id_idx ON user_session (tenant_id, idp_session_id);
CREATE INDEX user_session_device_registration_id_idx ON user_session (tenant_id, device_registration_id);
CREATE INDEX support_ticket_requester_membership_id_idx ON support_ticket (tenant_id, requester_membership_id);
CREATE INDEX support_ticket_assignee_operator_id_idx ON support_ticket (tenant_id, assignee_operator_id);
CREATE INDEX tenant_provisioning_run_temporal_workflow_id_idx ON tenant_provisioning_run (tenant_id, temporal_workflow_id);
CREATE INDEX tenant_placement_migration_from_placement_id_idx ON tenant_placement_migration (tenant_id, from_placement_id);
CREATE INDEX tenant_placement_migration_to_placement_id_idx ON tenant_placement_migration (tenant_id, to_placement_id);
CREATE INDEX tenant_placement_migration_temporal_workflow_id_idx ON tenant_placement_migration (tenant_id, temporal_workflow_id);
CREATE INDEX entitlement_version_subscription_id_idx ON entitlement_version (tenant_id, subscription_id);
CREATE INDEX entitlement_version_plan_version_id_idx ON entitlement_version (tenant_id, plan_version_id);
CREATE INDEX subscription_plan_version_id_idx ON subscription (tenant_id, plan_version_id);
CREATE INDEX subscription_pending_plan_version_id_idx ON subscription (tenant_id, pending_plan_version_id);
CREATE INDEX invoice_subscription_id_idx ON invoice (tenant_id, subscription_id);
CREATE INDEX invoice_related_invoice_id_idx ON invoice (tenant_id, related_invoice_id);
CREATE INDEX invoice_line_invoice_id_idx ON invoice_line (tenant_id, invoice_id);
CREATE INDEX invoice_line_pricing_version_id_idx ON invoice_line (tenant_id, pricing_version_id);
CREATE INDEX billing_payment_invoice_id_idx ON billing_payment (tenant_id, invoice_id);
CREATE INDEX billing_payment_inbox_event_id_idx ON billing_payment (tenant_id, inbox_event_id);
CREATE INDEX billing_payment_reversal_of_id_idx ON billing_payment (tenant_id, reversal_of_id);
CREATE INDEX license_revision_entitlement_version_id_idx ON license_revision (tenant_id, entitlement_version_id);
CREATE INDEX license_revision_key_id_idx ON license_revision (tenant_id, key_id);
CREATE INDEX license_revision_supersedes_id_idx ON license_revision (tenant_id, supersedes_id);
CREATE INDEX support_access_grant_operator_id_idx ON support_access_grant (tenant_id, operator_id);
CREATE INDEX support_access_grant_second_approver_id_idx ON support_access_grant (tenant_id, second_approver_id);
CREATE INDEX audit_event_actor_id_idx ON audit_event (tenant_id, actor_id);
CREATE INDEX audit_event_resource_id_idx ON audit_event (tenant_id, resource_id);
CREATE INDEX audit_event_correlation_id_idx ON audit_event (tenant_id, correlation_id);
CREATE INDEX audit_event_impersonator_id_idx ON audit_event (tenant_id, impersonator_id);
CREATE INDEX audit_event_on_behalf_of_id_idx ON audit_event (tenant_id, on_behalf_of_id);
CREATE INDEX audit_event_request_id_idx ON audit_event (tenant_id, request_id);
CREATE INDEX outbox_event_aggregate_id_idx ON outbox_event (tenant_id, aggregate_id);
CREATE INDEX outbox_event_correlation_id_idx ON outbox_event (tenant_id, correlation_id);
CREATE INDEX outbox_event_causation_id_idx ON outbox_event (tenant_id, causation_id);
CREATE INDEX idempotency_record_subject_id_idx ON idempotency_record (tenant_id, subject_id);
CREATE INDEX idempotency_record_resource_id_idx ON idempotency_record (tenant_id, resource_id);
CREATE INDEX integration_event_inbox_channel_account_id_idx ON integration_event_inbox (tenant_id, channel_account_id);
CREATE INDEX integration_event_inbox_signature_key_id_idx ON integration_event_inbox (tenant_id, signature_key_id);
CREATE INDEX integration_event_inbox_pending_idx ON integration_event_inbox (next_attempt_at) WHERE status IN ('RECEIVED','FAILED');
CREATE INDEX channel_account_external_account_id_idx ON channel_account (tenant_id, external_account_id);
CREATE INDEX notification_template_version_provider_template_id_idx ON notification_template_version (tenant_id, provider_template_id);
CREATE INDEX notification_template_version_supersedes_id_idx ON notification_template_version (tenant_id, supersedes_id);
CREATE INDEX notification_preference_membership_id_idx ON notification_preference (tenant_id, membership_id);
CREATE INDEX notification_campaign_template_version_id_idx ON notification_campaign (tenant_id, template_version_id);
CREATE INDEX notification_instance_event_id_idx ON notification_instance (tenant_id, event_id);
CREATE INDEX notification_instance_workflow_version_id_idx ON notification_instance (tenant_id, workflow_version_id);
CREATE INDEX notification_instance_recipient_id_idx ON notification_instance (tenant_id, recipient_id);
CREATE INDEX notification_instance_campaign_id_idx ON notification_instance (tenant_id, campaign_id);
CREATE INDEX notification_instance_due_idx ON notification_instance (scheduled_for) WHERE status = 'Scheduled';
CREATE INDEX delivery_attempt_notification_id_idx ON delivery_attempt (tenant_id, notification_id);
CREATE INDEX delivery_attempt_channel_account_id_idx ON delivery_attempt (tenant_id, channel_account_id);
CREATE INDEX delivery_attempt_provider_message_id_idx ON delivery_attempt (tenant_id, provider_message_id);
CREATE INDEX delivery_attempt_template_version_id_idx ON delivery_attempt (tenant_id, template_version_id);
CREATE INDEX delivery_attempt_retry_idx ON delivery_attempt (next_retry_at) WHERE status = 'Queued';
CREATE INDEX device_registration_membership_id_idx ON device_registration (tenant_id, membership_id);
CREATE INDEX device_registration_device_public_id_idx ON device_registration (tenant_id, device_public_id);
CREATE INDEX contact_merged_into_id_idx ON contact (tenant_id, merged_into_id);
CREATE INDEX contact_identity_contact_id_idx ON contact_identity (tenant_id, contact_id);
CREATE INDEX contact_consent_contact_id_idx ON contact_consent (tenant_id, contact_id);
CREATE INDEX contact_consent_membership_id_idx ON contact_consent (tenant_id, membership_id);
CREATE INDEX conversation_channel_account_id_idx ON conversation (tenant_id, channel_account_id);
CREATE INDEX conversation_external_thread_id_idx ON conversation (tenant_id, external_thread_id);
CREATE INDEX conversation_verified_contact_id_idx ON conversation (tenant_id, verified_contact_id);
CREATE INDEX conversation_contact_id_idx ON conversation (tenant_id, contact_id);
CREATE INDEX conversation_assignee_id_idx ON conversation (tenant_id, assignee_id);
CREATE INDEX conversation_routing_policy_id_idx ON conversation (tenant_id, routing_policy_id);
CREATE INDEX channel_message_conversation_id_idx ON channel_message (tenant_id, conversation_id);
CREATE INDEX channel_message_provider_message_id_idx ON channel_message (tenant_id, provider_message_id);
CREATE INDEX channel_message_author_membership_id_idx ON channel_message (tenant_id, author_membership_id);
CREATE INDEX channel_message_template_version_id_idx ON channel_message (tenant_id, template_version_id);
CREATE INDEX channel_message_inbox_event_id_idx ON channel_message (tenant_id, inbox_event_id);
CREATE INDEX tenant_theme_review_actor_id_idx ON tenant_theme_review (tenant_id, actor_id);

-- ===== RLS for new tenant tables (same tenant_boundary policy as baseline) =====
ALTER TABLE role_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON role_definition USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE membership_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_invitation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON membership_invitation USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE delegation_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON delegation_grant USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE unit_reorganization ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_reorganization FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON unit_reorganization USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE organization_unit_succession ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_unit_succession FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON organization_unit_succession USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE doa_matrix_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE doa_matrix_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON doa_matrix_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE doa_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE doa_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON doa_rule USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE work_calendar_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_calendar_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON work_calendar_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE signing_certificate ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_certificate FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON signing_certificate USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE data_retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_retention_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON data_retention_policy USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE migration_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON migration_batch USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE security_policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_policy_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON security_policy_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE integration_connector ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connector FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON integration_connector USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE user_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_session FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON user_session USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE support_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON support_ticket USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_provisioning_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_provisioning_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_provisioning_run USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_placement_migration ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_placement_migration FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_placement_migration USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domain FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_domain USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE entitlement_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON entitlement_version USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE entitlement_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_override FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON entitlement_override USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE usage_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counter FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON usage_counter USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON invoice USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE billing_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON billing_payment USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_export_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_export_job FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_export_job USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tenant_restore_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_restore_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON tenant_restore_request USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE audit_seal ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_seal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON audit_seal USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON notification_preference USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE notification_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON notification_campaign USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE contact_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON contact_identity USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE conversation_routing_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_routing_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON conversation_routing_policy USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE canned_reply ENABLE ROW LEVEL SECURITY;
ALTER TABLE canned_reply FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON canned_reply USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
-- tenant stays a control-plane table without data-plane grants (baseline rule); data plane reads tenant status only through the entitlement/tenant-status projection.

-- Dedicated outbox relay role (no BYPASSRLS): may read/mark outbox rows of all tenants, nothing else.
CREATE POLICY outbox_relay_access ON outbox_event FOR ALL TO machvon_outbox_relay USING (true) WITH CHECK (true);
-- Append-only enforcement: runtime role has INSERT/SELECT only on audit_event and audit_seal; trigger rejects UPDATE/DELETE for every role except migration owner.
-- Scope-level authorization (unit subtree/project/contract) is enforced by the policy service + query builder; RLS above is the tenant boundary only.
-- END module platform

-- BEGIN module mobile
CREATE TABLE sync_membership_scope (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('unit_subtree','project','contract')),
  scope_ref_id uuid NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  PRIMARY KEY (tenant_id, id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
ALTER TABLE sync_membership_scope ADD FOREIGN KEY (tenant_id, membership_id) REFERENCES membership(tenant_id, id);
CREATE INDEX sync_membership_scope_membership_id_idx ON sync_membership_scope (tenant_id, membership_id);
CREATE INDEX sync_membership_scope_scope_ref_id_idx ON sync_membership_scope (tenant_id, scope_ref_id);
ALTER TABLE sync_membership_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_membership_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON sync_membership_scope USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON sync_membership_scope AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE sync_command_receipt (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  device_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) >= 16),
  command_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted','rejected','conflict')),
  result_ref text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, device_id, idempotency_key)
);
ALTER TABLE sync_command_receipt ADD FOREIGN KEY (tenant_id, device_id) REFERENCES device_registration(tenant_id, id);
CREATE INDEX sync_command_receipt_device_id_idx ON sync_command_receipt (tenant_id, device_id);
ALTER TABLE sync_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON sync_command_receipt USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON sync_command_receipt AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);

CREATE TABLE sync_attachment (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  device_id uuid NOT NULL,
  sha256 char(64) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  status text NOT NULL CHECK (status IN ('UPLOADING','SCANNING','CLEAN','INFECTED')),
  storage_key text NOT NULL UNIQUE,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE sync_attachment ADD FOREIGN KEY (tenant_id, device_id) REFERENCES device_registration(tenant_id, id);
CREATE INDEX sync_attachment_device_id_idx ON sync_attachment (tenant_id, device_id);
ALTER TABLE sync_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_attachment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON sync_attachment USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY tenant_guard ON sync_attachment AS RESTRICTIVE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
-- END module mobile
