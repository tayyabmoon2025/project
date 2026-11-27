/*
# Fee reminder portal notifications

## Purpose
When staff click "Send reminder" for a student with outstanding fees, a fee reminder
notification should appear in BOTH the Parent Portal and the Student Portal showing the
student name, class, due amount, and reminder date. Re-sending on the same day must not
create a duplicate — it should update the existing notification.

## Changes
1. New SECURITY DEFINER function `create_fee_reminder_notification(p_student_id, p_due_amount, p_reminder_date)`:
   - Looks up the student's name and class from `school_students`.
   - Builds a title and body for the notification.
   - Inserts into `school_portal_notifications` with `notification_type = 'fee_reminder'`
     and `attendance_date = p_reminder_date`.
   - Uses the existing unique index `school_portal_notifications_student_day_key` on
     `(student_id, notification_type, attendance_date)` via `ON CONFLICT ... DO UPDATE`
     so re-sending on the same day updates the existing row instead of duplicating.
   - Returns the notification id.
2. Security:
   - SECURITY DEFINER, `SET search_path = 'public'`.
   - Checks `is_fee_staff()` so only authorized staff can create reminders.
   - `REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;`.
3. No new tables, no column changes. The existing `school_portal_notifications` table
   and its unique index are reused.

## Important notes
- The `attendance_date` column is reused as the "reminder date" for fee reminders,
  matching the existing pattern where absentee alerts store their date in the same column.
- The unique index on `(student_id, notification_type, attendance_date)` guarantees
  idempotency: sending the same reminder twice on the same day produces one row.
*/

CREATE OR REPLACE FUNCTION public.create_fee_reminder_notification(
  p_student_id uuid,
  p_due_amount numeric,
  p_reminder_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_student public.school_students%ROWTYPE;
  v_date date;
  v_title text;
  v_body text;
  v_notification_id uuid;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  v_date := coalesce(p_reminder_date, CURRENT_DATE);

  v_title := 'Fee reminder — ' || to_char(v_date, 'DD Mon YYYY');
  v_body := format(
    'Dear Parent, the fee account for %s (%s · Section %s) has an outstanding balance of Rs %s. Kindly clear the dues at the school office at your earliest convenience. Thank you.',
    v_student.full_name,
    v_student.class_name,
    v_student.section_name,
    to_char(p_due_amount, 'FM999,999,999')
  );

  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, created_by
  )
  VALUES (
    p_student_id, 'fee_reminder', v_title, v_body, v_date, auth.uid()
  )
  ON CONFLICT (student_id, notification_type, attendance_date)
  DO UPDATE SET
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    created_by = EXCLUDED.created_by,
    created_at = now()
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_fee_reminder_notification(uuid, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fee_reminder_notification(uuid, numeric, date) TO authenticated;
