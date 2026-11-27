/*
# Fix username sign-in: repair login rows and the account-creation function

## Root cause this migration fixes
Signing in as the Accountant failed with a 500 "Database error querying schema"
from Supabase Auth, while signing in as Admin returned a normal "Invalid login
credentials". The password was never even checked - the account's login row was
malformed, so authentication could not read it.

Two separate faults were found:

1. **The account-creation function wrote the identity row in a shape Supabase
   Auth cannot read.** Supabase stores a login as a row in `auth.users` plus a
   linked row in `auth.identities`. The function was writing the *email address*
   into `auth.identities.provider_id`, where every account created by Supabase
   Auth itself stores the user's id. Supabase casts that column to a uuid while
   authenticating, so the cast failed and the whole sign-in request errored out.
   The same function also left `confirmation_token`, `recovery_token`,
   `email_change` and `email_change_token_new` as NULL, where working accounts
   store an empty string.

2. **An older copy of the function was live in the database.** It matched fault 1,
   and additionally had lost the "this username already exists" check that
   protects against duplicate logins.

## What this migration changes

### 1. Repairs the existing login rows (`auth.users` / `auth.identities`)
For every username-based account (`...@schooldesk.local`), it:
- replaces an unusable `provider_id` with the user's id, leaving valid ones alone,
- makes sure the identity data carries the email, the user id and a verified flag,
- fills any NULL confirmation / recovery / email-change tokens with an empty
  string, matching the accounts that already work,
- confirms the email where that was missing.

This is a normalising repair: it only fills in what is missing or malformed, and
changes nothing on accounts that are already correct. It does not touch passwords
and does not reset anybody's credentials.

### 2. Replaces `admin_provision_account`
- Writes the identity row exactly the way Supabase Auth writes it (`id` and
  `provider_id` set to the new user's id).
- Writes every confirmation / email-change token as an empty string.
- Confirms the email immediately, so the account can sign in straight away.
- Restores the duplicate-username guard, and also refuses a username whose login
  already exists even if its profile row is missing.
- Checks usernames case-insensitively, so "Shankhan" and "shankhan" cannot both
  be created.
- Keeps the password hashed with bcrypt inside the database. No readable password
  is ever stored.
- Keeps the administrator-only check (`can_manage_users()`), so an Accountant,
  Teacher, Parent or Student cannot create accounts.
- Records the role in `raw_app_meta_data` (which the account owner cannot edit)
  instead of `raw_user_meta_data` (which they can), so the role cannot be
  tampered with from the browser. The app still authorises from `user_profiles`.

### 3. Replaces `admin_reset_username`
- Keeps the login email and the identity data in step with the new username, so
  renaming an account cannot leave it unable to sign in.
- Refuses a rename onto a username whose login already exists, and refuses a
  rename of an account that no longer exists.

## Security
- No policy, grant or row-level-security rule is weakened anywhere.
- No table, column or index is added, dropped or renamed.
- Passwords remain bcrypt hashes in `auth.users.encrypted_password`; no plain
  text password is written to any table.
- The service-role key is not used or exposed anywhere; these functions run
  inside the database.
- All three functions keep `SECURITY DEFINER` with a fixed `search_path`, keep
  EXECUTE revoked from PUBLIC and anon, and grant EXECUTE only to authenticated
  callers, who are then checked against `can_manage_users()`.

## Notes
- Safe to re-run: the repair is idempotent and the functions are CREATE OR
  REPLACE.
- Sign-in itself is unchanged in design: a username is still mapped to
  `<username>@schooldesk.local` internally, and users keep typing only a
  username.
*/

-- 1. Repair existing login rows ------------------------------------------------
DO $$
DECLARE
  r record;
  v_pseudo_email text;
