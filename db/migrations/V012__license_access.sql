-- Authored by hand (not generated): what the control plane may do with licenses (ST-SAS-003, BR-SAS-11, BR-SAS-12).

-- The signing keys of the platform: the control role reads them (the active key must exist before it signs) and registers
-- the public key of a key it was given. The table holds the key id, the public key and a reference to the KMS or HSM key; a
-- private key is never stored in the database. A key row is never updated or deleted by this role.
GRANT SELECT, INSERT ON TABLE machvon.license_signing_key TO machvon_control;

-- Issued licenses are immutable (BR-SAS-12): the control role inserts a revision and may change only its status, the
-- reason of a suspension or revocation and the version (a renewal supersedes, a revocation ends it). It keeps the
-- tenant_boundary policy: it reaches the licenses of a tenant inside a transaction that names the tenant.
GRANT SELECT, INSERT ON TABLE machvon.license_revision TO machvon_control;
GRANT UPDATE (status, status_reason, version) ON TABLE machvon.license_revision TO machvon_control;

-- The tenant plane reads its license (a read-only DTO) and never writes one: a tenant administrator who calls a license
-- command is refused by the API (AC43), and the database refuses the same change made through the application role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE machvon.license_revision FROM machvon_app;

-- A license command names the license and not its tenant (`/licenses/{id}/revoke`), and a license is row-level protected by
-- its tenant, so the control role finds the tenant of a license through this function: it names each tenant in app.tenant_id
-- while it looks, then puts the caller's setting back exactly as it found it (as memberships_of_user does).
CREATE FUNCTION machvon.license_tenant_of(p_license uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = machvon, pg_temp
AS $fn$
DECLARE
  previous text := current_setting('app.tenant_id', true);
  one_tenant record;
  owner_id uuid;
BEGIN
  FOR one_tenant IN SELECT t.id FROM machvon.tenant t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', one_tenant.id::text, true);
    IF EXISTS (SELECT 1 FROM machvon.license_revision l WHERE l.tenant_id = one_tenant.id AND l.id = p_license) THEN
      owner_id := one_tenant.id;
      EXIT;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous, ''), true);
  RETURN owner_id;
END;
$fn$;
REVOKE ALL ON FUNCTION machvon.license_tenant_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION machvon.license_tenant_of(uuid) TO machvon_control;

-- The reminder the license job sends to the owners of a tenant when a license is about to end (SAS 3.8: "expiring" is a
-- label, thirty days before valid_until; it changes no right). The payload names the license, never its claims.
INSERT INTO machvon.notification_event_type (id, event_type, owning_module, schema_version, payload_schema, allowed_purposes, data_classification, status)
VALUES (
  gen_random_uuid(),
  'sas.license.expiring.v1',
  'SAS',
  1,
  '{"type":"object","required":["tenant_id","license_id","serial","valid_until","days_left"],"properties":{"tenant_id":{"type":"string","format":"uuid"},"license_id":{"type":"string","format":"uuid"},"serial":{"type":"string","minLength":1},"valid_until":{"type":"string","format":"date-time"},"days_left":{"type":"integer","minimum":0,"maximum":30}}}'::jsonb,
  ARRAY['REMINDER', 'OPERATIONAL'],
  'INTERNAL',
  'Active'
)
ON CONFLICT (event_type, schema_version) DO NOTHING;
