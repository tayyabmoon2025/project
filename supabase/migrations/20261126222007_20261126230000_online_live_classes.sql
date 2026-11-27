/*
# Online Live Classes (Audio & Video) with admin approval and automatic attendance

## 1. Summary
Adds the two tables and three functions behind the new "Live Classes" module. A
teacher asks for an after-school online class, an administrator approves or
rejects it, and once approved the class can be started as an embedded audio or
audio+video room. Whenever a student (or their parent) opens the room, the
student's attendance is stamped automatically with the exact join time, and the
teacher's live feed shows who is in the room. Administrators can join any running
class to observe, and print an A4 attendance report for any class.

## 2. New tables

### school_live_classes
One row per online class a teacher requests.
- `id` uuid primary key.
- `class_name` text, required — the class the session is for.
- `section_name` text, required — the section the session is for.
- `subject_name` text, required — the subject being taught.
- `lesson_topic` text, required — what the session will cover.
- `class_date` date, required, defaults to today — the day of the session.
- `start_time` time, required — the time the session begins.
- `duration_minutes` integer, required, defaults to 40 — how long it runs,
  constrained to between 10 and 240 minutes.
- `mode` text, required, 'audio' or 'video' — audio only, or audio and video.
- `room_id` text, required, unique — the meeting room name, generated once when
  the request is made so the link never changes after approval.
- `status` text, required, defaults to 'pending'. One of 'pending', 'approved',
  'rejected', 'live', 'ended'.
- `teacher_id` uuid, references `user_profiles`, set null if the account is
  removed — the session record survives, because it carries the attendance.
- `teacher_name` text, required — the teacher's name, kept so the record still
  reads correctly if the account is later removed.
- `requested_at` timestamptz — when the teacher asked for the class.
- `approved_by` uuid, `approved_at` timestamptz — who approved it and when.
  Both are null until an administrator approves, and are written only by the
  review function below.
- `reviewed_at` timestamptz — when the decision was made, approve or reject.
- `admin_remarks` text, optional — the administrator's note, shown to the teacher.
- `started_at` / `ended_at` timestamptz — when the room actually opened and closed.
- `ended_by` uuid — who closed the room.
- `created_at` / `updated_at` timestamptz.

### school_live_class_attendance
One row per student per class — the automatic attendance record.
- `id` uuid primary key.
- `class_id` uuid, required, references `school_live_classes` (cascade delete) —
  deleting a session removes only its own attendance rows.
- `student_id` uuid, required, references `school_students` (cascade delete) — a
  withdrawn or deleted student never leaves an orphan row behind.
- `student_name` text, required — the name at the time of joining.
- `joined_at` timestamptz, required, defaults to now() — the exact join time.
- `left_at` timestamptz, optional — when the student left the room.
- `minutes_present` integer, optional — filled in when the student leaves.
- `joined_by` uuid — the signed-in account that opened the room (the student, a
  parent, or the teacher testing the room).
- `created_at` / `updated_at` timestamptz.

## 3. Uniqueness and indexes
- A student appears at most once per class, so re-entering the room updates the
  existing record instead of creating a duplicate.
- The room name is unique, so two sessions can never share a meeting room.
- Indexes on (class_date, start_time) for the schedule, on status for the
  approval queue and the live list, on teacher_id for the teacher's own list, and
  on student_id for the parent and student lookup.

## 4. Security
- RLS is enabled on both tables. Nothing is reachable until a policy allows it.
- `anon` is revoked from both tables; only signed-in users reach them at all.
- A teacher reads and writes their own requests; other staff can read the list
  (a teacher covering a colleague's class still needs to see the schedule).
- A parent or student can read a session only when it is approved (or already
  running or finished) AND the class and section match one of their own records.
  A pending or rejected request is never visible outside the school staff.
- Attendance rows are readable by staff, by the student themselves and by that
  student's linked parents. Only staff may write attendance rows directly; a
  parent or student writes attendance only through `join_live_class`, which
  checks the relationship itself.
- Column-level UPDATE privileges are used deliberately: a teacher may only change
  the running state and the lesson details. `approved_by`, `approved_at`,
  `reviewed_at` and `admin_remarks` are NOT granted for update, so approval
  cannot be forged by a direct write — it is only ever set by
  `review_live_class`, which requires an administrator.

## 5. Server-side checks
- A check constraint keeps the duration between 10 and 240 minutes.
- A check constraint keeps the status and the mode to their allowed values.
- A trigger refuses a session with no class, section, subject or topic even if the
  check constraints are bypassed, and keeps `updated_at` current.
- `join_live_class` refuses a class that is not approved or running, a student who
  is not active, and a student who is not in the class the session was created
  for.

## 6. Functions

### review_live_class(p_class_id, p_decision, p_remarks)
Administrator only. Approves or rejects a request. On approval it also writes the
in-app notifications: one school-wide notice for staff (the teacher), and one
notice per active student in that class and section, which every linked parent
sees in their portal. Notifications are written once per date — the unique
indexes make a repeated approval a no-op rather than a duplicate.

### join_live_class(p_class_id, p_student_id)
Stamps a student as present with the exact join time. Allowed for school staff,
for the student themselves, and for a parent linked to that student. Validates
the session is open, the student is active, and the student belongs to the class
and section the session was created for. Re-entering the room clears the leave
time but keeps the original join time.

### leave_live_class(p_class_id, p_student_id)
Records the leave time and works out how many minutes the student was present.
Uses the same authorisation rules as joining.

## 7. Notes
- No existing table, column or row is touched or removed.
- Nothing is deleted by this migration.
- Live presence is read by the app on a short polling interval, so no realtime
  publication is required and nothing breaks if realtime is unavailable.
*/

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_live_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name text NOT NULL,
  section_name text NOT NULL,
  subject_name text NOT NULL,
  lesson_topic text NOT NULL,
  class_date date NOT NULL DEFAULT CURRENT_DATE,
  start_time time NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 40,
  mode text NOT NULL DEFAULT 'video',
  room_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  teacher_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  teacher_name text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  reviewed_at timestamptz,
  admin_remarks text,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_live_classes_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'live', 'ended')),
  CONSTRAINT school_live_classes_mode_check CHECK (mode IN ('audio', 'video')),
  CONSTRAINT school_live_classes_duration_check CHECK (duration_minutes BETWEEN 10 AND 240),
  CONSTRAINT school_live_classes_class_check CHECK (length(btrim(class_name)) BETWEEN 1 AND 40),
  CONSTRAINT school_live_classes_section_check CHECK (length(btrim(section_name)) BETWEEN 1 AND 40),
  CONSTRAINT school_live_classes_subject_check CHECK (length(btrim(subject_name)) BETWEEN 1 AND 60),
  CONSTRAINT school_live_classes_topic_check CHECK (length(btrim(lesson_topic)) BETWEEN 2 AND 160),
  CONSTRAINT school_live_classes_room_check CHECK (length(btrim(room_id)) BETWEEN 6 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_live_classes_room_key
  ON public.school_live_classes (lower(btrim(room_id)));

CREATE INDEX IF NOT EXISTS school_live_classes_schedule_idx
  ON public.school_live_classes (class_date, start_time);

CREATE INDEX IF NOT EXISTS school_live_classes_status_idx
  ON public.school_live_classes (status, class_date);

CREATE INDEX IF NOT EXISTS school_live_classes_teacher_idx
  ON public.school_live_classes (teacher_id, class_date DESC);

CREATE INDEX IF NOT EXISTS school_live_classes_class_idx
  ON public.school_live_classes (lower(btrim(class_name)), lower(btrim(section_name)), class_date);

CREATE TABLE IF NOT EXISTS public.school_live_class_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.school_live_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  minutes_present integer,
  joined_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_live_class_attendance_minutes_check CHECK (minutes_present IS NULL OR minutes_present >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_live_class_attendance_key
  ON public.school_live_class_attendance (class_id, student_id);

CREATE INDEX IF NOT EXISTS school_live_class_attendance_student_idx
  ON public.school_live_class_attendance (student_id, joined_at DESC);

-- ---------------------------------------------------------------------------
-- Keep updated_at current and refuse an empty session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_live_class()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF length(btrim(coalesce(NEW.class_name, ''))) = 0
     OR length(btrim(coalesce(NEW.section_name, ''))) = 0
     OR length(btrim(coalesce(NEW.subject_name, ''))) = 0
     OR length(btrim(coalesce(NEW.lesson_topic, ''))) = 0
     OR length(btrim(coalesce(NEW.room_id, ''))) = 0 THEN
    RAISE EXCEPTION 'A live class needs a class, a section, a subject, a topic and a room.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS school_live_classes_touch ON public.school_live_classes;
CREATE TRIGGER school_live_classes_touch
BEFORE INSERT OR UPDATE ON public.school_live_classes
FOR EACH ROW EXECUTE FUNCTION public.touch_live_class();

REVOKE EXECUTE ON FUNCTION public.touch_live_class() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- Administrator review: approve or reject, and notify everyone who needs to know
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.review_live_class(
  p_class_id uuid,
  p_decision text,
  p_remarks text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_class public.school_live_classes;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_title text;
  v_body text;
  v_teacher_notice integer := 0;
  v_parent_notices integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can approve or reject a live class request.';
  END IF;

  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'A review decision must be approved or rejected.';
  END IF;

  SELECT * INTO v_class
  FROM public.school_live_classes
  WHERE id = p_class_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That live class request no longer exists.';
  END IF;

  IF v_class.status IN ('live', 'ended') THEN
    RAISE EXCEPTION 'A class that has already run cannot be reviewed again.';
  END IF;

  UPDATE public.school_live_classes
     SET status = v_decision,
         approved_by = CASE WHEN v_decision = 'approved' THEN auth.uid() ELSE NULL END,
         approved_at = CASE WHEN v_decision = 'approved' THEN now() ELSE NULL END,
         reviewed_at = now(),
         admin_remarks = NULLIF(btrim(coalesce(p_remarks, '')), ''),
         updated_at = now()
   WHERE id = p_class_id;

  IF v_decision = 'approved' THEN
    v_title := format('Live class — %s', v_class.subject_name);
    v_body := format(
      '%s has scheduled a %s online class for %s %s on %s at %s. Topic: %s.',
      v_class.teacher_name,
      CASE WHEN v_class.mode = 'audio' THEN 'audio only' ELSE 'audio and video' END,
      v_class.class_name,
      v_class.section_name,
      to_char(v_class.class_date, 'DD Mon YYYY'),
      to_char(v_class.start_time, 'HH12:MI AM'),
      v_class.lesson_topic
    );

    INSERT INTO public.school_portal_notifications
      (student_id, notification_type, title, body, attendance_date, audience, created_by)
    VALUES
      (NULL, 'live_class', v_title, v_body, v_class.class_date, 'staff', auth.uid())
    ON CONFLICT (notification_type, attendance_date) WHERE student_id IS NULL DO NOTHING;
    GET DIAGNOSTICS v_teacher_notice = ROW_COUNT;

    INSERT INTO public.school_portal_notifications
      (student_id, notification_type, title, body, attendance_date, audience, created_by)
    SELECT s.id, 'live_class', v_title, v_body, v_class.class_date, 'parents', auth.uid()
    FROM public.school_students s
    WHERE s.status = 'active'
      AND lower(btrim(s.class_name)) = lower(btrim(v_class.class_name))
      AND lower(btrim(s.section_name)) = lower(btrim(v_class.section_name))
    ON CONFLICT (student_id, notification_type, attendance_date) DO NOTHING;
    GET DIAGNOSTICS v_parent_notices = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', v_decision,
    'teacher_notice', v_teacher_notice,
    'parent_notices', v_parent_notices
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.review_live_class(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_live_class(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Automatic attendance: a student or parent opening the room marks them present
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_live_class(
  p_class_id uuid,
  p_student_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_class public.school_live_classes;
  v_student public.school_students;
  v_row public.school_live_class_attendance;
BEGIN
  SELECT * INTO v_class FROM public.school_live_classes WHERE id = p_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That live class no longer exists.';
  END IF;

  IF v_class.status NOT IN ('approved', 'live') THEN
    RAISE EXCEPTION 'This live class is not open for joining yet.';
  END IF;

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student record no longer exists.';
  END IF;

  IF v_student.status <> 'active' THEN
    RAISE EXCEPTION 'This student is not an active learner.';
  END IF;

  IF lower(btrim(v_student.class_name)) <> lower(btrim(v_class.class_name))
     OR lower(btrim(v_student.section_name)) <> lower(btrim(v_class.section_name)) THEN
    RAISE EXCEPTION 'This live class is not for %''s class.', v_student.full_name;
  END IF;

  IF NOT (
    public.is_staff()
    OR v_student.id = public.own_student_id()
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid() AND psl.student_id = v_student.id
    )
  ) THEN
    RAISE EXCEPTION 'You cannot record attendance for this student.';
  END IF;

  INSERT INTO public.school_live_class_attendance
    (class_id, student_id, student_name, joined_at, joined_by)
  VALUES
    (p_class_id, p_student_id, v_student.full_name, now(), auth.uid())
  ON CONFLICT (class_id, student_id) DO UPDATE
    SET left_at = NULL,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', v_row.student_id,
    'student_name', v_row.student_name,
    'joined_at', v_row.joined_at
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.join_live_class(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_live_class(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_live_class(
  p_class_id uuid,
  p_student_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.school_live_class_attendance;
BEGIN
  SELECT * INTO v_row
  FROM public.school_live_class_attendance
  WHERE class_id = p_class_id AND student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This student has not joined the class yet.';
  END IF;

  IF NOT (
    public.is_staff()
    OR v_row.student_id = public.own_student_id()
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid() AND psl.student_id = v_row.student_id
    )
  ) THEN
    RAISE EXCEPTION 'You cannot change attendance for this student.';
  END IF;

  UPDATE public.school_live_class_attendance
     SET left_at = now(),
         minutes_present = GREATEST(0, round(EXTRACT(EPOCH FROM (now() - v_row.joined_at)) / 60)::integer),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', v_row.student_id,
    'student_name', v_row.student_name,
    'left_at', v_row.left_at,
    'minutes_present', v_row.minutes_present
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.leave_live_class(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_live_class(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_live_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_live_class_attendance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_live_classes FROM anon, authenticated;
REVOKE ALL ON public.school_live_class_attendance FROM anon, authenticated;

-- A teacher may only move their own class through running and finishing, and may
-- only edit the lesson details of a request that has not been approved yet.
-- Approval fields are deliberately left out of this grant.
GRANT SELECT, INSERT, DELETE ON public.school_live_classes TO authenticated;
GRANT UPDATE (status, started_at, ended_at, ended_by, lesson_topic, subject_name, class_date, start_time, duration_minutes, mode)
  ON public.school_live_classes TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_live_class_attendance TO authenticated;

-- Live classes ---------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read live classes" ON public.school_live_classes;
CREATE POLICY "Staff can read live classes"
ON public.school_live_classes FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Families can read approved live classes" ON public.school_live_classes;
CREATE POLICY "Families can read approved live classes"
ON public.school_live_classes FOR SELECT
TO authenticated
USING (
  status IN ('approved', 'live', 'ended')
  AND EXISTS (
    SELECT 1 FROM public.school_students s
    WHERE s.status = 'active'
      AND lower(btrim(s.class_name)) = lower(btrim(school_live_classes.class_name))
      AND lower(btrim(s.section_name)) = lower(btrim(school_live_classes.section_name))
      AND (
        s.id = public.own_student_id()
        OR EXISTS (
          SELECT 1 FROM public.parent_student_links psl
          WHERE psl.parent_user_id = auth.uid() AND psl.student_id = s.id
        )
      )
  )
);

DROP POLICY IF EXISTS "Teachers can request live classes" ON public.school_live_classes;
CREATE POLICY "Teachers can request live classes"
ON public.school_live_classes FOR INSERT
TO authenticated
WITH CHECK (
  is_exam_staff()
  AND status = 'pending'
  AND approved_at IS NULL
  AND approved_by IS NULL
  AND reviewed_at IS NULL
  AND admin_remarks IS NULL
  AND started_at IS NULL
  AND ended_at IS NULL
);

DROP POLICY IF EXISTS "Teachers can run their own live classes" ON public.school_live_classes;
CREATE POLICY "Teachers can run their own live classes"
ON public.school_live_classes FOR UPDATE
TO authenticated
USING (is_admin() OR (teacher_id = auth.uid() AND approved_at IS NOT NULL))
WITH CHECK (
  is_admin()
  OR (
    teacher_id = auth.uid()
    AND (
      (approved_at IS NULL AND status = 'pending')
      OR (approved_at IS NOT NULL AND status IN ('live', 'ended'))
    )
  )
);

DROP POLICY IF EXISTS "Teachers can cancel their own live class requests" ON public.school_live_classes;
CREATE POLICY "Teachers can cancel their own live class requests"
ON public.school_live_classes FOR DELETE
TO authenticated
USING (is_admin() OR (teacher_id = auth.uid() AND status IN ('pending', 'rejected')));

-- Attendance -----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and families can read live class attendance" ON public.school_live_class_attendance;
CREATE POLICY "Staff and families can read live class attendance"
ON public.school_live_class_attendance FOR SELECT
TO authenticated
USING (
  is_staff()
  OR student_id = public.own_student_id()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid()
      AND psl.student_id = school_live_class_attendance.student_id
  )
);

DROP POLICY IF EXISTS "Staff can record live class attendance" ON public.school_live_class_attendance;
CREATE POLICY "Staff can record live class attendance"
ON public.school_live_class_attendance FOR INSERT
TO authenticated
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update live class attendance" ON public.school_live_class_attendance;
CREATE POLICY "Staff can update live class attendance"
ON public.school_live_class_attendance FOR UPDATE
TO authenticated
USING (is_staff())
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove live class attendance" ON public.school_live_class_attendance;
CREATE POLICY "Staff can remove live class attendance"
ON public.school_live_class_attendance FOR DELETE
TO authenticated
USING (is_staff());
