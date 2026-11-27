/*
# Concession rejection reason

1. New Column on `school_students`
- `concession_rejection_reason` (text, nullable): when an admin rejects a special
  concession (orphan, scholarship, staff), the reason they entered is stored here.
  NULL when the concession is approved or pending, or when no approval is needed.

2. Modified Function
- `set_concession_approval` gains a 4th parameter `p_rejection_reason text`.
  When the status is `rejected`, the reason is stored on the student record. When
  the status is `approved`, the reason is cleared (set to NULL). An empty or NULL
  reason on a rejection is accepted — the prompt is in the UI, not the database —
  but the column is always cleared on an approval so a stale reason from an
  earlier rejection does not survive a later approval.

3. Security
- The function signature changes, so the existing EXECUTE grants are re-applied:
  REVOKE FROM PUBLIC, anon; GRANT TO authenticated. The `is_admin()` check inside
  the function body is unchanged. No new RLS policies — existing student policies
  already govern reads/writes.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS concession_rejection_reason text;

DROP FUNCTION IF EXISTS public.set_concession_approval(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_concession_approval(uuid, text, text, text);
CREATE FUNCTION public.set_concession_approval(
  p_student_id uuid,
  p_status text,
  p_approver_name text,
  p_rejection_reason text DEFAULT NULL
)
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
        concession_approved_at = NOW(),
        concession_rejection_reason = CASE
          WHEN p_status = 'rejected' THEN NULLIF(BTRIM(COALESCE(p_rejection_reason, '')), '')
          ELSE NULL
        END
    WHERE id = p_student_id
    RETURNING concession_approval_status INTO result_status;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'That student was not found.';
  END IF;

  RETURN result_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_concession_approval(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_concession_approval(uuid, text, text, text) TO authenticated;
