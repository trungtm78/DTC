-- Authored by hand (not generated): ST-ADM-005 TK-3, one Active grant per member, role and scope.
-- scope_ref_ids is stored sorted and de-duplicated by the application, so equal scopes compare equal.
CREATE UNIQUE INDEX role_grant_active_uq ON machvon.role_grant (tenant_id, membership_id, role_id, scope_kind, scope_ref_ids) WHERE status = 'Active';
