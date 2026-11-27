/*
# Add Office Assistant and Accountant roles

1. Purpose
- Widen the allowed values on user_profiles.role so the school can create
  accounts with the new "Office Assistant" and "Accountant" staff roles.
- Update the admin_register_profile account-creation function so admins can
  actually create accounts with these roles through the admin panel.

2. Changes
- user_profiles.role CHECK constraint now accepts 'office_assistant' and
  'accountant' in addition to 'admin', 'teacher', and 'parent'.
- admin_register_profile(p_user_id, p_username, p_full_name, p_role) now
  accepts the two new role values.

3. Security
- No policy or grant changes. Existing authenticated-only policies apply.
*/

-- 1. Widen the role CHECK constraint on user_profiles
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'CHECK'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'user_profiles'
      AND ccu.column_name = 'role'
  LOOP
    EXECUTE 'ALTER TABLE public.user_profiles DROP CONSTRAINT ' || quote_ident(cname);
  END LOOP;
END $$;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant'));

-- 2. Update account creation to accept the new roles
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

  IF p_role NOT IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  IF length(p_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Profile already exists for this user';
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE username = lower(p_username);
  IF FOUND THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO public.user_profiles (id, username, full_name, role, status)
  VALUES (p_user_id, lower(p_username), p_full_name, p_role, 'active');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_register_profile(uuid, text, text, text) TO authenticated;
