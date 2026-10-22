-- Authored by hand (not generated): authorization core, BR-IAM-03, BR-IAM-06, ST-IAM-004 and ST-ADM-005.
-- BR-IAM-03 and BR-IAM-13 need a per-membership version that schema_reference.sql does not declare yet (change request queued in TODOS.md).
ALTER TABLE machvon.membership ADD COLUMN scope_version bigint NOT NULL DEFAULT 1;

-- Custom roles rank 1..89; ranks 90..99 belong to system roles (BR-IAM-06).
ALTER TABLE machvon.role_definition ADD CONSTRAINT role_definition_custom_rank_ck CHECK (is_system OR rank <= 89);

-- Grants are never deleted, only Revoked or Expired (IAM section 6). Only machvon_owner may remove a row (tamper drill, data repair).
CREATE FUNCTION machvon.reject_grant_delete() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_user = 'machvon_owner' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'role grants are never deleted (% on %.% by %)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
    USING ERRCODE = '42501';
END;
$fn$;

CREATE TRIGGER role_grant_no_delete BEFORE DELETE ON machvon.role_grant
  FOR EACH ROW EXECUTE FUNCTION machvon.reject_grant_delete();
CREATE TRIGGER role_grant_no_truncate BEFORE TRUNCATE ON machvon.role_grant
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.reject_grant_delete();

REVOKE DELETE, TRUNCATE ON TABLE machvon.role_grant FROM machvon_app;

-- The PDP reads the active grants of one membership on every cache miss. A GIN index on scope_ref_ids already exists in V002.
CREATE INDEX role_grant_membership_idx ON machvon.role_grant (tenant_id, membership_id) WHERE status = 'Active';
