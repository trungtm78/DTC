-- Authored by hand (not generated): the one cross-tenant step an invitation needs. A tenant administrator invites a
-- person by email; the person's account (control-plane table user_account, which the application role cannot touch)
-- must exist before the membership row can point at it. The function below finds the account of the email or creates
-- an unbound shell for it (idp_subject 'invitation:<uuid>'); the person binds their identity to it when they accept.
-- It returns only the account id, so it gives no way to read other accounts: the email is the caller's own input.
CREATE FUNCTION machvon.ensure_invited_account(p_email text, p_display_name text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = machvon, pg_temp
AS $fn$
DECLARE
  v_email text := lower(btrim(p_email));
  v_id uuid;
BEGIN
  IF v_email = '' OR position('@' IN v_email) < 2 OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_id FROM machvon.user_account WHERE email_normalized = v_email;
  IF v_id IS NULL THEN
    INSERT INTO machvon.user_account (id, idp_subject, email_normalized, display_name, status)
    VALUES (
      gen_random_uuid(),
      'invitation:' || gen_random_uuid()::text,
      v_email,
      left(coalesce(nullif(btrim(p_display_name), ''), split_part(v_email, '@', 1)), 120),
      'Active'
    )
    ON CONFLICT (email_normalized) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM machvon.user_account WHERE email_normalized = v_email;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION machvon.ensure_invited_account(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION machvon.ensure_invited_account(text, text) TO machvon_app;
