/*
# Concession principal approval

1. New Columns on `school_students`
- `concession_approval_status` (text, nullable): the sign-off state for a special
  concession. Values: `pending`, `approved`, `rejected`, or NULL when no approval is
  needed (plain concessions, discounts, write-offs, or no concession at all).
- `concession_approved_by` (text, nullable): the display name of the admin who approved
  or rejected the concession.
- `concession_approved_at` (timestamptz, nullable): when the decision was recorded.

2. New Function
- `set_concession_approval(p_student_id uuid, p_status text, p_approver_name text)`:
  a SECURITY DEFINER RPC that lets an admin approve or reject a pending concession.
  Verifies the caller is an admin via `is_admin()`. Only accepts `approved` or `rejected`.
  Sets `concession_approved_at` to now. Returns the new status text or raises on error.

3. Security
- The function is SECURITY DEFINER so it can write to `school_students` regardless of
  the caller's column grants. Execute is revoked from PUBLIC and anon, granted to
  `authenticated` only, so only signed-in staff can call it. The `is_admin()` check
  inside the function body ensures only admins can actually change the status.
- No new RLS policies needed — the existing student policies already govern reads/writes.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS concession_approval_status text,
  ADD COLUMN IF NOT EXISTS concession_approved_by text,
  ADD COLUMN IF NOT EXISTS concession_approved_at timestamptz;

DROP FUNCTION IF EXISTS public.set_concession_approval(uuid, text, text);
CREATE FUNCTION public.set_concession_approval(p_student_id uuid, p_status text, p_approver_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can approve or reject a concession.';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Status must be approved or rejected.';
  END IF;
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'A student must be selected.';
  END IF;

  UPDATE public.school_students
    SET concession_approval_status = p_status,
        concession_approved_by = NULLIF(BTRIM(COALESCE(p_approver_name, '')), ''),
        concession_approved_at = NOW()
    WHERE id = p_student_id
    RETURNING concession_approval_status INTO result_status;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'That student was not found.';
  END IF;

  RETURN result_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_concession_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_concession_approval(uuid, text, text) TO authenticated;
