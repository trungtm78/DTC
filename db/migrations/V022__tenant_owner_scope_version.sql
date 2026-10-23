-- Authored by hand (not generated): assigning a TENANT_OWNER grant to a person who already is an active member changes what that
-- membership may do, so the control-plane role has to raise the authorization version of the membership in the same transaction
-- (the effective-access cache is keyed by it). Only this column is added to what V021 opened.
GRANT UPDATE (scope_version) ON TABLE machvon.membership TO machvon_control;
