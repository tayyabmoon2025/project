/*
# Automatic homework reminders as the hand-in date approaches

## 1. Summary
Until now a guardian was told about homework only at the moment it was published.
Nothing chased the work as its hand-in date got close. This migration adds that
second stage: a reminder that can be prepared automatically a chosen number of
days before the work is due.

Three things are added, and nothing already stored is changed or removed.

1. The homework WhatsApp list can now hold two kinds of row per student: the
   original "new homework" notice, and a "due soon" reminder. Previously only one
   row per student per assignment was possible, so a reminder could never be added.
2. A new function prepares the reminder rows and the matching portal notice for a
   chosen lead time, and is safe to run repeatedly.
3. New English and Urdu wording for the reminder, editable in the same place as
   the other homework wording.

## 2. Changed table: school_homework_alerts
Two new columns, both optional for existing rows:

- `alert_kind` — text, required, defaults to `assigned`. Either `assigned` (the
  notice sent when the work is published) or `reminder` (the notice sent as the
  hand-in date approaches). Every row already stored is the `assigned` kind, which
  is why that is the default.
- `reminder_days_before` — integer, optional. How many days before the hand-in
  date this reminder was prepared. Blank for the original notice.

The existing uniqueness rule allowed one row per assignment and student. It is
replaced by one row per assignment, student and kind, so a student can receive
both the original notice and a reminder without either replacing the other. No
rows are deleted; the new rule is a superset of the old one, so every existing row
still satisfies it.

A supporting index on the kind and status keeps the reminder list quick to read.

## 3. New function: run_homework_deadline_reminders(days)
Prepares the reminders for every published assignment whose hand-in date is
exactly the given number of days away.

- `days` may be 0 (due today) up to 14. Anything else is refused.
- For each active student in the assignment's class who has no fee balance owing
  (the same rule the portal and the school assistant already follow):
  - a reminder is added to the WhatsApp list, worded from the school's own saved
    reminder wording in its chosen language;
  - a notice is added to the parent and student portal marked as a reminder, so it
    reads differently from the original "new homework" notice;
  - the phone number is normalised to the same international form the rest of the
    app uses.
- It is safe to run as often as you like. A reminder already prepared for a given
  assignment and student is left as it is, so nobody is messaged twice.
- It returns the number of reminders newly prepared.

## 4. Security
- The function is a `SECURITY DEFINER` function so it can read the account and
  student tables, and it is revoked from the public and anonymous roles.
- Signed-in staff may run it on demand. Anyone signed in who is not staff is
  refused, because the check runs inside the function.
- A scheduled run arrives with no signed-in user at all, which the function allows
  so the same code can be run on a timer.
- No new table is created, so no new row level security is required. The existing
  homework alert policies continue to apply unchanged.

## 5. New wording: homework_reminder
The list of permitted wording kinds is widened to include `homework_reminder`, and
English and Urdu wording is seeded. An existing school edit is never overwritten.
The same change is made to the permitted kinds in the message log, so reminder
messages are recorded separately from the original notices.

## 6. Notes
- No table, column or row is deleted. No existing wording is replaced.
- Every statement is safe to run again.
- The original publishing notice is unchanged apart from recording its kind, so
  the existing publish workflow behaves exactly as before.
*/

-- ---------------------------------------------------------------------------
-- 1. Two kinds of homework alert
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_homework_alerts
  ADD COLUMN IF NOT EXISTS alert_kind text NOT NULL DEFAULT 'assigned';

ALTER TABLE public.school_homework_alerts
  ADD COLUMN IF NOT EXISTS reminder_days_before integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.school_homework_alerts'::regclass
      AND conname = 'school_homework_alerts_kind_check'
  ) THEN
    ALTER TABLE public.school_homework_alerts
      ADD CONSTRAINT school_homework_alerts_kind_check
      CHECK (alert_kind IN ('assigned', 'reminder'));
  END IF;
END $$;

DROP INDEX IF EXISTS public.school_homework_alerts_key;
CREATE UNIQUE INDEX IF NOT EXISTS school_homework_alerts_key
  ON public.school_homework_alerts (homework_id, student_id, alert_kind);

CREATE INDEX IF NOT EXISTS school_homework_alerts_kind_idx
  ON public.school_homework_alerts (alert_kind, status);

-- ---------------------------------------------------------------------------
-- 2. Reminder wording, in the same editable list as the rest
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'school_notice_templates'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%homework_alert%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_notice_templates DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE public.school_notice_templates
  ADD CONSTRAINT school_notice_templates_notice_type_check
  CHECK (notice_type IN (
    'fee_clearance_reminder', 'warning_notice', 'absentee_alert',
    'leave_alert', 'late_alert', 'homework_alert', 'homework_reminder'
  ));

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'school_sms_log'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%homework_alert%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_sms_log DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE public.school_sms_log
  ADD CONSTRAINT school_sms_log_message_type_check
  CHECK (message_type IN (
    'absentee_alert', 'leave_alert', 'late_alert',
    'fee_reminder', 'homework_alert', 'homework_reminder'
  ));

