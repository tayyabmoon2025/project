/*
# Portal accounts — create, reset, and rename logins

## 1. Purpose
Three administrator-only functions so the office can hand out portal logins without the
administrator ever being signed out or seeing a raw error.

## 2. New functions

### `admin_provision_account(p_username, p_password, p_full_name, p_role, p_student_id, p_mobile)`
Creates a login and its profile row in one step.
- Students are always created with the `student` role and must be linked to a student record.
- The role is checked against the allowed list, so the browser cannot invent one.
- Refuses a username or student that is already taken, and returns a friendly message.
- Returns the new account's id.

### `admin_set_password(p_user_id, p_password)`
Sets a new password for an existing account. Used by the office to reset a student's or
teacher's password when they forget it. The password is hashed by the database, so it is
never stored in readable form. Refuses to change an administrator's password through this
route unless the caller is that same administrator.

### `admin_reset_username(p_user_id, p_username)`
Renames an account so the username keeps matching the admission number or mobile number
when those change. Refuses duplicates.

## 3. Security
- All three are `SECURITY DEFINER` and begin with an `is_admin()` check, so a signed-in
  student, teacher, or parent cannot call them.
- `EXECUTE` is revoked from the anonymous role, so they are unreachable before sign-in.
- Passwords are hashed with bcrypt inside the database and never returned by any function.
*/

CREATE OR REPLACE FUNCTION public.admin_provision_account(
  p_username text,
  p_password text,
  p_full_name text,
  p_role text,
  p_student_id uuid DEFAULT NULL,
  p_mobile text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  clean_username text := lower(btrim(p_username));
  pseudo_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  IF p_role NOT IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant', 'student') THEN
    RAISE EXCEPTION 'That account type is not allowed';
  END IF;

  IF length(clean_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'A full name is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE username = clean_username) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  IF p_role = 'student' THEN
    IF p_student_id IS NULL THEN
      RAISE EXCEPTION 'A student account must be linked to a student record';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.school_students WHERE id = p_student_id) THEN
      RAISE EXCEPTION 'That student record no longer exists';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE student_id = p_student_id) THEN
      RAISE EXCEPTION 'This student already has a portal login';
    END IF;
  END IF;

  pseudo_email := clean_username || '@schooldesk.local';

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = pseudo_email) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    email_change_confirm_status, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    pseudo_email, crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('email', pseudo_email),
    '', '', '', '', '', '', '', '', 0, false, false
  );

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid()::text, new_id,
    jsonb_build_object('sub', new_id::text, 'email', pseudo_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  INSERT INTO public.user_profiles (id, username, full_name, role, status, student_id, mobile_number)
  VALUES (new_id, clean_username, btrim(p_full_name), p_role, 'active', p_student_id, NULLIF(btrim(COALESCE(p_mobile, '')), ''));

  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_password(
  p_user_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  target_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can reset passwords';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  SELECT role INTO target_role FROM public.user_profiles WHERE id = p_user_id;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF target_role = 'admin' AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'An administrator password can only be changed by that administrator';
  END IF;

  UPDATE auth.users
     SET encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   WHERE id = p_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_reset_username(
  p_user_id uuid,
  p_username text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  clean_username text := lower(btrim(p_username));
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change usernames';
  END IF;

  IF length(clean_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE username = clean_username AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  UPDATE public.user_profiles
     SET username = clean_username
   WHERE id = p_user_id;

  UPDATE auth.users
     SET email = clean_username || '@schooldesk.local',
         updated_at = now()
   WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_provision_account(text, text, text, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_password(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_username(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_provision_account(text, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_username(uuid, text) TO authenticated;
