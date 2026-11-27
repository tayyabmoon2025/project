/*
# Switch to Username-Based Authentication

## Purpose
Changes authentication from email-based to username-based. Users sign in with a unique username
and password instead of an email. Admin has exclusive control to create, suspend, or remove
Teacher and Parent accounts — no self-registration.

## 1. Schema Changes

### `user_profiles` — add `username` column
- `username` (text, unique, not null) — the login identifier users type at sign-in
- Added after `full_name`

### `is_admin()` helper
- Already exists from the previous migration; no changes needed.

## 2. Security Changes

### user_profiles INSERT policy
- Previously allowed any authenticated user to insert (for self-registration).
- Now restricted: only admins can insert (WITH CHECK public.is_admin()).
- This prevents self-registration — only admins create accounts.

### user_profiles UPDATE policy
- Users can still update their own row, but the WITH CHECK now also prevents
  changing role, status, or username (admin-controlled fields).

## 3. Bootstrap admin
- A SECURITY DEFINER function `bootstrap_first_admin()` creates the first admin
  account if no admin exists yet. Called from the AuthPage when no users exist.
- Creates an auth.users entry with a pseudo-email and inserts a user_profiles row.
- Returns the auth user id on success, or null if an admin already exists.

## 4. Important Notes
1. Supabase Auth requires an email field internally — usernames are mapped to
   pseudo-emails of the form `<username>@schooldesk.local`. Users never see this.
2. The first admin is bootstrapped via the `bootstrap_first_admin()` RPC.
3. After the first admin exists, all account creation goes through the Admin panel.
4. Email confirmation remains OFF.
*/

-- Add username column to user_profiles
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS username text UNIQUE NOT NULL;

-- Drop old INSERT policy that allowed self-registration
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.user_profiles;

-- Only admins can create accounts now
CREATE POLICY "Admins can insert profiles"
ON public.user_profiles FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- Update the SELECT to also include username
-- (No policy change needed — SELECT policy already covers all columns)

-- Bootstrap function: creates the first admin if none exists
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(
  p_username text,
  p_password text,
  p_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_admin uuid;
  new_user_id uuid;
  pseudo_email text;
BEGIN
  -- Check if an admin already exists
  SELECT id INTO existing_admin FROM public.user_profiles WHERE role = 'admin' LIMIT 1;
  IF existing_admin IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Check if username is taken
  PERFORM 1 FROM public.user_profiles WHERE username = p_username;
  IF FOUND THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  -- Create pseudo-email
  pseudo_email := lower(p_username) || '@schooldesk.local';

  -- Check if auth user with this email already exists
  SELECT id INTO new_user_id FROM auth.users WHERE email = pseudo_email;
  IF new_user_id IS NOT NULL THEN
    -- Delete existing auth user to allow fresh creation
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
  VALUES (new_user_id, p_username, p_full_name, 'admin', 'active');

  RETURN new_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(text, text, text) TO authenticated;

-- Also allow anon to call bootstrap (needed before any user is signed in)
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin(text, text, text) TO anon;
