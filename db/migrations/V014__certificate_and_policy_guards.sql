-- Authored by hand (not generated): guards for the signing certificate registry (ST-ADM-008) and the security policy
-- versions (ST-ADM-009).
-- Both tables are kept for good: certificates prove who signed what, policies prove what was enforced when.
REVOKE DELETE, TRUNCATE ON TABLE machvon.signing_certificate FROM machvon_app;
REVOKE DELETE, TRUNCATE ON TABLE machvon.security_policy_version FROM machvon_app;

-- A certificate keeps its identity for good: only the status, its reason and the version may change, and a revoked
-- certificate stays revoked. The expiry job moves Active to Expired; nothing moves back to Active from Revoked.
CREATE FUNCTION machvon.guard_signing_certificate_update() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.holder_membership_id IS DISTINCT FROM OLD.holder_membership_id
     OR NEW.organization_unit_id IS DISTINCT FROM OLD.organization_unit_id
     OR NEW.certificate_serial IS DISTINCT FROM OLD.certificate_serial
     OR NEW.issuer_dn IS DISTINCT FROM OLD.issuer_dn
     OR NEW.subject_dn IS DISTINCT FROM OLD.subject_dn
     OR NEW.provider_code IS DISTINCT FROM OLD.provider_code
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.fingerprint_sha256 IS DISTINCT FROM OLD.fingerprint_sha256
     OR NEW.registered_by IS DISTINCT FROM OLD.registered_by THEN
    RAISE EXCEPTION 'a registered signing certificate cannot change its identity' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'Revoked' AND NEW.status <> 'Revoked' THEN
    RAISE EXCEPTION 'a revoked signing certificate stays revoked' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER signing_certificate_guard BEFORE UPDATE ON machvon.signing_certificate
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_signing_certificate_update();

-- One Published version per tenant, and a version that was published carries its approver and its time.
CREATE UNIQUE INDEX security_policy_one_published_uq ON machvon.security_policy_version (tenant_id) WHERE status = 'Published';
ALTER TABLE machvon.security_policy_version
  ADD CONSTRAINT security_policy_published_ck CHECK (status = 'Draft' OR (approved_by IS NOT NULL AND published_at IS NOT NULL));

-- A policy is immutable once published: the only change a published version may undergo is to become Superseded, and
-- a Superseded one never changes. A draft changes only by being published (its content is a new draft, never an edit).
CREATE FUNCTION machvon.guard_security_policy_update() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.policy_json IS DISTINCT FROM OLD.policy_json
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a security policy version is immutable: create a new version instead' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'Superseded' THEN
    RAISE EXCEPTION 'a superseded security policy version never changes' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'Published' AND (NEW.status <> 'Superseded'
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'a published security policy version can only become superseded' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'Draft' AND NEW.status = 'Superseded' THEN
    RAISE EXCEPTION 'a draft cannot be superseded before it is published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER security_policy_guard BEFORE UPDATE ON machvon.security_policy_version
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_security_policy_update();

-- Expiry reminders (ADM.md ADM-08: a warning 30 days ahead): the job reads the certificates that expire soon.
CREATE INDEX signing_certificate_expiry_idx ON machvon.signing_certificate (tenant_id, valid_until) WHERE status = 'Active';
