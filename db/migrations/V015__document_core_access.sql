-- Authored by hand (not generated): the document core guards of ST-DOC-001 (BR-DOC-16, BR-DOC-19).
-- A stored file version never changes: its bytes, checksum and stage are fixed when it is written. Only the result
-- of the malware scan may be filled in, once, by the scan (PENDING to CLEAN or INFECTED).

ALTER TABLE machvon.document_version
  ADD CONSTRAINT document_version_scan_status_ck CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED'));

-- One object key names one stored file of a tenant.
CREATE UNIQUE INDEX document_version_object_key_uq ON machvon.document_version (tenant_id, object_key);

CREATE FUNCTION machvon.guard_document_version() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_user = 'machvon_owner' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.scan_status = 'PENDING'
     AND NEW.scan_status IN ('CLEAN', 'INFECTED')
     AND (to_jsonb(NEW) - 'scan_status') = (to_jsonb(OLD) - 'scan_status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'document versions are immutable (% on %.% by %)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
    USING ERRCODE = '42501';
END;
$fn$;

CREATE TRIGGER document_version_immutable BEFORE UPDATE OR DELETE ON machvon.document_version
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_document_version();
CREATE TRIGGER document_version_no_truncate BEFORE TRUNCATE ON machvon.document_version
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.guard_document_version();

REVOKE TRUNCATE ON TABLE machvon.document_version FROM machvon_app;

-- A register restarts at 1 every year, so one symbol ("01/QD-UBND") comes back each year: the symbol of an outgoing
-- document is unique within the year of its number, not within the tenant for all time.
DROP INDEX machvon.document_symbol_out_uq;
CREATE UNIQUE INDEX document_symbol_out_uq ON machvon.document (tenant_id, number_year, symbol)
  WHERE doc_kind = 'OUTGOING' AND symbol IS NOT NULL;
