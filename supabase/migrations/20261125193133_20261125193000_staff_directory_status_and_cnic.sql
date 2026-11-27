/*
# Staff directory: more account statuses and a staff CNIC

## Purpose
The Staff directory screen gains Active / Inactive sub-tabs, a status toggle in the search
bar, and a search that works across name, staff ID, username, CNIC, phone number and role.
Two things were missing in the database for that: the status column only allowed "active"
and "suspended" (so a staff member who has left could not be recorded), and there was no
place to store a staff CNIC at all.

## 1. New columns
- `user_profiles.cnic` (text, nullable) — the staff member's 13-digit national identity
  number, stored as digits only so it can be searched and compared reliably. NULL means
  "not recorded yet". Parents and students do not use this column; their CNIC lives on the
  student record.

## 2. Modified constraints
- `user_profiles_status_check` is replaced so an account status may be one of:
  - `active`    — working, can sign in
  - `suspended` — temporarily blocked, kept for the existing suspend/reactivate button
  - `inactive`  — not working, record kept
  - `left`      — has left the school, record kept
  Every existing row already holds `active`, so the new check accepts all current data.

## 3. Security
- RLS stays on and unchanged: the existing SELECT policy already limits staff rows to the
  signed-in user's own row or an administrator, so a CNIC is only visible to administrators
  and to the person it belongs to.
- Column-level SELECT grant added for `user_profiles.cnic` to `authenticated`; without it a
  select that names the column fails with 42501.
- No new write grant: like `date_of_birth`, the CNIC is written only through a
  SECURITY DEFINER function, so a signed-in user cannot edit their own or anyone else's.

## 4. New and changed functions
- `admin_set_staff_cnic(p_user_id uuid, p_cnic text)` (new, SECURITY DEFINER) — administrators
  only. Stores the CNIC as digits, refuses anything that is not 13 digits, refuses parent and
  student accounts, and clears the value when given an empty string. Returns the saved value.
- `admin_set_account_status(p_user_id uuid, p_status text)` (replaced) — now accepts the four
  statuses above. The two existing safety rules are unchanged and now cover every non-active
  status: an administrator cannot change their own status away from active, and the last
  remaining active administrator cannot be moved off active. The original error wording is
  kept so the screen's messages continue to work.

## 5. Notes
- `admin_set_staff_cnic` is revoked from PUBLIC and anon and granted to authenticated only;
  the administrator check inside the function is what actually authorises the change.
- No data is deleted or rewritten by this migration.
*/

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS cnic text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_status_check'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles DROP CONSTRAINT user_profiles_status_check;
  END IF;

  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_status_check
    CHECK (status IN ('active', 'suspended', 'inactive', 'left'));
END $$;

GRANT SELECT (cnic) ON public.user_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  remaining_admins int;
  target_role text;
  target_status text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change account status';
  END IF;

  IF p_status NOT IN ('active', 'suspended', 'inactive', 'left') THEN
    RAISE EXCEPTION 'Account status must be active, suspended, inactive or left';
  END IF;

  SELECT role, status INTO target_role, target_status
  FROM public.user_profiles WHERE id = p_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF p_status <> 'active' THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot suspend your own account';
    END IF;

    IF target_role = 'admin' AND target_status = 'active' THEN
      SELECT count(*) INTO remaining_admins
      FROM public.user_profiles
      WHERE role = 'admin' AND status = 'active' AND id <> p_user_id;

      IF remaining_admins = 0 THEN
        RAISE EXCEPTION 'The last administrator account cannot be suspended';
      END IF;
    END IF;
  END IF;

  UPDATE public.user_profiles SET status = p_status WHERE id = p_user_id;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_cnic(p_user_id uuid, p_cnic text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role text;
  v_cnic text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change staff CNIC';
  END IF;

  SELECT role INTO v_role FROM public.user_profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF v_role IN ('parent', 'student') THEN
    RAISE EXCEPTION 'That account type is not allowed';
  END IF;

  v_cnic := nullif(regexp_replace(coalesce(p_cnic, ''), '[^0-9]', '', 'g'), '');

  IF v_cnic IS NOT NULL AND length(v_cnic) <> 13 THEN
    RAISE EXCEPTION 'A CNIC must be exactly 13 digits';
  END IF;

  UPDATE public.user_profiles SET cnic = v_cnic WHERE id = p_user_id;

  RETURN jsonb_build_object('user_id', p_user_id, 'cnic', v_cnic);
END $function$;

REVOKE EXECUTE ON FUNCTION public.admin_set_staff_cnic(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_cnic(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;
