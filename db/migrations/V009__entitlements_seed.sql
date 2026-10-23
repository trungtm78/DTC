-- Authored by hand (not generated): the STANDARD plan every tenant starts from (BR-SAS-10) and the guards around entitlement history.
-- V008 is the control-plane access migration, so the plan's "V008 seed" lives here.

-- One Published plan revision with the feature rows of the STANDARD defaults. plan_feature and product_plan_version are
-- control-plane tables: only the owner (this migration) and machvon_control touch them. The name is an i18n key.
INSERT INTO machvon.product_plan_version
  (id, plan_code, revision, name, status, billing_cycles, base_price_vnd, vat_category, legal_terms_ref, published_at)
VALUES
  ('00000000-0000-4000-9000-000000000001', 'STANDARD', 1, 'sas.plan.standard.name', 'Published', ARRAY['ANNUAL'], 0, 'NOT_SUBJECT', 'TERMS-STANDARD-1', now())
ON CONFLICT (plan_code, revision) DO NOTHING;

INSERT INTO machvon.plan_feature (id, plan_version_id, feature_code, limit_kind, limit_value, grace_behavior, expired_behavior)
VALUES
  ('00000000-0000-4000-9000-0000000000f1', '00000000-0000-4000-9000-000000000001', 'reporting', 'BOOLEAN', NULL, 'ALLOW', 'READ_ONLY'),
  ('00000000-0000-4000-9000-0000000000f2', '00000000-0000-4000-9000-000000000001', 'export', 'BOOLEAN', NULL, 'ALLOW', 'EXPORT_ONLY'),
  ('00000000-0000-4000-9000-0000000000f3', '00000000-0000-4000-9000-000000000001', 'ai.analysis', 'BOOLEAN', 0, 'DENY', 'DENY'),
  ('00000000-0000-4000-9000-0000000000f4', '00000000-0000-4000-9000-000000000001', 'notification.campaign', 'BOOLEAN', 0, 'DENY', 'DENY'),
  ('00000000-0000-4000-9000-0000000000f5', '00000000-0000-4000-9000-000000000001', 'member.invite', 'BOOLEAN', 0, 'DENY', 'DENY'),
  ('00000000-0000-4000-9000-0000000000f6', '00000000-0000-4000-9000-000000000001', 'member.seats', 'QUOTA', 50, 'READ_ONLY', 'DENY')
ON CONFLICT (plan_version_id, feature_code) DO NOTHING;

-- Entitlement versions are insert-only (BR-SAS-10): a change is a new version, never an edit of an old one.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE machvon.entitlement_version FROM machvon_app, machvon_control;

-- The control plane reads a tenant's license status next to its entitlements (the license issue itself is ST-SAS-003).
GRANT SELECT ON TABLE machvon.license_revision TO machvon_control;
