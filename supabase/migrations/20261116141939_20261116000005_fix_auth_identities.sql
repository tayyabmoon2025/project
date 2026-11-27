/*
# Fix auth.identities and auth.instances for manual user creation

## Problem
The bootstrap_first_admin and admin_create_user functions insert directly into
auth.users but never insert into auth.instances or auth.identities. Supabase Auth's
login flow requires both: auth.instances must have a matching row for the
instance_id, and auth.identities must have a row with provider='email' for
password-based sign-in to succeed. Without them, login returns a 500
"Database error querying schema".

## Changes
1. Recreate bootstrap_first_admin to also insert into auth.identities after
   creating the auth.users row.
2. Recreate admin_create_user to also insert into auth.identities after
   creating the auth.users row.
3. Both functions use the same instance_id pattern ('00000000-0000-0000-0000-000000000000').
   The auth.instances row is expected to already exist (seeded separately).

## Security
- No changes to RLS policies or grants.
- Functions remain SECURITY DEFINER with restricted search_path.
*/

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(p_username text, p_password text, p_full_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  existing_admin uuid;
  new_user_id uuid;
  pseudo_email text;
BEGIN
  SELECT id INTO existing_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  IF existing_admin IS NOT NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE username = p_username;
  IF FOUND THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  pseudo_email := lower(p_username) || '@schooldesk.local';

  SELECT id INTO new_user_id FROM auth.users WHERE email = pseudo_email;
  IF new_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = new_user_id;
  END IF;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    email_change_confirm_status
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    pseudo_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    0
  )
  RETURNING id INTO new_user_id;

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    new_user_id::text,
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', pseudo_email, 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (new_user_id, p_username, p_full_name, 'admin', 'active');

  RETURN new_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_user(p_username text, p_password text, p_full_name text, p_role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  new_user_id uuid;
  pseudo_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  IF p_role NOT IN ('admin', 'teacher', 'parent') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF length(p_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE username = lower(p_username);
  IF FOUND THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  pseudo_email := lower(p_username) || '@schooldesk.local';

  SELECT id INTO new_user_id FROM auth.users WHERE email = pseudo_email;
  IF new_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = new_user_id;
  END IF;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    email_change_confirm_status
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    pseudo_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    0
  )
  RETURNING id INTO new_user_id;

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    new_user_id::text,
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', pseudo_email, 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (new_user_id, lower(p_username), p_full_name, p_role, 'active');

  RETURN new_user_id;
END;
$function$;
