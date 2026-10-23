-- Authored by hand (not generated): what the control-plane role machvon_control may touch, and the narrow functions
-- the tenant plane and the control plane use to look across tenants. Written for ST-SAS-001 and ST-IAM-003.

-- Control-plane tables (no tenant_id, no row-level security): the V002 generator revoked the application, sync and
-- reporting roles from them and never granted anything to machvon_control. The signing keys stay closed.
GRANT SELECT, INSERT, UPDATE ON TABLE machvon.tenant, machvon.placement, machvon.user_account,
  machvon.product_plan_version, machvon.plan_feature TO machvon_control;
GRANT SELECT ON TABLE machvon.notification_event_type, machvon.feature_flag TO machvon_control;

-- Tenant tables the control plane writes while it provisions and entitles a tenant. They keep their tenant_boundary
-- policies, so the role sees a tenant's rows only inside a transaction that names the tenant (app.tenant_id).
GRANT SELECT, INSERT, UPDATE ON TABLE machvon.tenant_provisioning_run, machvon.tenant_domain,
  machvon.entitlement_override, machvon.subscription, machvon.idempotency_record TO machvon_control;
-- Insert-only history: entitlement versions, audit rows and outbox events are never edited by this role.
GRANT SELECT, INSERT ON TABLE machvon.entitlement_version, machvon.audit_event, machvon.outbox_event TO machvon_control;
GRANT USAGE ON SEQUENCE machvon.audit_event_seq TO machvon_control;

-- Cross-tenant lookup for selectTenantContext. The table owner is subject to FORCE ROW LEVEL SECURITY too, so the
-- function names each tenant in app.tenant_id while it reads that tenant's memberships and then puts the caller's
-- setting back exactly as it found it. Only the control role may run it, and it returns nothing but these columns.
CREATE FUNCTION machvon.memberships_of_user(p_user uuid)
RETURNS TABLE (
  tenant_id uuid,
  membership_id uuid,
  status text,
  valid_from timestamptz,
  valid_until timestamptz,
  membership_type text,
  tenant_status text,
  tenant_name text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = machvon, pg_temp
AS $fn$
DECLARE
  previous text := current_setting('app.tenant_id', true);
  one_tenant record;
BEGIN
  FOR one_tenant IN SELECT t.id, t.status AS tenant_status, t.name AS tenant_name FROM machvon.tenant t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', one_tenant.id::text, true);
    RETURN QUERY
      SELECT m.tenant_id, m.id, m.status, m.valid_from, m.valid_until, m.membership_type, one_tenant.tenant_status, one_tenant.tenant_name
      FROM machvon.membership m
      WHERE m.tenant_id = one_tenant.id AND m.user_id = p_user
      ORDER BY m.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous, ''), true);
END;
$fn$;
REVOKE ALL ON FUNCTION machvon.memberships_of_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION machvon.memberships_of_user(uuid) TO machvon_control;

-- Tenant state for the policy guard. The design stores the access policy of a suspension in no column, so it is
-- derived: a suspension for a security incident is NO_ACCESS, any other suspension and an offboarding window are
-- READ_ONLY_EXPORT, an active tenant is FULL and every other state is NO_ACCESS (SAS 3.1, BR-SAS-10).
-- The application role may only ask about the tenant of its own transaction.
CREATE FUNCTION machvon.tenant_runtime(p_tenant uuid)
RETURNS TABLE (status text, access_policy text, write_frozen_until timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = machvon, pg_temp
AS $fn$
BEGIN
  IF session_user = 'machvon_app' AND p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT t.status,
           CASE
             WHEN t.status = 'Active' THEN 'FULL'
             WHEN t.status = 'Suspended' AND t.lifecycle_reason = 'SECURITY_INCIDENT' THEN 'NO_ACCESS'
             WHEN t.status IN ('Suspended', 'Offboarding') THEN 'READ_ONLY_EXPORT'
             ELSE 'NO_ACCESS'
           END,
           t.write_frozen_until
    FROM machvon.tenant t
    WHERE t.id = p_tenant;
END;
$fn$;
REVOKE ALL ON FUNCTION machvon.tenant_runtime(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION machvon.tenant_runtime(uuid) TO machvon_control, machvon_app;

-- Personal data in the directory is masked unless the transaction says the caller may read it (iam.member.read_pii).
CREATE FUNCTION machvon.can_read_pii() RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT coalesce(current_setting('app.can_read_pii', true), '') = 'true';
$fn$;
REVOKE ALL ON FUNCTION machvon.can_read_pii() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION machvon.can_read_pii() TO machvon_app, machvon_control;

-- IAM section 6 names this view and the schema lacks it. It is not security_invoker on purpose: the tenant plane has no
-- privilege on user_account, so the view reads it with its owner's rights while the row-level security of membership
-- (FORCE, tenant_boundary) still limits the rows to the tenant of the caller's transaction.
CREATE VIEW machvon.tenant_user_directory AS
SELECT m.tenant_id,
       m.id AS membership_id,
       m.user_id AS user_account_id,
       u.display_name,
       CASE
         WHEN machvon.can_read_pii() THEN u.email_normalized
         ELSE left(split_part(u.email_normalized, '@', 1), 1) || '***@' || split_part(u.email_normalized, '@', 2)
       END AS email,
       CASE
         WHEN u.phone_e164 IS NULL THEN NULL
         WHEN machvon.can_read_pii() THEN u.phone_e164
         ELSE repeat('*', greatest(length(u.phone_e164) - 3, 0)) || right(u.phone_e164, 3)
       END AS phone,
       m.status,
       m.organization_id,
       m.membership_type,
       m.valid_from,
       m.valid_until
FROM machvon.membership m
JOIN machvon.user_account u ON u.id = m.user_id;
REVOKE ALL ON TABLE machvon.tenant_user_directory FROM PUBLIC, machvon_app, machvon_control, machvon_reporting, machvon_sync;
GRANT SELECT ON TABLE machvon.tenant_user_directory TO machvon_app, machvon_control;
