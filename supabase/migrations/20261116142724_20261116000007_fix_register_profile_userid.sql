/*
# Fix admin_register_profile to accept user_id parameter

## Problem
The previous admin_register_profile used auth.uid() to get the new user's id,
but the caller is the admin (not the new user), so auth.uid() returns the admin's id.

## Fix
Change admin_register_profile to accept p_user_id as a parameter. The admin passes
the new user's id (returned from signUp). The function checks is_admin() on the
caller (admin's session) and inserts the profile for p_user_id.
*/

CREATE OR REPLACE FUNCTION public.admin_register_profile(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_role text
)
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
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id;
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
  VALUES (p_user_id, lower(p_username), p_full_name, p_role, 'active');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_register_profile(uuid, text, text, text) TO authenticated;

-- Also update set_initial_admin to accept p_user_id
CREATE OR REPLACE FUNCTION public.set_initial_admin(p_user_id uuid, p_username text, p_full_name text)
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

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (p_user_id, lower(p_username), p_full_name, 'admin', 'active');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_initial_admin(uuid, text, text) TO authenticated;
