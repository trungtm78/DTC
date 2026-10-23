-- Authored by hand (not generated): what the control-plane role needs to finish the provisioning of a tenant (SAS 3.1 steps
-- 8, 9 and 11) and to assign an owner from the control plane (BR-IAM-05: TENANT_OWNER is only granted from there). The tables
-- keep their tenant_boundary policies, so the role sees the rows of a tenant only inside a transaction that names the tenant.
GRANT SELECT, INSERT ON TABLE machvon.role_definition, machvon.organization_unit, machvon.membership,
  machvon.membership_invitation, machvon.role_grant TO machvon_control;

-- Only the columns a state change touches can be updated; the ones that identify a grant, a membership or a role stay as written.
GRANT UPDATE (status, ended_reason, version) ON TABLE machvon.membership TO machvon_control;
GRANT UPDATE (status, revoked_at) ON TABLE machvon.membership_invitation TO machvon_control;
GRANT UPDATE (status, revoked_by, revoked_at, revoke_reason, version) ON TABLE machvon.role_grant TO machvon_control;

-- The account of an invited person is created through the same narrow function the tenant plane uses.
GRANT EXECUTE ON FUNCTION machvon.ensure_invited_account(text, text) TO machvon_control;
