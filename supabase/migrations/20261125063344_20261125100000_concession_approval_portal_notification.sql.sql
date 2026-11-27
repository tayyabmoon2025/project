/*
# Notify parent portal when a concession is approved or rejected

## Purpose
When the principal approves or rejects a concession (scholarship, orphan,
staff-child) from the Concession Approvals panel, the parent and student
portals should receive an automatic notification so the family knows the
decision right away — without anyone having to send a separate message.

## Changes
1. **Replaces** the `set_concession_approval` SECURITY DEFINER function so
   that after it updates `school_students`, it also inserts a row into
   `school_portal_notifications`:
   - `notification_type` = `'concession_approval'`
   - `title` = `"Concession approved"` or `"Concession rejected"` + student name
   - `body` = a short message naming the student, the category, the approver,
     and (for rejections) the reason.
   - `attendance_date` = `CURRENT_DATE` (used by the dedup index
     `school_portal_notifications_student_day_key` so re-approving the same
     student on the same day updates the existing notification instead of
     creating duplicates).
   - `created_by` = `auth.uid()` (the admin who made the decision).

2. The function reads the student's `full_name`, `class_name`,
   `section_name`, and `fee_concession_category` from `school_students` to
   build the notification text, so the caller does not need to pass them.

## Security
- The function remains `SECURITY DEFINER` with `search_path = 'public'`.
- The admin check (`is_admin()`) is unchanged — only admins can call it.
- `REVOKE EXECUTE` from `PUBLIC` and `anon` is preserved so only
  `authenticated` users can call it.
- No new tables, no RLS policy changes. The `school_portal_notifications`
  table already has RLS, policies, and grants that allow authenticated
  users to read notifications for their own students.

## Important notes
1. The `school_portal_notifications_student_day_key` unique index on
   `(student_id, notification_type, attendance_date)` prevents duplicate
   notifications per day. Re-running the approval on the same day updates
   the existing notification row (ON CONFLICT DO UPDATE).
2. A rejection notification includes the rejection reason in the body.
3. The `attendance_date` column is repurposed here as a dedup date key
   (same pattern used by fee reminder notifications).
*/

CREATE OR REPLACE FUNCTION public.set_concession_approval(
  p_student_id uuid,
  p_status text,
  p_approver_name text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result_status text;
  v_student public.school_students%ROWTYPE;
  v_category_label text;
  v_title text;
  v_body text;
  v_approver text;
  v_reason text;
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

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student was not found.';
  END IF;

  v_approver := NULLIF(BTRIM(COALESCE(p_approver_name, '')), '');
  v_reason := NULLIF(BTRIM(COALESCE(p_rejection_reason, '')), '');

  -- Map the stored category key to a readable label for the notification body.
  v_category_label := CASE v_student.fee_concession_category
    WHEN 'orphan' THEN 'orphan concession'
    WHEN 'scholarship' THEN 'scholarship'
    WHEN 'staff' THEN 'staff-child concession'
    ELSE COALESCE(v_student.fee_concession_category, 'concession')
  END;

  UPDATE public.school_students
  SET concession_approval_status = p_status,
      concession_approved_by = v_approver,
      concession_approved_at = NOW(),
      concession_rejection_reason = CASE
        WHEN p_status = 'rejected' THEN v_reason
        ELSE NULL
      END
  WHERE id = p_student_id
  RETURNING concession_approval_status INTO result_status;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'That student was not found.';
  END IF;

  -- Build the portal notification so the parent and student see the decision.
  IF p_status = 'approved' THEN
    v_title := 'Concession approved — ' || v_student.full_name;
    v_body := format(
      'The %s for %s (%s · Section %s) has been approved%s. The concession will now be applied to the monthly fee.',
      v_category_label,
      v_student.full_name,
      v_student.class_name,
      v_student.section_name,
      CASE WHEN v_approver IS NOT NULL THEN ' by ' || v_approver ELSE '' END
    );
  ELSE
    v_title := 'Concession rejected — ' || v_student.full_name;
    v_body := format(
      'The %s for %s (%s · Section %s) has been rejected%s. The concession will not be applied to the monthly fee.',
      v_category_label,
      v_student.full_name,
      v_student.class_name,
      v_student.section_name,
      CASE WHEN v_approver IS NOT NULL THEN ' by ' || v_approver ELSE '' END
    );
    IF v_reason IS NOT NULL THEN
      v_body := v_body || chr(10) || 'Reason: ' || v_reason;
    END IF;
  END IF;

  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, created_by
  )
  VALUES (
    p_student_id, 'concession_approval', v_title, v_body, CURRENT_DATE, auth.uid()
  )
  ON CONFLICT (student_id, notification_type, attendance_date)
  DO UPDATE SET
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    created_by = EXCLUDED.created_by,
    created_at = now();

  RETURN result_status;
END;
$function$;

-- The function is SECURITY DEFINER and callable by every role by default.
-- Restrict it so only authenticated users (the admin) can call it.
REVOKE EXECUTE ON FUNCTION public.set_concession_approval(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_concession_approval(uuid, text, text, text) TO authenticated;
