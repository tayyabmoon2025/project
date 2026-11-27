/*
# Fix gen_salt/crypt search path in auth functions

## Problem
The `bootstrap_first_admin` and `admin_create_user` SECURITY DEFINER functions
set `search_path = public, auth` but `gen_salt()` and `crypt()` from the pgcrypto
extension live in the `extensions` schema, which was not in the search path.
This caused "function gen_salt(text) does not exist" errors.

## Fix
Recreates both functions with `search_path = public, auth, extensions` so that
pgcrypto functions are resolved correctly.
*/

-- Recreate bootstrap_first_admin with corrected search path
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(
  p_username text,
  p_password text,
  p_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
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

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (new_user_id, p_username, p_full_name, 'admin', 'active');

  RETURN new_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(text, text, text) TO authenticated, anon;

-- Recreate admin_create_user with corrected search path
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_username text,
  p_password text,
  p_full_name text,
  p_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
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

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (new_user_id, lower(p_username), p_full_name, p_role, 'active');

  RETURN new_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) TO authenticated;

-- Recreate admin_remove_user with corrected search path (no gen_salt here but consistent)
CREATE OR REPLACE FUNCTION public.admin_remove_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can remove accounts';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove your own account';
  END IF;

  DELETE FROM public.user_profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_remove_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_user(uuid) TO authenticated;