BEGIN
  FOR r IN
    SELECT u.id,
           u.email,
           u.raw_app_meta_data,
           (SELECT i.id FROM auth.identities i
             WHERE i.user_id = u.id AND i.provider = 'email'
             ORDER BY i.created_at LIMIT 1) AS identity_id,
           (SELECT i.provider_id FROM auth.identities i
             WHERE i.user_id = u.id AND i.provider = 'email'
             ORDER BY i.created_at LIMIT 1) AS provider_id,
           (SELECT p.role FROM public.user_profiles p WHERE p.id = u.id) AS profile_role
      FROM auth.users u
     WHERE lower(coalesce(u.email, '')) LIKE '%@schooldesk.local'
  LOOP
    v_pseudo_email := lower(r.email);

    UPDATE auth.users
       SET confirmation_token = coalesce(confirmation_token, ''),
           recovery_token = coalesce(recovery_token, ''),
           email_change = coalesce(email_change, ''),
           email_change_token_new = coalesce(email_change_token_new, ''),
           email_change_token_current = coalesce(email_change_token_current, ''),
           phone_change = coalesce(phone_change, ''),
           phone_change_token = coalesce(phone_change_token, ''),
           reauthentication_token = coalesce(reauthentication_token, ''),
           email_change_confirm_status = coalesce(email_change_confirm_status, 0),
           is_sso_user = coalesce(is_sso_user, false),
           is_anonymous = coalesce(is_anonymous, false),
           email_confirmed_at = coalesce(email_confirmed_at, created_at),
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
             || jsonb_build_object('sub', r.id::text, 'email', v_pseudo_email, 'email_verified', true),
           raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
             || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'))
             || CASE WHEN r.profile_role IS NOT NULL
                     THEN jsonb_build_object('role', r.profile_role)
                     ELSE '{}'::jsonb END
     WHERE id = r.id;

    IF r.identity_id IS NOT NULL THEN
      UPDATE auth.identities
         SET provider_id = CASE
               WHEN coalesce(provider_id, '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                 THEN provider_id
               ELSE r.id::text
             END,
             identity_data = coalesce(identity_data, '{}'::jsonb)
               || jsonb_build_object('sub', r.id::text, 'email', v_pseudo_email, 'email_verified', true),
             updated_at = now()
       WHERE id = r.identity_id;
    END IF;
  END LOOP;
END $$;

-- 2. Account creation, writing the login the way Supabase Auth expects ---------
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
  IF NOT public.can_manage_users() THEN
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

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE lower(username) = clean_username) THEN
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

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = pseudo_email) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    email_change_confirm_status, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    pseudo_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', p_role),
    jsonb_build_object('sub', new_id::text, 'email', pseudo_email, 'email_verified', true),
    false,
    '', '', '', '', '', '', '', '',
    0, false, false
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    new_id, new_id,
    jsonb_build_object('sub', new_id::text, 'email', pseudo_email, 'email_verified', true),
    'email', new_id::text, now(), now(), now()
  );

  INSERT INTO public.user_profiles (id, username, full_name, role, status, student_id, mobile_number)
  VALUES (new_id, clean_username, btrim(p_full_name), p_role, 'active', p_student_id, nullif(btrim(coalesce(p_mobile, '')), ''));

  RETURN new_id;
END $$;

-- 3. Renaming keeps the login row in step -------------------------------------
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
  pseudo_email text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change usernames';
  END IF;

  IF length(clean_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE lower(username) = clean_username AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  pseudo_email := clean_username || '@schooldesk.local';

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = pseudo_email AND id <> p_user_id) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  UPDATE public.user_profiles
     SET username = clean_username
   WHERE id = p_user_id;

  UPDATE auth.users
     SET email = pseudo_email,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
           || jsonb_build_object('email', pseudo_email),
         updated_at = now()
   WHERE id = p_user_id;

  UPDATE auth.identities
     SET identity_data = coalesce(identity_data, '{}'::jsonb)
           || jsonb_build_object('email', pseudo_email),
         updated_at = now()
   WHERE user_id = p_user_id AND provider = 'email';
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_provision_account(text, text, text, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_username(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_provision_account(text, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_username(uuid, text) TO authenticated;
