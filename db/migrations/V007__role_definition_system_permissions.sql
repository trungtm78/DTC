-- Authored by hand (not generated): ST-ADM-005 AC-4 and BR-IAM-05 (e). No role definition may hold a system permission.
-- The design CHECK lists four exact names; the catalogue has seven system.* permissions and patterns such as system.* passed.
-- Any element that starts with 'system.' is refused, for every role, at the database.
DO $migration$
DECLARE
  violating integer;
  old_name text;
BEGIN
  SELECT count(*) INTO violating
    FROM machvon.role_definition r
    WHERE EXISTS (SELECT 1 FROM unnest(r.permissions) AS p WHERE p LIKE 'system.%');
  IF violating > 0 THEN
    RAISE EXCEPTION 'V007 cannot run: % role definition(s) already hold a system permission; repair them first', violating
      USING ERRCODE = '23514';
  END IF;

  -- The design CHECK is unnamed, so PostgreSQL named it; find it by what it forbids and drop it.
  FOR old_name IN
    SELECT c.conname
      FROM pg_constraint c
      WHERE c.conrelid = 'machvon.role_definition'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%system.theme.manage%'
  LOOP
    EXECUTE format('ALTER TABLE machvon.role_definition DROP CONSTRAINT %I', old_name);
  END LOOP;
END;
$migration$;

-- A CHECK cannot hold a subquery, so the elements are joined with the unit separator (U+001F, written as the escape
-- \x1f; no permission name contains it) and an element that starts with 'system.' is found at the start of the
-- text or right after a separator. The regex escape for the dot is doubled because E'' strings process backslashes.
ALTER TABLE machvon.role_definition ADD CONSTRAINT role_definition_no_system_permission_ck
  CHECK (array_to_string(permissions, E'\x1f') !~ E'(^|\x1f)system\\.');
