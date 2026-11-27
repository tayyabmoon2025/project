/*
# Switch to GoTrue-native account creation

## Problem
The previous bootstrap_first_admin and admin_create_user functions inserted directly
into auth.users, auth.identities, etc. GoTrue (Supabase Auth backend) has internal
state that can't be fully replicated via SQL inserts — manually created users fail
login with "Database error querying schema" (500).

## Solution
Replace direct SQL inserts with GoTrue-native signUp() in the frontend, using a
temporary Supabase client so the admin's session is not replaced.

### New functions
1. `bootstrap_check()` — returns true if no admin exists yet (for frontend to show/hide bootstrap form)
2. `set_initial_admin(p_username, p_full_name)` — called after signUp to insert the user_profiles row with role='admin'. Callable by authenticated users only when no admin exists.
3. `admin_register_profile(p_username, p_full_name, p_role)` — called after admin uses signUp with temp client. Checks is_admin() and inserts user_profiles row. Fails if username already exists.

### Removed functions
- `bootstrap_first_admin` — replaced by bootstrap_check + set_initial_admin
- `admin_create_user` — replaced by frontend signUp + admin_register_profile

## Security
- `bootstrap_check()`: SECURITY DEFINER, callable by anon. Returns boolean only.
- `set_initial_admin()`: SECURITY DEFINER, callable by authenticated. Inserts profile only if no admin exists.
- `admin_register_profile()`: SECURITY DEFINER, callable by authenticated. Checks is_admin() before inserting.
- `admin_remove_user()`: unchanged, still checks is_admin().
*/

-- Check if bootstrap is needed (no admin exists yet)
CREATE OR REPLACE FUNCTION public.bootstrap_check()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE role = 'admin');
$function$;

GRANT EXECUTE ON FUNCTION public.bootstrap_check() TO anon, authenticated;

-- Set initial admin profile (called after signUp when no admin exists yet)
CREATE OR REPLACE FUNCTION public.set_initial_admin(p_username text, p_full_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  existing_admin_count int;
BEGIN
  SELECT count(*) INTO existing_admin_count FROM public.user_profiles WHERE role = 'admin';
  IF existing_admin_count > 0 THEN
    RAISE EXCEPTION 'An admin account already exists';
  END IF;

  -- Insert the profile row using the current auth.uid()
  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (auth.uid(), lower(p_username), p_full_name, 'admin', 'active');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_initial_admin(text, text) TO authenticated;

-- Register a user profile after admin creates account via signUp with temp client
-- The temp client session is short-lived; the admin re-signs-in afterward
CREATE OR REPLACE FUNCTION public.admin_register_profile(p_username text, p_full_name text, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  IF p_role NOT IN ('admin', 'teacher', 'parent') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  IF length(p_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  -- Check if profile already exists for this user
  PERFORM 1 FROM public.user_profiles WHERE id = auth.uid();
  IF FOUND THEN
    RAISE EXCEPTION 'Profile already exists for this user';
  END IF;

  -- Check username uniqueness
  PERFORM 1 FROM public.user_profiles WHERE username = lower(p_username);
  IF FOUND THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  -- Insert profile for the newly signed-up user
  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (auth.uid(), lower(p_username), p_full_name, p_role, 'active');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_register_profile(text, text, text) TO authenticated;

-- admin_remove_user stays the same but we recreate it for completeness
CREATE OR REPLACE FUNCTION public.admin_remove_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
$function$;

-- Drop old functions that are no longer needed
DROP FUNCTION IF EXISTS public.bootstrap_first_admin(text, text, text);
DROP FUNCTION IF EXISTS public.admin_create_user(text, text, text, text);
