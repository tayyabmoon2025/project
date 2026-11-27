/*
# Absentee alert queue and parent portal absence notifications

## 1. Purpose
The school sends WhatsApp alerts to guardians when a student is absent. Until now
the list of absentees lived only on screen for the moment the register was open,
and nothing reached the parent portal. This migration adds the two pieces of
storage that make the absentee workflow permanent:

1. An **absentee alert queue** — the "Send Absentee SMS" record. One row per
   absent student per school day, kept until the alert is sent, so the office can
   come back to it, tick the students it wants, and send them in bulk.
2. **Portal notifications** — an in-app absence notice that appears in the
   parent's portal. It is created automatically the instant a student joins the
   queue, so a guardian never waits on the WhatsApp send.

## 2. Modified table: school_notice_templates
The existing wording table only accepted `fee_clearance_reminder` and
`warning_notice`. This migration widens that rule to also accept
`absentee_alert`, and seeds one starter template per language.

- The rule is widened by dropping whichever check constraint already governs
  `notice_type` and adding the replacement, so no existing row is touched.
- Starter absentee wording is inserted only when it does not already exist, so a
  school that has already saved its own wording keeps it.
- Placeholders supported in the wording: `{student_name}`, `{class}`, `{date}`
  and `{school_name}`.

## 3. New table: school_absentee_queue
One row per absent student per school day awaiting a WhatsApp alert.

| column | meaning |
| --- | --- |
| id | unique row id |
| student_id | the absent student (removed automatically with the student) |
| student_name | the student's name when they joined the queue |
| class_name / section_name | the class and section at that time |
| parent_phone | the guardian number the alert is addressed to |
| attendance_date | the school day the student was absent |
| language | the template language chosen for this alert (`English` or `Urdu`) |
| message_body | the exact wording that will be sent |
| status | `queued` until sent, then `sent` |
| sent_at | when the alert was sent |
| created_by | the staff account that queued it |
| created_at | when the row was created |

- A unique index on `(student_id, attendance_date)` means a student can only sit
  in the queue once per day, so re-saving the register cannot duplicate rows.

## 4. New table: school_portal_notifications
One row per notice shown in a portal (currently absence notices for parents).

| column | meaning |
| --- | --- |
| id | unique row id |
| student_id | the student the notice is about (removed with the student) |
| notification_type | what kind of notice this is (`absence` by default) |
| title | short heading shown in the portal |
| body | the full notice text |
| attendance_date | the school day the notice refers to |
| created_by | who triggered it |
| created_at | when it was created |

- A unique index on `(student_id, notification_type, attendance_date)` keeps a
  single absence notice per student per day, so repeated saves stay quiet.

## 5. Automatic absence notice
A trigger on `school_absentee_queue` inserts the matching portal notification the
moment a student joins the queue. It runs `SECURITY DEFINER` because the parent
portal row must be written regardless of who is signed in, and it copies the
date, student name, class and message wording into the notice.

## 6. Security
- Row level security is enabled on both new tables.
- `school_absentee_queue`: staff (`is_staff()`) may read, add, update and remove
  rows. Parents and students have no access — the guardian sees the notice in
  their portal, not the send queue.
- `school_portal_notifications`: staff may read, add, update and remove. A parent
  may read only notices for students linked to their account, and a student may
  read only their own notices.
- `authenticated` is granted exactly the verbs the app uses; `anon` is granted
  nothing on either table.
- No existing table, column or row is dropped or rewritten.
*/

-- ---------------------------------------------------------------------------
-- 1. Allow the absentee_alert notice type
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
  CHECK (notice_type IN ('fee_clearance_reminder', 'warning_notice', 'absentee_alert'));

INSERT INTO public.school_notice_templates (notice_type, language, template_text)
VALUES
  ('absentee_alert', 'English', 'Dear Parent or Guardian, {student_name} of {class} was marked absent on {date} at {school_name}. Please contact the school office if this was not expected.'),
  ('absentee_alert', 'Urdu', 'محترم والدین، {student_name} ({class}) {date} کو {school_name} میں غیر حاضر رہے۔ اگر یہ غیر متوقع تھا تو براہِ کرم اسکول دفتر سے رابطہ کریں۔')
