/*
# Add admin_create_user function

## Purpose
Allows an authenticated admin to create a new auth user (Teacher or Parent account)
without losing their own session. signUp() on the client replaces the current session,
so we use a SECURITY DEFINER server-side function instead.

## 1. New Function: admin_create_user(p_username, p_password, p_full_name, p_role)
- SECURITY DEFINER — runs with elevated privileges to insert into auth.users
- Checks that the caller is an active admin via is_admin()
- Creates a pseudo-email: <username>@schooldesk.local
- Creates the auth.users entry with encrypted password
- Inserts the user_profiles row
- Returns the new user's uuid on success
- Raises exception if caller is not admin, username taken, or invalid role

## 2. Security
- REVOKE EXECUTE from PUBLIC, anon
- GRANT EXECUTE to authenticated only
- The function self-checks is_admin() so non-admins get an error even if they can call it
*/

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_username text,
  p_password text,
  p_full_name text,
  p_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_user_id uuid;
  pseudo_email text;
BEGIN
  -- Verify caller is an active admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  -- Validate role
  IF p_role NOT IN ('admin', 'teacher', 'parent') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Validate password length
  IF length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  -- Validate username
  IF length(p_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  -- Check if username is taken
  PERFORM 1 FROM public.user_profiles WHERE username = lower(p_username);
  IF FOUND THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  -- Create pseudo-email
  pseudo_email := lower(p_username) || '@schooldesk.local';

  -- Check if auth user with this email already exists
  SELECT id INTO new_user_id FROM auth.users WHERE email = pseudo_email;
  IF new_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = new_user_id;
  END IF;

  -- Create the auth user
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

  -- Create the profile
  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (new_user_id, lower(p_username), p_full_name, p_role, 'active');

  RETURN new_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) TO authenticated;

-- Also add admin_remove_user function for clean account deletion
CREATE OR REPLACE FUNCTION public.admin_remove_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Verify caller is an active admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can remove accounts';
  END IF;

  -- Prevent self-deletion
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove your own account';
  END IF;

  -- Delete the profile (cascades to parent_student_links)
  DELETE FROM public.user_profiles WHERE id = p_user_id;

  -- Delete the auth user
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_remove_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_user(uuid) TO authenticated;
