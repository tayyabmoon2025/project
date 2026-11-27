/*
# Homework publish notifications — alert guardians the moment homework is published

## 1. Summary
When a teacher publishes a homework assignment to a class and section, every
guardian of an active student in that class now receives two things automatically:

1. A notice in the parent and student portal, so the family sees the new homework
   the same day it is set.
2. A row in a new WhatsApp alert list, so the school office can confirm and send a
   WhatsApp message to each guardian from the existing local WhatsApp flow.

Nothing is sent by the database itself: the database prepares the wording and the
list, and the office confirms the send from the Homework screen. This mirrors how
absentee alerts already work.

## 2. New table

### school_homework_alerts
One row per student per published assignment — the WhatsApp alert list.
- `id` uuid primary key.
- `homework_id` uuid, required, references `school_homework` (cascade delete) —
  removing an assignment removes only its own alert rows.
- `student_id` uuid, required, references `school_students` (cascade delete).
- `student_name` text, required — kept so the list still reads correctly later.
- `class_name` / `section_name` text — the class the work was set for.
- `parent_phone` text — the number as it will be dialled, already normalised to
  the `92…` form. Null when the student has no usable contact number.
- `homework_date` date, required — the day the work was set.
- `language` text, required, 'English' or 'Urdu' — the wording that was rendered.
- `message_body` text — the finished WhatsApp message.
- `attachment_url` text — the assignment's own link, when it has one.
- `status` text, required, 'queued' or 'sent', defaults to 'queued'.
- `sent_at` timestamptz — stamped when the office records the send.
- `created_by` uuid — the teacher who published it.
- `created_at` timestamptz.

## 3. Modified tables
- `school_portal_notifications` gains `homework_id` uuid (nullable), referencing
  `school_homework` with ON DELETE SET NULL. It records which assignment a notice
  came from. Existing rows are untouched and keep a null value.
- `school_notice_templates.notice_type` now also accepts `homework_alert`, and
  starter English and Urdu wording is seeded for it.
- `school_sms_log.message_type` now also accepts `homework_alert`, so homework
  messages appear in the WhatsApp SMS report like every other alert.

## 4. How one notice per assignment is kept apart from other notices
`school_portal_notifications` already has a unique index on
`(student_id, notification_type, attendance_date)` which allows only one absence
notice per student per day. Publishing two subjects on the same day must not
collide with it, and that index must not be changed because the absence and fee
notices rely on it exactly as it is.

So homework notices are stored with:
- `notification_type` = `'homework'`,
- `attendance_date` = NULL (so the day index never matches them),
- `homework_id` = the assignment.

A new partial unique index on `(student_id, notification_type, homework_id)` where
`homework_id IS NOT NULL` then guarantees exactly one notice per student per
assignment, and re-publishing the same assignment never creates a duplicate.

## 5. Server-side behaviour (trigger)
A `SECURITY DEFINER` trigger runs after an assignment is inserted or updated, and
only when the row has just become published (a draft save, an edit of an already
published row, or a move back to draft does nothing).

For every active student in that exact class and section it:
- resolves the guardian's contact number from the same priority order the app
  uses (WhatsApp Number, then Messaging Number, then Father Contact No., then
  Guardian Phone, then Mother Number) and normalises it to the `92…` form,
- renders the saved `homework_alert` wording in the school's chosen language,
  filling `{student_name}`, `{class}`, `{subject}`, `{title}`, `{date}`,
  `{due_date}` and `{school_name}`,
- writes one portal notice,
- writes one WhatsApp alert row.

A student with a pending fee balance is skipped, so homework notices follow the
same fee rule the portal and the school assistant already apply. Students who are
not active, and students in another section, are never included.

## 6. Security
- RLS is enabled on `school_homework_alerts`; no access is possible until a policy
  allows it.
- `anon` is revoked; only signed-in staff reach the table.
- Reading, updating and removing alert rows is limited to active staff, and adding
  a row to active administrators and teachers.
- The trigger function is revoked from PUBLIC, anon and authenticated so it can
  only run as a trigger.
- Every grant is explicit and only the four verbs the app uses are granted.

## 7. Notes
- No existing column is dropped, renamed or retyped, and no existing row is
  deleted or rewritten.
- The unique index on `school_portal_notifications` is left exactly as it is.
- Removing a homework assignment removes only its own alert rows and clears the
  link on its notices; the notices themselves stay readable.
*/