INSERT INTO public.school_notice_templates (notice_type, language, template_text)
VALUES
  ('homework_reminder', 'English',
   'Reminder: {student_name} of {class} has homework in {subject} — {title}. It must be handed in by {due_date}. — {school_name}'),
  ('homework_reminder', 'Urdu',
   'یاد دہانی: {student_name} ({class}) کا {subject} کا ہوم ورک — {title} — {due_date} تک جمع کرانا ہے۔ — {school_name}')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The publishing notice now records its kind
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
       homework_date, language, message_body, attachment_url, created_by, alert_kind)
    VALUES
      (NEW.id, v_student.id, v_student.full_name, NEW.class_name, NEW.section_name, v_phone,
       NEW.homework_date, v_language, v_body, NEW.attachment_url, COALESCE(NEW.assigned_by, auth.uid()), 'assigned')
    ON CONFLICT (homework_id, student_id, alert_kind) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Preparing the reminders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_homework_deadline_reminders(p_days integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_language text;
  v_template text;
  v_school text;
  v_class text;
  v_due text;
  v_title text;
  v_body text;
  v_phone text;
  v_hw record;
  v_student record;
  v_prepared integer := 0;
  v_inserted integer;
BEGIN
  -- A scheduled run arrives with no signed-in user; staff may also run it on demand.
  IF auth.uid() IS NOT NULL AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff can prepare homework reminders.';
  END IF;
  IF p_days IS NULL OR p_days < 0 OR p_days > 14 THEN
    RAISE EXCEPTION 'Choose between 0 and 14 days before the hand-in date.';
  END IF;

  SELECT CASE WHEN s.language = 'Urdu' THEN 'Urdu' ELSE 'English' END
  INTO v_language
  FROM public.school_absentee_settings s
  WHERE s.id = 'default';
  v_language := COALESCE(v_language, 'English');

  SELECT t.template_text INTO v_template
  FROM public.school_notice_templates t
  WHERE t.notice_type = 'homework_reminder'
    AND t.language = v_language;

  IF v_template IS NULL OR btrim(v_template) = '' THEN
    v_template := CASE WHEN v_language = 'Urdu'
      THEN 'یاد دہانی: {student_name} ({class}) کا {subject} کا ہوم ورک — {title} — {due_date} تک جمع کرانا ہے۔ — {school_name}'
      ELSE 'Reminder: {student_name} of {class} has homework in {subject} — {title}. It must be handed in by {due_date}. — {school_name}'
    END;
  END IF;

  v_school := CASE WHEN v_language = 'Urdu' THEN 'اجالا پبلک اسکول' ELSE 'Ujala Public School' END;

  FOR v_hw IN
    SELECT h.id, h.class_name, h.section_name, h.subject_name, h.title,
           h.due_date, h.attachment_url, h.assigned_by
    FROM public.school_homework h
    WHERE h.status = 'published'
      AND h.due_date IS NOT NULL
      AND h.due_date = CURRENT_DATE + p_days
  LOOP
    v_class := v_hw.class_name || CASE WHEN COALESCE(btrim(v_hw.section_name), '') = '' THEN '' ELSE ' · Section ' || v_hw.section_name END;
    v_due := to_char(v_hw.due_date, 'DD Mon YYYY');
    v_title := CASE WHEN v_language = 'Urdu'
      THEN 'ہوم ورک کی یاد دہانی: ' || v_hw.subject_name
      ELSE 'Homework due: ' || v_hw.subject_name
    END;

    FOR v_student IN
      SELECT s.id,
             s.full_name,
             COALESCE(NULLIF(btrim(s.whatsapp_number), ''), NULLIF(btrim(s.messaging_number), ''),
                      NULLIF(btrim(s.father_contact_number), ''), NULLIF(btrim(s.guardian_phone), ''),
                      NULLIF(btrim(s.mother_number), '')) AS raw_phone
      FROM public.school_students s
      WHERE s.status = 'active'
        AND lower(btrim(s.class_name)) = lower(btrim(v_hw.class_name))
        AND lower(btrim(s.section_name)) = lower(btrim(v_hw.section_name))
        -- Homework follows the same fee rule as the portal and the school assistant.
        AND COALESCE(s.fee_balance, 0) <= 0
    LOOP
      v_body := replace(replace(v_template, '{{', '{'), '}}', '}');
      v_body := replace(v_body, '{student_name}', v_student.full_name);
      v_body := replace(v_body, '{class}', v_class);
      v_body := replace(v_body, '{subject}', v_hw.subject_name);
      v_body := replace(v_body, '{title}', v_hw.title);
      v_body := replace(v_body, '{date}', to_char(v_hw.due_date, 'DD Mon YYYY'));
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

      INSERT INTO public.school_homework_alerts
        (homework_id, student_id, student_name, class_name, section_name, parent_phone,
         homework_date, language, message_body, attachment_url, created_by, alert_kind, reminder_days_before)
      VALUES
        (v_hw.id, v_student.id, v_student.full_name, v_hw.class_name, v_hw.section_name, v_phone,
         CURRENT_DATE, v_language, v_body, v_hw.attachment_url,
         COALESCE(v_hw.assigned_by, auth.uid()), 'reminder', p_days)
      ON CONFLICT (homework_id, student_id, alert_kind) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_prepared := v_prepared + v_inserted;

      INSERT INTO public.school_portal_notifications
        (student_id, notification_type, title, body, attendance_date, created_by, attachment_url, homework_id)
      VALUES
        (v_student.id, 'homework_reminder', v_title, v_body, NULL,
         COALESCE(v_hw.assigned_by, auth.uid()), v_hw.attachment_url, v_hw.id)
      ON CONFLICT (student_id, notification_type, homework_id) WHERE homework_id IS NOT NULL DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN v_prepared;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_homework_deadline_reminders(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_homework_deadline_reminders(integer) TO authenticated;
