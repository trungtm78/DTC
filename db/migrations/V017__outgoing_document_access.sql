-- Authored by hand (not generated): the guards of ST-DOC-005 (DOC.md F4 and F6) for outgoing documents and their signing
-- sessions. Neither table is ever deleted from. A signing session only moves forward and is frozen once it has ended;
-- an outgoing document keeps the people and the unit it was drafted for, the instants of the leader signature and of
-- the seal, and never goes back to a state before the leader signed.

REVOKE DELETE, TRUNCATE ON TABLE machvon.outgoing_document FROM machvon_app;
REVOKE DELETE, TRUNCATE ON TABLE machvon.doc_signing_session FROM machvon_app;

ALTER TABLE machvon.outgoing_document
  ADD CONSTRAINT outgoing_document_signed_chk CHECK (status <> 'SIGNED' OR leader_signed_at IS NOT NULL),
  ADD CONSTRAINT outgoing_document_sealed_chk CHECK (status <> 'SEALED' OR sealed_at IS NOT NULL),
  ADD CONSTRAINT outgoing_document_seal_order_chk CHECK (sealed_at IS NULL OR numbered_at IS NULL OR sealed_at >= numbered_at);

ALTER TABLE machvon.doc_signing_session
  ADD CONSTRAINT doc_signing_session_digest_chk CHECK (digest_hex IS NULL OR digest_hex ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT doc_signing_session_hash_ready_chk CHECK (status IN ('CREATED', 'FAILED', 'EXPIRED', 'CANCELLED') OR digest_hex IS NOT NULL);

CREATE INDEX outgoing_document_recent_idx ON machvon.outgoing_document (tenant_id, created_at DESC, id DESC);
CREATE INDEX doc_signing_session_document_idx ON machvon.doc_signing_session (tenant_id, outgoing_document_id, created_at DESC);

CREATE FUNCTION machvon.guard_outgoing_document() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_user = 'machvon_owner' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'outgoing documents are never deleted (% on %.% by %)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
      USING ERRCODE = '42501';
  END IF;
  IF NEW.document_id <> OLD.document_id
     OR NEW.drafter_user_id <> OLD.drafter_user_id
     OR NEW.drafting_unit_id <> OLD.drafting_unit_id
     OR NEW.layout_profile_id <> OLD.layout_profile_id THEN
    RAISE EXCEPTION 'the document, the drafter, the drafting unit and the layout of an outgoing document never change' USING ERRCODE = '23514';
  END IF;
  IF OLD.leader_signed_at IS NOT NULL AND NEW.leader_signed_at IS DISTINCT FROM OLD.leader_signed_at THEN
    RAISE EXCEPTION 'the instant of the leader signature never changes' USING ERRCODE = '23514';
  END IF;
  IF OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
    RAISE EXCEPTION 'the instant of the organisation seal never changes' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('SIGNED', 'NUMBERED', 'SEALED') AND NEW.status IN ('DRAFT', 'IN_REVIEW', 'SUBMITTED') THEN
    RAISE EXCEPTION 'a signed outgoing document does not go back to a state before the signature' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER outgoing_document_guard BEFORE UPDATE OR DELETE ON machvon.outgoing_document
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_outgoing_document();
CREATE TRIGGER outgoing_document_no_truncate BEFORE TRUNCATE ON machvon.outgoing_document
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.guard_outgoing_document();

CREATE FUNCTION machvon.signing_session_rank(p_status text) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_status
    WHEN 'CREATED' THEN 0
    WHEN 'HASH_READY' THEN 1
    WHEN 'AWAITING_SIGNER' THEN 2
    WHEN 'SIGNED' THEN 3
    WHEN 'EMBEDDED' THEN 4
    ELSE NULL
  END;
$fn$;

CREATE FUNCTION machvon.guard_signing_session() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_user = 'machvon_owner' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'signing sessions are never deleted (% on %.% by %)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('EMBEDDED', 'FAILED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'a signing session that has ended stays as it was' USING ERRCODE = '23514';
  END IF;
  IF NEW.outgoing_document_id <> OLD.outgoing_document_id
     OR NEW.role <> OLD.role
     OR NEW.base_version_id <> OLD.base_version_id
     OR NEW.adapter_code <> OLD.adapter_code
     OR NEW.expires_at <> OLD.expires_at
     OR NEW.signing_certificate_id IS DISTINCT FROM OLD.signing_certificate_id
     OR NEW.signer_user_id IS DISTINCT FROM OLD.signer_user_id
     OR NEW.digest_hex IS DISTINCT FROM OLD.digest_hex
     OR NEW.byte_range IS DISTINCT FROM OLD.byte_range
     OR NEW.provider_txn_ref IS DISTINCT FROM OLD.provider_txn_ref THEN
    RAISE EXCEPTION 'what a signing session signs and who signs never changes' USING ERRCODE = '23514';
  END IF;
  IF machvon.signing_session_rank(NEW.status) < machvon.signing_session_rank(OLD.status) THEN
    RAISE EXCEPTION 'a signing session only moves forward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER doc_signing_session_guard BEFORE UPDATE OR DELETE ON machvon.doc_signing_session
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_signing_session();
CREATE TRIGGER doc_signing_session_no_truncate BEFORE TRUNCATE ON machvon.doc_signing_session
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.guard_signing_session();