-- ---------------------------------------------------------------------------
-- New table: the homework WhatsApp alert list
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_homework_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id uuid NOT NULL REFERENCES public.school_homework(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  class_name text,
  section_name text,
  parent_phone text,
  homework_date date NOT NULL DEFAULT CURRENT_DATE,
  language text NOT NULL DEFAULT 'English',
  message_body text,
  attachment_url text,
  status text NOT NULL DEFAULT 'queued',
  sent_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_homework_alerts_language_check CHECK (language IN ('English', 'Urdu')),
  CONSTRAINT school_homework_alerts_status_check CHECK (status IN ('queued', 'sent'))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_homework_alerts_key
  ON public.school_homework_alerts (homework_id, student_id);

CREATE INDEX IF NOT EXISTS school_homework_alerts_status_idx
  ON public.school_homework_alerts (status);

CREATE INDEX IF NOT EXISTS school_homework_alerts_date_idx
  ON public.school_homework_alerts (homework_date DESC);

-- ---------------------------------------------------------------------------
-- Portal notices gain a link back to the assignment that raised them
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_portal_notifications'
      AND column_name = 'homework_id'
  ) THEN
    ALTER TABLE public.school_portal_notifications
      ADD COLUMN homework_id uuid REFERENCES public.school_homework(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One notice per student per assignment. Partial, so the absence and fee notices
-- (which never carry a homework_id) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS school_portal_notifications_homework_key
  ON public.school_portal_notifications (student_id, notification_type, homework_id)
  WHERE homework_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Wording: allow a homework notice type and seed starter wording
-- ---------------------------------------------------------------------------

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.school_notice_templates'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%fee_clearance_reminder%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_notice_templates DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.school_notice_templates
  ADD CONSTRAINT school_notice_templates_notice_type_check
  CHECK (notice_type IN ('fee_clearance_reminder', 'warning_notice', 'absentee_alert', 'leave_alert', 'late_alert', 'homework_alert'));

INSERT INTO public.school_notice_templates (notice_type, language, template_text)
VALUES
  (
    'homework_alert',
    'English',
    'Dear Parent or Guardian, {student_name} of {class} has been given new homework in {subject}: {title}. Please make sure it is completed and handed in by {due_date}. — {school_name}'
  ),
  (
    'homework_alert',
    'Urdu',
    'محترم والدین، {student_name} ({class}) کو {subject} میں نیا ہوم ورک دیا گیا ہے: {title}۔ براہِ کرم اسے {due_date} تک مکمل کر کے جمع کرائیں۔ — {school_name}'
  )
ON CONFLICT (notice_type, language) DO NOTHING;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.school_sms_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%message_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_sms_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.school_sms_log
  ADD CONSTRAINT school_sms_log_message_type_check
  CHECK (message_type IN ('absentee_alert', 'leave_alert', 'late_alert', 'fee_reminder', 'homework_alert'));

-- ---------------------------------------------------------------------------
-- The publish trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_homework_notify_parents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_language text;
  v_template text;
  v_class text;
  v_due text;
  v_title text;
  v_body text;
  v_school text;
  v_phone text;
  v_student record;
BEGIN
  -- Only a row that has just become published notifies anyone.
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  SELECT CASE WHEN s.language = 'Urdu' THEN 'Urdu' ELSE 'English' END
  INTO v_language
  FROM public.school_absentee_settings s
  WHERE s.id = 'default';
  v_language := COALESCE(v_language, 'English');

  SELECT t.template_text INTO v_template
  FROM public.school_notice_templates t
  WHERE t.notice_type = 'homework_alert'
    AND t.language = v_language;

  IF v_template IS NULL OR btrim(v_template) = '' THEN
    v_template := CASE WHEN v_language = 'Urdu'
      THEN 'محترم والدین، {student_name} ({class}) کو {subject} میں نیا ہوم ورک دیا گیا ہے: {title}۔ — {school_name}'
      ELSE 'Dear Parent or Guardian, {student_name} of {class} has been given new homework in {subject}: {title}. — {school_name}'
    END;
  END IF;

  v_school := CASE WHEN v_language = 'Urdu' THEN 'اجالا پبلک اسکول' ELSE 'Ujala Public School' END;
  v_class := NEW.class_name || CASE WHEN COALESCE(btrim(NEW.section_name), '') = '' THEN '' ELSE ' · Section ' || NEW.section_name END;
  v_due := CASE
    WHEN NEW.due_date IS NULL THEN CASE WHEN v_language = 'Urdu' THEN 'اگلے اسکول دن' ELSE 'the next school day' END
    ELSE to_char(NEW.due_date, 'DD Mon YYYY')
  END;
  v_title := CASE WHEN v_language = 'Urdu'
    THEN 'نیا ہوم ورک: ' || NEW.subject_name
    ELSE 'New homework: ' || NEW.subject_name
  END;

  FOR v_student IN
    SELECT s.id,
           s.full_name,
           COALESCE(NULLIF(btrim(s.whatsapp_number), ''), NULLIF(btrim(s.messaging_number), ''),
                    NULLIF(btrim(s.father_contact_number), ''), NULLIF(btrim(s.guardian_phone), ''),
                    NULLIF(btrim(s.mother_number), '')) AS raw_phone
    FROM public.school_students s
    WHERE s.status = 'active'
      AND lower(btrim(s.class_name)) = lower(btrim(NEW.class_name))
      AND lower(btrim(s.section_name)) = lower(btrim(NEW.section_name))
      -- Homework follows the same fee rule as the portal and the school assistant.
      AND COALESCE(s.fee_balance, 0) <= 0
  LOOP
    v_body := replace(replace(v_template, '{{', '{'), '}}', '}');
    v_body := replace(v_body, '{student_name}', v_student.full_name);
    v_body := replace(v_body, '{class}', v_class);
    v_body := replace(v_body, '{subject}', NEW.subject_name);
    v_body := replace(v_body, '{title}', NEW.title);
    v_body := replace(v_body, '{date}', to_char(NEW.homework_date, 'DD Mon YYYY'));
    v_body := replace(v_body, '{due_date}', v_due);
    v_body := replace(v_body, '{school_name}', v_school);

    v_phone := NULL;
    IF v_student.raw_phone IS NOT NULL THEN
      v_phone := regexp_replace(v_student.raw_phone, '\D', '', 'g');
      IF v_phone LIKE '00%' THEN
        v_phone := substr(v_phone, 3);
      END IF;
      IF v_phone LIKE '920%' THEN
        v_phone := '92' || substr(v_phone, 4);
      ELSIF v_phone LIKE '0%' THEN
        v_phone := '92' || substr(v_phone, 2);
      END IF;
      IF v_phone = '' THEN
        v_phone := NULL;
      END IF;
    END IF;

    INSERT INTO public.school_portal_notifications
      (student_id, notification_type, title, body, attendance_date, created_by, attachment_url, homework_id)
    VALUES
      (v_student.id, 'homework', v_title, v_body, NULL, COALESCE(NEW.assigned_by, auth.uid()), NEW.attachment_url, NEW.id)
    ON CONFLICT (student_id, notification_type, homework_id) WHERE homework_id IS NOT NULL DO NOTHING;

    INSERT INTO public.school_homework_alerts
      (homework_id, student_id, student_name, class_name, section_name, parent_phone,
       homework_date, language, message_body, attachment_url, created_by)
    VALUES
      (NEW.id, v_student.id, v_student.full_name, NEW.class_name, NEW.section_name, v_phone,
       NEW.homework_date, v_language, v_body, NEW.attachment_url, COALESCE(NEW.assigned_by, auth.uid()))
    ON CONFLICT (homework_id, student_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.school_homework_notify_parents() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_homework_notify_parents_trg ON public.school_homework;
CREATE TRIGGER school_homework_notify_parents_trg
  AFTER INSERT OR UPDATE ON public.school_homework
  FOR EACH ROW EXECUTE FUNCTION public.school_homework_notify_parents();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_homework_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_homework_alerts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_homework_alerts TO authenticated;

DROP POLICY IF EXISTS "Staff can read homework alerts" ON public.school_homework_alerts;
CREATE POLICY "Staff can read homework alerts"
ON public.school_homework_alerts FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Teachers can add homework alerts" ON public.school_homework_alerts;
CREATE POLICY "Teachers can add homework alerts"
ON public.school_homework_alerts FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Staff can update homework alerts" ON public.school_homework_alerts;
CREATE POLICY "Staff can update homework alerts"
ON public.school_homework_alerts FOR UPDATE
TO authenticated
USING (is_staff())
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove homework alerts" ON public.school_homework_alerts;
CREATE POLICY "Staff can remove homework alerts"
ON public.school_homework_alerts FOR DELETE
TO authenticated
USING (is_staff());
