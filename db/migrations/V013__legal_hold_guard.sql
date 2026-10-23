-- Authored by hand (not generated): the legal hold guard of ST-ADM-003 and BR-PLT-04.
-- A hold does not stop reads or writes of business data, it stops every delete, purge and anonymisation of what it
-- contains: TENANT contains everything, UNIT the units of a subtree with their projects and contracts, PROJECT a
-- project and its contracts, CONTRACT one contract, RESOURCE the listed ids.

CREATE INDEX legal_hold_active_idx ON machvon.legal_hold (tenant_id) WHERE status = 'Active';

-- Holds are kept for good (ADM.md section 6: permanent retention): the runtime role may not delete or truncate them.
REVOKE DELETE, TRUNCATE ON TABLE machvon.legal_hold FROM machvon_app;

-- LegalHoldService.isHeld(resource): whether an Active hold that has started contains the resource. SECURITY INVOKER,
-- so row-level security keeps the answer to the tenant of the transaction. Paths end with a slash, so the prefix test
-- compares whole path segments.
CREATE FUNCTION machvon.legal_hold_blocks(p_resource_type text, p_resource_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  WITH active AS (
    SELECT h.resource_scope ->> 'kind' AS kind,
           ARRAY(SELECT jsonb_array_elements_text(coalesce(h.resource_scope -> 'ids', '[]'::jsonb)))::uuid[] AS ids
      FROM machvon.legal_hold h
     WHERE h.status = 'Active' AND h.effective_at <= now()
  )
  SELECT EXISTS (
    SELECT 1
      FROM active a
     WHERE a.kind = 'TENANT'
        OR (
          p_resource_id IS NOT NULL
          AND (
            p_resource_id = ANY (a.ids)
            OR (a.kind = 'PROJECT' AND p_resource_type = 'contract'
                AND EXISTS (SELECT 1 FROM machvon.contract c WHERE c.id = p_resource_id AND c.project_id = ANY (a.ids)))
            OR (a.kind = 'UNIT' AND p_resource_type = 'organization_unit'
                AND EXISTS (SELECT 1
                              FROM machvon.organization_unit r
                              JOIN machvon.organization_unit u ON u.id = ANY (a.ids)
                             WHERE r.id = p_resource_id AND starts_with(r.path, u.path)))
            OR (a.kind = 'UNIT' AND p_resource_type = 'project'
                AND EXISTS (SELECT 1
                              FROM machvon.project p
                              JOIN machvon.organization_unit r ON r.id = p.owner_unit_id
                              JOIN machvon.organization_unit u ON u.id = ANY (a.ids)
                             WHERE p.id = p_resource_id AND starts_with(r.path, u.path)))
            OR (a.kind = 'UNIT' AND p_resource_type = 'contract'
                AND EXISTS (SELECT 1
                              FROM machvon.contract c
                              JOIN machvon.project p ON p.id = c.project_id
                              JOIN machvon.organization_unit r ON r.id = p.owner_unit_id
                              JOIN machvon.organization_unit u ON u.id = ANY (a.ids)
                             WHERE c.id = p_resource_id AND starts_with(r.path, u.path)))
          )
        )
  );
$fn$;

-- The backstop of every purge path: a delete of a held row fails with the dedicated SQLSTATE LH001 (the application
-- maps it to LEGAL_HOLD_ACTIVE). The arguments name the row's resource type (a column, or '=literal') and the column
-- that holds its id ('' when the row stands for no single resource: only a tenant hold contains it).
CREATE FUNCTION machvon.guard_legal_hold() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_row jsonb := to_jsonb(OLD);
  v_type text;
  v_id uuid;
BEGIN
  v_type := CASE WHEN left(TG_ARGV[0], 1) = '=' THEN substr(TG_ARGV[0], 2) ELSE v_row ->> TG_ARGV[0] END;
  v_id := CASE WHEN TG_ARGV[1] = '' THEN NULL ELSE nullif(v_row ->> TG_ARGV[1], '')::uuid END;
  IF machvon.legal_hold_blocks(v_type, v_id) THEN
    RAISE EXCEPTION 'LEGAL_HOLD_ACTIVE' USING ERRCODE = 'LH001';
  END IF;
  RETURN OLD;
END;
$fn$;

-- The tables the retention policy purges (BR-ADM-11): the technical classes and the audit trail.
CREATE TRIGGER idempotency_record_legal_hold BEFORE DELETE ON machvon.idempotency_record
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_legal_hold('resource_type', 'resource_id');
CREATE TRIGGER outbox_event_legal_hold BEFORE DELETE ON machvon.outbox_event
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_legal_hold('aggregate_type', 'aggregate_id');
CREATE TRIGGER audit_event_legal_hold BEFORE DELETE ON machvon.audit_event
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_legal_hold('resource_type', 'resource_id');
CREATE TRIGGER integration_event_inbox_legal_hold BEFORE DELETE ON machvon.integration_event_inbox
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_legal_hold('=integration_event_inbox', '');
CREATE TRIGGER user_session_legal_hold BEFORE DELETE ON machvon.user_session
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_legal_hold('=user_session', '');
CREATE TRIGGER delivery_attempt_legal_hold BEFORE DELETE ON machvon.delivery_attempt
  FOR EACH ROW EXECUTE FUNCTION machvon.guard_legal_hold('=delivery_attempt', '');
