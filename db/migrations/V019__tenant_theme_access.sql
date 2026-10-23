-- Authored by hand (not generated): what each role may do with the tenant theme tables (ST-SAS-005, SAS 3.12, BR-SAS-17).
-- migrate: privileged
-- Runs as the privileged connection, not as machvon_owner: the MEMBER backfill at the end reaches the role rows of every
-- tenant at once (role_definition has FORCE row-level security) and needs no tenant context.

-- A rollback review keeps the reason typed with it: the publish request carries only the token, and the published version
-- stores the reason (`tenant_theme_version` CHECK: a restored version needs one of at least ten characters).
ALTER TABLE machvon.tenant_theme_review ADD COLUMN IF NOT EXISTS reason text;

-- Only the control plane writes a theme (a tenant administrator is read-only, AC43): the tenant tables keep their
-- tenant_boundary policy, so the control role reaches the theme of one tenant inside a transaction that names it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  machvon.tenant_theme_draft,
  machvon.tenant_theme_review,
  machvon.tenant_theme_version,
  machvon.tenant_theme_pointer,
  machvon.tenant_theme_asset
FROM machvon_app;

-- The tenant plane reads the published theme only (getMyPublishedTheme): the version and the pointer, never a draft, a
-- review token hash or an asset row.
REVOKE SELECT ON TABLE machvon.tenant_theme_draft, machvon.tenant_theme_review, machvon.tenant_theme_asset FROM machvon_app;

GRANT SELECT, INSERT, UPDATE ON TABLE machvon.tenant_theme_draft TO machvon_control;
GRANT SELECT, INSERT ON TABLE machvon.tenant_theme_review TO machvon_control;
GRANT UPDATE (consumed_at) ON TABLE machvon.tenant_theme_review TO machvon_control;
GRANT SELECT, INSERT ON TABLE machvon.tenant_theme_asset TO machvon_control;
GRANT UPDATE (scan_status) ON TABLE machvon.tenant_theme_asset TO machvon_control;
GRANT SELECT, INSERT, UPDATE ON TABLE machvon.tenant_theme_pointer TO machvon_control;

-- A published version never changes (a rollback publishes a new version from an old one): the control role may insert
-- one and read it, and has no UPDATE or DELETE on the table.
GRANT SELECT, INSERT ON TABLE machvon.tenant_theme_version TO machvon_control;

-- Every member needs the published theme to render the application: MEMBER carries `tenant.theme.read`. Tenants seeded
-- before it joined the role keep the old list (seedSystemRoles never changes an existing role).
UPDATE machvon.role_definition
   SET permissions = array_append(permissions, 'tenant.theme.read'),
       version = version + 1
 WHERE code = 'MEMBER'
   AND is_system
   AND NOT ('tenant.theme.read' = ANY (permissions));

-- The event a published theme sends to the platform (and to the owners of the tenant); the payload names the version and
-- the hash, never the configuration.
INSERT INTO machvon.notification_event_type (id, event_type, owning_module, schema_version, payload_schema, allowed_purposes, data_classification, status)
VALUES (
  gen_random_uuid(),
  'sas.theme.published.v1',
  'SAS',
  1,
  '{"type":"object","required":["tenant_id","version","config_hash"],"properties":{"tenant_id":{"type":"string","format":"uuid"},"version":{"type":"integer","minimum":1},"config_hash":{"type":"string","minLength":64,"maxLength":64},"source_version":{"type":["integer","null"],"minimum":1}}}'::jsonb,
  ARRAY['OPERATIONAL'],
  'PUBLIC',
  'Active'
)
ON CONFLICT (event_type, schema_version) DO NOTHING;
