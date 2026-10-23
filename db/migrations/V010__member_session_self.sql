-- Authored by hand (not generated): tenants seeded before `session.self` joined the MEMBER role (it is what getMyEntitlements
-- needs) keep the old permission list, because seedSystemRoles inserts a missing role but never changes an existing one.
-- migrate: privileged
-- Runs as the privileged connection, not as machvon_owner: role_definition has FORCE row-level security, so only that
-- connection can reach the rows of every tenant at once, and the statement needs no tenant context.
UPDATE machvon.role_definition
   SET permissions = array_append(permissions, 'session.self'),
       version = version + 1
 WHERE code = 'MEMBER'
   AND is_system
   AND NOT ('session.self' = ANY (permissions));
