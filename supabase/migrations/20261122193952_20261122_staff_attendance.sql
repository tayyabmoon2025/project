/*
# Staff daily attendance

## 1. Purpose
The Staff Management screen lists the school's own workforce (teachers, office
assistants, accountants and administrators). Administrators now need to record who
was in school on any given day, the same way student attendance is recorded. This
migration adds the storage for that.

## 2. New table: `school_staff_attendance`
One row per staff member per day.
- `id` (uuid, primary key)
- `staff_user_id` (uuid, not null) — the login this attendance belongs to. It points
  at `public.user_profiles`, and deleting that login removes its attendance history
  (ON DELETE CASCADE), so the table can never hold an orphaned day.
- `attendance_date` (date, not null, defaults to today)
- `status` (text, not null) — one of `present`, `absent`, `late`, `leave`.
  "Late" still counts as a day in school; "On leave" is approved absence.
- `note` (text, nullable) — an optional short reason, e.g. "Sick leave".
- `marked_by` (uuid, nullable) — the administrator who recorded the day.
- `created_at`, `updated_at` (timestamptz, not null, default now())
- A unique key on `(staff_user_id, attendance_date)` guarantees one record per
  person per day, so re-saving a day updates the existing row instead of creating
  duplicates. This is what lets the screen save the whole day in one upsert.
- A check constraint limits `status` to the four allowed values, and another caps
  the note length so a stray paste cannot fill the column.

## 3. Indexes
- `school_staff_attendance_staff_day_key` — unique, on `(staff_user_id, attendance_date)`.
- `school_staff_attendance_day_idx` — on `(attendance_date)`, because the screen
  always loads one whole day at a time.

## 4. Security
- RLS is enabled on the table.
- Read: any active staff member may read attendance (`is_staff()`), and a staff
  member may always read their own rows (`staff_user_id = auth.uid()`).
- Write (insert, update, delete): administrators only (`is_admin()`). Attendance
  decides pay and leave, so it is not self-service — a staff member cannot mark
  themselves present.
- The insert and update policies repeat the allowed status list in their WITH CHECK,
  so a crafted request cannot store an arbitrary status value.
- Four separate policies, one per verb, and no `FOR ALL`.
- Grants: SELECT, INSERT, UPDATE, DELETE to `authenticated` only, matching the roles
  the policies target. The anonymous role is revoked entirely, because this table is
  only ever reached from a signed-in screen. No sequence grant is needed: the key is
  a uuid.

## 5. Notes
- Additive only: one new table with its indexes and policies. No existing table,
  column, row or policy is changed or removed, so nothing already built is affected.
- Safe to re-run: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` and
  `DROP POLICY IF EXISTS` before every `CREATE POLICY`.
*/

CREATE TABLE IF NOT EXISTS public.school_staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL,
  note text,
  marked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_staff_attendance_status_check
    CHECK (status IN ('present', 'absent', 'late', 'leave')),
  CONSTRAINT school_staff_attendance_note_check
    CHECK (note IS NULL OR length(note) <= 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_staff_attendance_staff_day_key
  ON public.school_staff_attendance (staff_user_id, attendance_date);

CREATE INDEX IF NOT EXISTS school_staff_attendance_day_idx
  ON public.school_staff_attendance (attendance_date);

ALTER TABLE public.school_staff_attendance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_staff_attendance FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_staff_attendance TO authenticated;

DROP POLICY IF EXISTS "school_staff_attendance_select_staff" ON public.school_staff_attendance;
CREATE POLICY "school_staff_attendance_select_staff"
ON public.school_staff_attendance FOR SELECT
TO authenticated
USING (public.is_staff() OR staff_user_id = auth.uid());

DROP POLICY IF EXISTS "school_staff_attendance_insert_admin" ON public.school_staff_attendance;
CREATE POLICY "school_staff_attendance_insert_admin"
ON public.school_staff_attendance FOR INSERT
TO authenticated
WITH CHECK (public.is_admin() AND status IN ('present', 'absent', 'late', 'leave'));

DROP POLICY IF EXISTS "school_staff_attendance_update_admin" ON public.school_staff_attendance;
CREATE POLICY "school_staff_attendance_update_admin"
ON public.school_staff_attendance FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin() AND status IN ('present', 'absent', 'late', 'leave'));

DROP POLICY IF EXISTS "school_staff_attendance_delete_admin" ON public.school_staff_attendance;
CREATE POLICY "school_staff_attendance_delete_admin"
ON public.school_staff_attendance FOR DELETE
TO authenticated
USING (public.is_admin());

COMMENT ON TABLE public.school_staff_attendance IS
  'One daily attendance record per staff login. Written by administrators only; readable by any active staff member.';

COMMENT ON COLUMN public.school_staff_attendance.status IS
  'present, absent, late or leave. A late arrival still counts as a day in school; leave is approved absence.';
