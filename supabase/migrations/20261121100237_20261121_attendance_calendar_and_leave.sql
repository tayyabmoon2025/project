/*
# Attendance calendar: approved leave, working-day policy, holidays and special working days

## 1. Purpose
The school needs to describe its own calendar so attendance percentages are calculated
against the days the school actually opens. This migration adds:

- An "Approved leave" attendance mark, so a student away with permission is recorded
  properly instead of being lumped in with unexplained absences.
- A settings row holding the school's working-day policy.
- A list of days the school is closed (holidays, vacations, exam days) and days it opens
  outside the normal schedule (special working days).

## 2. Attendance marks: new "leave" value
`school_attendance.status` may now be `present`, `absent`, `late` or `leave`.
The older `excused` value is retired and any existing `excused` records become `leave`, so
no attendance history is lost and no record becomes invalid.

## 3. New table: `school_calendar_policy` (one row)
The school's working-week policy. Exactly one row, identified by `id = 'default'`.
- `working_days` (int array, default all seven days 0=Sunday … 6=Saturday) — which
  weekdays the school counts as working days.
- `low_attendance_threshold` (numeric, default 75.0) — the percentage below which a
  student is highlighted as a low-attendance concern.
- `exclude_leave_from_denominator` (boolean, default false) — when on, days a student was
  on approved leave are removed from the attendance total, so approved absence does not
  lower their percentage.
- `updated_at`, `updated_by` — who last changed the policy and when.

## 4. New table: `school_calendar_days`
The school's calendar exceptions. One row per date.
- `day_date` (date, unique) — the day the entry applies to.
- `day_type` — `holiday`, `vacation`, `exam` (all days the school is closed) or
  `special_working` (a day the school opens outside the normal week).
- `title`, `notes` — the name shown to staff, e.g. "Independence Day".
- `created_at`, `created_by`.

## 5. Security
- Row level security is enabled on both new tables.
- Both tables are readable by every signed-in user, so students and parents can see the
  school calendar.
- Only staff (`is_staff()`: admin, teacher, office assistant, accountant) may add, change
  or remove calendar days, and only administrators may change the working-day policy.
- Four separate policies per table (one per verb); no `FOR ALL`.
- Table and column grants are issued in the same migration as the tables.

## 6. Notes
- No table or column is dropped or retyped, and no rows are deleted.
- Existing attendance records are untouched apart from the `excused` → `leave` rename.
*/

-- ---------------------------------------------------------------------------
-- 1. Allow "leave" as an attendance mark
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_attendance DROP CONSTRAINT IF EXISTS school_attendance_status_check;

UPDATE public.school_attendance SET status = 'leave' WHERE status = 'excused';

ALTER TABLE public.school_attendance
  ADD CONSTRAINT school_attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'leave'));

-- ---------------------------------------------------------------------------
-- 2. Working-day policy (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_calendar_policy (
  id text PRIMARY KEY DEFAULT 'default',
  working_days int[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  low_attendance_threshold numeric(5,1) NOT NULL DEFAULT 75.0,
  exclude_leave_from_denominator boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT school_calendar_policy_single_row CHECK (id = 'default'),
  CONSTRAINT school_calendar_policy_threshold_range CHECK (low_attendance_threshold >= 0 AND low_attendance_threshold <= 100)
);

INSERT INTO public.school_calendar_policy (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.school_calendar_policy ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_calendar_policy FROM anon;
GRANT SELECT ON public.school_calendar_policy TO authenticated;
GRANT UPDATE (working_days, low_attendance_threshold, exclude_leave_from_denominator, updated_at, updated_by)
  ON public.school_calendar_policy TO authenticated;

DROP POLICY IF EXISTS "Signed-in users can read the calendar policy" ON public.school_calendar_policy;
CREATE POLICY "Signed-in users can read the calendar policy"
ON public.school_calendar_policy FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can update the calendar policy" ON public.school_calendar_policy;
CREATE POLICY "Admins can update the calendar policy"
ON public.school_calendar_policy FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- 3. Calendar exceptions: holidays, vacations, exams, special working days
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_calendar_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_date date NOT NULL,
  day_type text NOT NULL,
  title text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT school_calendar_days_type_check CHECK (day_type IN ('holiday', 'vacation', 'exam', 'special_working'))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_calendar_days_date_key ON public.school_calendar_days (day_date);
CREATE INDEX IF NOT EXISTS school_calendar_days_type_idx ON public.school_calendar_days (day_type);

ALTER TABLE public.school_calendar_days ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_calendar_days FROM anon;
GRANT SELECT, INSERT, DELETE ON public.school_calendar_days TO authenticated;
GRANT UPDATE (day_date, day_type, title, notes) ON public.school_calendar_days TO authenticated;

DROP POLICY IF EXISTS "Signed-in users can read the school calendar" ON public.school_calendar_days;
CREATE POLICY "Signed-in users can read the school calendar"
ON public.school_calendar_days FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Staff can add calendar days" ON public.school_calendar_days;
CREATE POLICY "Staff can add calendar days"
ON public.school_calendar_days FOR INSERT
TO authenticated
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update calendar days" ON public.school_calendar_days;
CREATE POLICY "Staff can update calendar days"
ON public.school_calendar_days FOR UPDATE
TO authenticated
USING (is_staff())
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove calendar days" ON public.school_calendar_days;
CREATE POLICY "Staff can remove calendar days"
ON public.school_calendar_days FOR DELETE
TO authenticated
USING (is_staff());
