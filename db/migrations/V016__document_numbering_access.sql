-- Authored by hand (not generated): the numbering guards of ST-DOC-002 (BR-DOC-02, BR-DOC-03, BR-DOC-04).
-- The allocation log is append-only: a number is never reused and never deleted; the only change it may see is the
-- approved void (ALLOCATED to VOIDED). A register only moves forward: its counter never decreases, its identity never
-- changes and a closed register stays closed.

-- The issue date of a number is kept with it: a voided number keeps its date after its document is numbered again.
ALTER TABLE machvon.document_number_allocation ADD COLUMN issued_on date NOT NULL;

CREATE FUNCTION machvon.guard_number_allocation() RETURNS trigger
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
     AND OLD.status = 'ALLOCATED'
     AND NEW.status = 'VOIDED'
     AND NEW.voided_at IS NOT NULL
     AND NEW.voided_by IS NOT NULL
     AND NEW.void_reason IS NOT NULL
     AND NEW.void_approved_by IS NOT NULL
     AND (to_jsonb(NEW) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'void_approved_by')
       = (to_jsonb(OLD) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'void_approved_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'number allocations are append-only (% on %.% by %)', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
    USING ERRCODE = '42501';
END;
$fn$;

CREATE TRIGGER document_number_allocation_guard BEFORE UPDATE OR DELETE ON machvon.document_number_allocation
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_number_allocation();
CREATE TRIGGER document_number_allocation_no_truncate BEFORE TRUNCATE ON machvon.document_number_allocation
  FOR EACH STATEMENT EXECUTE FUNCTION machvon.guard_number_allocation();

REVOKE DELETE, TRUNCATE ON TABLE machvon.document_number_allocation FROM machvon_app;
REVOKE DELETE, TRUNCATE ON TABLE machvon.document_number_register FROM machvon_app;

CREATE FUNCTION machvon.guard_number_register() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF current_user = 'machvon_owner' THEN
    RETURN NEW;
  END IF;
  IF NEW.last_number < OLD.last_number THEN
    RAISE EXCEPTION 'the counter of a number register never decreases' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'a closed number register stays closed' USING ERRCODE = '23514';
  END IF;
  IF NEW.register_code <> OLD.register_code
     OR NEW.organization_unit_id <> OLD.organization_unit_id
     OR NEW.year <> OLD.year
     OR NEW.direction <> OLD.direction
     OR NEW.mode <> OLD.mode THEN
    RAISE EXCEPTION 'the identity of a number register never changes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER document_number_register_guard BEFORE UPDATE ON machvon.document_number_register
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_number_register();

-- The numbers missing from 1..last_number of a register (BR-DOC-03: any result is a serious error). SECURITY INVOKER,
-- so row-level security keeps the answer to the tenant of the transaction.
CREATE FUNCTION machvon.register_gaps(p_register_id uuid) RETURNS SETOF integer
LANGUAGE sql
STABLE
AS $fn$
  SELECT g
    FROM machvon.document_number_register r
    CROSS JOIN LATERAL generate_series(1, r.last_number) AS g
    LEFT JOIN machvon.document_number_allocation a
      ON a.tenant_id = r.tenant_id AND a.register_id = r.id AND a.number = g
   WHERE r.id = p_register_id AND a.id IS NULL
   ORDER BY g;
$fn$;

GRANT EXECUTE ON FUNCTION machvon.register_gaps(uuid) TO machvon_app;
