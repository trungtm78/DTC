-- Authored by hand (not generated): platform-service guards that schema_reference.sql only describes in comments.
-- Append-only audit: BR-PLT-01 and ST-KERNEL-023. Only machvon_owner (the migration owner, used for the tamper drill) may edit.
CREATE FUNCTION machvon.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_user = 'machvon_owner' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit tables are append-only (% on %.% by %)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
    USING ERRCODE = '42501';
END;
$fn$;

CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON machvon.audit_event
  FOR EACH ROW EXECUTE FUNCTION machvon.reject_audit_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON machvon.audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.reject_audit_mutation();
CREATE TRIGGER audit_seal_append_only BEFORE UPDATE OR DELETE ON machvon.audit_seal
  FOR EACH ROW EXECUTE FUNCTION machvon.reject_audit_mutation();
CREATE TRIGGER audit_seal_no_truncate BEFORE TRUNCATE ON machvon.audit_seal
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.reject_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE machvon.audit_event, machvon.audit_seal FROM machvon_app;

-- The outbox relay reads and marks events of every tenant (policy outbox_relay_access) and does nothing else.
GRANT SELECT, UPDATE ON TABLE machvon.outbox_event TO machvon_outbox_relay;

-- The design makes tenant_boundary RESTRICTIVE for every role, which also hides every row from the relay
-- (its permissive policy outbox_relay_access is ANDed with it). Every other role keeps the tenant boundary.
DROP POLICY tenant_boundary ON machvon.outbox_event;
CREATE POLICY tenant_boundary ON machvon.outbox_event AS RESTRICTIVE
  TO machvon_owner, machvon_app, machvon_control, machvon_reporting, machvon_sync
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
