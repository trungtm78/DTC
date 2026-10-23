-- Authored by hand: lets the control-plane role read the migration ledger, so the readiness check of the API can tell
-- whether the schema is up to date without a connection of the owner role. Read only: the ledger is still written
-- by the migration runner alone.
GRANT SELECT ON TABLE machvon.schema_migration TO machvon_control;