ON CONFLICT (notice_type, language) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The "Send Absentee SMS" queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_absentee_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  class_name text,
  section_name text,
  parent_phone text,
  attendance_date date NOT NULL,
  language text NOT NULL DEFAULT 'English',
  message_body text,
  status text NOT NULL DEFAULT 'queued',
  sent_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_absentee_queue_status_check CHECK (status IN ('queued', 'sent')),
  CONSTRAINT school_absentee_queue_language_check CHECK (language IN ('English', 'Urdu'))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_absentee_queue_student_date_key
  ON public.school_absentee_queue (student_id, attendance_date);
CREATE INDEX IF NOT EXISTS school_absentee_queue_date_idx ON public.school_absentee_queue (attendance_date);
CREATE INDEX IF NOT EXISTS school_absentee_queue_status_idx ON public.school_absentee_queue (status);

ALTER TABLE public.school_absentee_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_absentee_queue FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_absentee_queue TO authenticated;

DROP POLICY IF EXISTS "Staff can read absentee queue" ON public.school_absentee_queue;
CREATE POLICY "Staff can read absentee queue" ON public.school_absentee_queue FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "Staff can add to absentee queue" ON public.school_absentee_queue;
CREATE POLICY "Staff can add to absentee queue" ON public.school_absentee_queue FOR INSERT
TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update absentee queue" ON public.school_absentee_queue;
CREATE POLICY "Staff can update absentee queue" ON public.school_absentee_queue FOR UPDATE
TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove from absentee queue" ON public.school_absentee_queue;
CREATE POLICY "Staff can remove from absentee queue" ON public.school_absentee_queue FOR DELETE
TO authenticated USING (is_staff());

-- ---------------------------------------------------------------------------
-- 3. Portal notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  notification_type text NOT NULL DEFAULT 'absence',
  title text NOT NULL,
  body text NOT NULL,
  attendance_date date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_portal_notifications_student_day_key
  ON public.school_portal_notifications (student_id, notification_type, attendance_date);
CREATE INDEX IF NOT EXISTS school_portal_notifications_student_idx
  ON public.school_portal_notifications (student_id, created_at DESC);

ALTER TABLE public.school_portal_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_portal_notifications FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_portal_notifications TO authenticated;

DROP POLICY IF EXISTS "Staff can read portal notifications" ON public.school_portal_notifications;
CREATE POLICY "Staff can read portal notifications" ON public.school_portal_notifications FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "Staff can add portal notifications" ON public.school_portal_notifications;
CREATE POLICY "Staff can add portal notifications" ON public.school_portal_notifications FOR INSERT
TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update portal notifications" ON public.school_portal_notifications;
CREATE POLICY "Staff can update portal notifications" ON public.school_portal_notifications FOR UPDATE
TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove portal notifications" ON public.school_portal_notifications;
CREATE POLICY "Staff can remove portal notifications" ON public.school_portal_notifications FOR DELETE
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "Parents and students can read their notifications" ON public.school_portal_notifications;
CREATE POLICY "Parents and students can read their notifications" ON public.school_portal_notifications FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_portal_notifications.student_id
  )
  OR school_portal_notifications.student_id = public.own_student_id()
);

-- ---------------------------------------------------------------------------
-- 4. An absence notice is created the moment a student joins the queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_parent_of_absence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, created_by
  )
  VALUES (
    NEW.student_id,
    'absence',
    'Absence recorded',
    format(
      '%s of %s was marked absent on %s.%s',
      NEW.student_name,
      coalesce(nullif(trim(NEW.class_name || ' · Section ' || coalesce(NEW.section_name, '')), ' · Section '), 'the school'),
      to_char(NEW.attendance_date, 'DD Mon YYYY'),
      CASE WHEN NEW.message_body IS NULL OR btrim(NEW.message_body) = '' THEN '' ELSE ' ' || NEW.message_body END
    ),
    NEW.attendance_date,
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
