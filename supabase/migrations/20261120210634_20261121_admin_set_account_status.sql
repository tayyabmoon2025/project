/*
# Administrator function for switching an account on or off

## 1. Purpose
Suspending an account used to be a direct write to the profile row. Now that ordinary users
may only edit their own name, that write is correctly refused — which means the office needs
a proper way to do it. This adds one administrator-only function for switching an account
between active and suspended.

## 2. New function: `admin_set_account_status(p_user_id, p_status)`
- `p_status` must be `'active'` or `'suspended'`; anything else is refused.
- Refuses to let an administrator suspend their own account, so the school cannot lock
  itself out of the admin panel.
- Refuses to suspend the last remaining active administrator, for the same reason.
- Returns nothing; raises a readable message when it refuses.

## 3. Security
- `SECURITY DEFINER`, and begins with an `is_admin()` check, so only a signed-in
  administrator can call it.
- `EXECUTE` is revoked from the anonymous role.
- Setting an account to `suspended` immediately blocks that person's portal access, because
  `is_admin()` and `is_staff()` both require `status = 'active'`.

## 4. Notes
No table, column, row, or policy is changed.
*/

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_user_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  remaining_admins int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change account status';
  END IF;

  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Account status must be active or suspended';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF p_status = 'suspended' THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot suspend your own account';
    END IF;

    SELECT count(*) INTO remaining_admins
      FROM public.user_profiles
     WHERE role = 'admin' AND status = 'active' AND id <> p_user_id;

    IF EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = p_user_id AND role = 'admin' AND status = 'active'
    ) AND remaining_admins = 0 THEN
      RAISE EXCEPTION 'The last administrator account cannot be suspended';
    END IF;
  END IF;

  UPDATE public.user_profiles SET status = p_status WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;
