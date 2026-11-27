/*
# Attendance alerts for Absent, Leave and Late

## 1. Purpose
Daily Attendance can mark a student Present, Absent, Late or Leave. Until now only
Absent students produced a WhatsApp alert and a parent portal notice. This migration
extends the same workflow to Leave and Late, each with its own wording.

## 2. New Columns
- `school_absentee_queue.attendance_status` (text, NOT NULL, default 'absent')
  — which register mark raised the alert: 'absent', 'leave' or 'late'.
  Every existing row is an absence, so the default keeps old rows correct.

## 3. Modified Constraints
- `school_notice_templates.notice_type` now also allows `leave_alert` and
  `late_alert`, so each status keeps its own English and Urdu wording.
  The existing `absentee_alert` type continues to hold the Absent wording.
- `school_absentee_queue` gains a check that `attendance_status` is one of
  'absent', 'leave', 'late'.

## 4. New Template Rows (only inserted when missing)
- `leave_alert` in English and Urdu.
- `late_alert` in English and Urdu.
Existing wording is never overwritten: the insert is skipped when a row for that
notice type and language already exists, so a school's own edits survive.

## 5. Modified Behaviour
- `notify_parent_of_absence()` is replaced. It now reads the new
  `attendance_status` and raises the matching parent portal notice:
  - absent  → type 'absence', title 'Absence recorded'
  - leave   → type 'leave',   title 'Leave recorded'
  - late    → type 'late',    title 'Late arrival recorded'
  The attachment link continues to be carried onto the notice. The unique guard
  (student, notice type, date) still prevents duplicate notices for one day.

## 6. Security
- RLS stays enabled on all tables. No policy is added, removed or loosened, and no
  grant changes: the new column and rows inherit the existing table policies.
- `notify_parent_of_absence()` keeps SECURITY DEFINER, its fixed search_path, and
  its EXECUTE revocation from PUBLIC, anon and authenticated.
*/

-- 1. Status column on the alert queue ------------------------------------------
ALTER TABLE public.school_absentee_queue
  ADD COLUMN IF NOT EXISTS attendance_status text NOT NULL DEFAULT 'absent';

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.school_absentee_queue'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%attendance_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_absentee_queue DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.school_absentee_queue
  ADD CONSTRAINT school_absentee_queue_attendance_status_check
  CHECK (attendance_status IN ('absent', 'leave', 'late'));

-- 2. Allow the two new notice template types -----------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.school_notice_templates'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%notice_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_notice_templates DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.school_notice_templates
  ADD CONSTRAINT school_notice_templates_notice_type_check
  CHECK (notice_type IN ('fee_clearance_reminder', 'warning_notice', 'absentee_alert', 'leave_alert', 'late_alert'));

-- 3. Seed the Leave and Late wording (skipped when the school already has it) ---
INSERT INTO public.school_notice_templates (notice_type, language, template_text, updated_at)
SELECT 'leave_alert', 'English',
  'Dear Parent or Guardian, {student_name} of {class} was on approved leave on {date} at {school_name}. Please contact the school office if this was not expected.',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_notice_templates
  WHERE notice_type = 'leave_alert' AND language = 'English'
);

INSERT INTO public.school_notice_templates (notice_type, language, template_text, updated_at)
SELECT 'leave_alert', 'Urdu',
  'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں رخصت پر تھے۔ اگر یہ غیر متوقع تھا تو براہِ کرم اسکول دفتر سے رابطہ کریں۔',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_notice_templates
  WHERE notice_type = 'leave_alert' AND language = 'Urdu'
);

INSERT INTO public.school_notice_templates (notice_type, language, template_text, updated_at)
SELECT 'late_alert', 'English',
  'Dear Parent or Guardian, {student_name} of {class} arrived late on {date} at {school_name}. Please make sure your child reaches school on time.',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_notice_templates
  WHERE notice_type = 'late_alert' AND language = 'English'
);

INSERT INTO public.school_notice_templates (notice_type, language, template_text, updated_at)
SELECT 'late_alert', 'Urdu',
  'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں دیر سے پہنچے۔ براہِ کرم اپنے بچے کو وقت پر اسکول بھیجیں۔',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.school_notice_templates
  WHERE notice_type = 'late_alert' AND language = 'Urdu'
);

-- 4. Portal notice follows the register mark ------------------------------------
CREATE OR REPLACE FUNCTION public.notify_parent_of_absence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text;
  v_title text;
  v_phrase text;
BEGIN
  IF NEW.attendance_status = 'leave' THEN
    v_type := 'leave';
    v_title := 'Leave recorded';
    v_phrase := 'was on approved leave on';
  ELSIF NEW.attendance_status = 'late' THEN
    v_type := 'late';
    v_title := 'Late arrival recorded';
    v_phrase := 'arrived late on';
  ELSE
    v_type := 'absence';
    v_title := 'Absence recorded';
    v_phrase := 'was marked absent on';
  END IF;

  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, attachment_url, created_by
  )
  VALUES (
    NEW.student_id,
    v_type,
    v_title,
    format(
      '%s of %s %s %s.%s',
      NEW.student_name,
      coalesce(nullif(trim(NEW.class_name || ' · Section ' || coalesce(NEW.section_name, '')), ' · Section '), 'the school'),
      v_phrase,
      to_char(NEW.attendance_date, 'DD Mon YYYY'),
      CASE WHEN NEW.message_body IS NULL OR btrim(NEW.message_body) = '' THEN '' ELSE ' ' || NEW.message_body END
    ),
    NEW.attendance_date,
    NEW.attachment_url,
    NEW.created_by
  )
  ON CONFLICT (student_id, notification_type, attendance_date) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS school_absentee_queue_notify_parent ON public.school_absentee_queue;
CREATE TRIGGER school_absentee_queue_notify_parent
AFTER INSERT ON public.school_absentee_queue
FOR EACH ROW EXECUTE FUNCTION public.notify_parent_of_absence();

REVOKE EXECUTE ON FUNCTION public.notify_parent_of_absence() FROM PUBLIC, anon, authenticated;
