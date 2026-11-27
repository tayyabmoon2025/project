/*
# School-wide holiday notices and the 1-day prior alert

1. Purpose
- The school calendar already lives in `school_calendar_days` and drives Daily Attendance.
  This migration lets the app also raise ONE school-wide notice the day before a holiday,
  so administrators, teachers, the accountant and parents are all told in advance.
- Portal notices (`school_portal_notifications`) were previously always tied to a single
  student. A holiday notice is for everybody, so a notice may now be addressed to the whole
  school instead of one child.

2. Modified table: `school_portal_notifications`
- `student_id` — was NOT NULL, is now NULLABLE. A NULL means "this notice is for the whole
  school, not one student".
- `audience` — NEW nullable text column. Who the school-wide notice is for:
  `all`, `staff`, `parents` or `students`. NULL means the notice is a normal per-student
  notice. Existing rows keep NULL, so nothing about them changes.
- A CHECK constraint limits `audience` to those four words (or NULL).
- NEW partial unique index `school_portal_notifications_broadcast_day_key` on
  `(notification_type, attendance_date)` where `student_id IS NULL`. This is what makes a
  holiday notice "once per date": sending it again on the same day updates nothing and
  creates no duplicate. The existing per-student index is untouched, and because a NULL
  `student_id` never collides in that index, both kinds of notice coexist.

3. Security
- Row level security stays enabled. No existing policy is removed.
- NEW read policy `Signed-in users can read school-wide notices`: any signed-in account may
  read rows where `student_id IS NULL`. The existing policies (staff read everything,
  parents and students read their own child's rows) are unchanged, so a parent still cannot
  read another child's absence notice.
- `GRANT UPDATE (audience)` is added for `authenticated`, because the column-level update
  grant on the table does not cover a column added later.
- NEW function `publish_holiday_notice(holiday_date, title, body, audience)`:
  SECURITY DEFINER, so the write is performed by the database owner rather than by the
  caller. It refuses to run unless the caller is active school staff, refuses an unknown
  audience, and refuses a missing date. It is REVOKEd from PUBLIC and anon and granted only
  to `authenticated`; the staff check inside the function is what actually decides.

4. Notes
- No table is dropped, no column is dropped or retyped, and no rows are deleted.
- Safe to re-run: every statement is guarded or dropped before being created.
*/

-- ---------------------------------------------------------------------------
-- 1. A notice can be for the whole school, not only one student
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_portal_notifications
  ALTER COLUMN student_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_portal_notifications'
      AND column_name = 'audience'
  ) THEN
    ALTER TABLE public.school_portal_notifications ADD COLUMN audience text;
  END IF;
END $$;

ALTER TABLE public.school_portal_notifications
  DROP CONSTRAINT IF EXISTS school_portal_notifications_audience_check;
ALTER TABLE public.school_portal_notifications
  ADD CONSTRAINT school_portal_notifications_audience_check
  CHECK (audience IS NULL OR audience IN ('all', 'staff', 'parents', 'students'));

-- One school-wide notice per notice type per date. A NULL student_id never collides in
-- the per-student index, so this partial index is what enforces "once per date" for
-- notices that are addressed to everybody.
CREATE UNIQUE INDEX IF NOT EXISTS school_portal_notifications_broadcast_day_key
  ON public.school_portal_notifications (notification_type, attendance_date)
  WHERE student_id IS NULL;

GRANT UPDATE (audience) ON public.school_portal_notifications TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Every signed-in account can read the school-wide notices
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Signed-in users can read school-wide notices" ON public.school_portal_notifications;
CREATE POLICY "Signed-in users can read school-wide notices"
ON public.school_portal_notifications FOR SELECT
TO authenticated
USING (student_id IS NULL);

-- ---------------------------------------------------------------------------
-- 3. Publishing a holiday notice — once per date, staff only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_holiday_notice(
  p_holiday_date date,
  p_title text,
  p_body text,
  p_audience text DEFAULT 'all'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_audience text := COALESCE(NULLIF(TRIM(p_audience), ''), 'all');
  v_title text := COALESCE(NULLIF(TRIM(p_title), ''), 'School holiday');
  v_body text := COALESCE(NULLIF(TRIM(p_body), ''), 'The school will remain closed.');
  v_inserted integer := 0;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only school staff can publish a holiday notice.';
  END IF;

  IF p_holiday_date IS NULL THEN
    RAISE EXCEPTION 'A holiday notice needs a date.';
  END IF;

  IF v_audience NOT IN ('all', 'staff', 'parents', 'students') THEN
    RAISE EXCEPTION 'Unknown audience: %', v_audience;
  END IF;

  INSERT INTO public.school_portal_notifications
    (student_id, notification_type, title, body, attendance_date, audience, created_by)
  VALUES
    (NULL, 'holiday', v_title, v_body, p_holiday_date, v_audience, auth.uid())
  ON CONFLICT (notification_type, attendance_date) WHERE student_id IS NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.publish_holiday_notice(date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_holiday_notice(date, text, text, text) TO authenticated;
