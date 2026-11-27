/*
# Create the first administrator account

## Why
The database had no accounts at all (user_profiles, auth.users and auth.identities
were all empty), so sign-in could not succeed for anyone. This seeds one working
administrator account so the school can sign in and create the rest of its users
from the User Accounts screen.

## What it writes
- `auth.users` row: email `admin@schooldesk.local`, password hashed with bcrypt,
  email confirmed, every token column set to an empty string (the shape Supabase
  Auth expects), role recorded in `raw_app_meta_data`.
- `auth.identities` row: `id` and `provider_id` both set to the new user's id.
- `public.user_profiles` row: username `admin`, role `admin`, status `active`.

## Safety
- Does nothing if any administrator already exists, so it can be re-run safely and
  can never overwrite a live account.
- The password is stored only as a bcrypt hash; no readable password is saved.
- The administrator can change this password from inside the app after signing in.
*/

DO $$
DECLARE
  new_id uuid := gen_random_uuid();
  pseudo_email text := 'admin@schooldesk.local';
  plain_password text := 'Admin@123';
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE role = 'admin') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = pseudo_email) THEN
    RETURN;
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
    pseudo_email, extensions.crypt(plain_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', 'admin'),
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

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (new_id, 'admin', 'School Administrator', 'admin', 'active');
END $$;
