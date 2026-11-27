/*
# Message & Notice Templates upgrade, plus a Sent Notices history

## 1. Why

The school asked for one place to write its messages and for every notice, warning
and WhatsApp message in the app to pull from that place. Until now a template was a
single block of text tied to a fixed list of seven internal notice kinds, with no
title, no category and no way to add a new one.

## 2. Modified table: `school_notice_templates`

Existing columns are untouched, so every screen that already reads or writes this
table keeps working exactly as before. New columns:

- `title` (text, not null, default '') — the name the office sees, e.g. "Fee due reminder".
- `category` (text, not null, default 'NOTICE') — the tag shown beside the title:
  NOTICE, REMINDER, WARNING, ATTENDANCE, FEE, HOMEWORK, EXAM or GENERAL.
- `body_english` (text, not null, default '') — the English wording.
- `body_urdu` (text, not null, default '') — the Urdu wording, right to left.
- `is_active` (boolean, not null, default true) — hides a template from the picker
  without deleting it.
- `created_at`, `created_by`, `updated_by` — who last changed a template.

`template_text` stays as the single-column field the absentee, homework and assistant
features already use. It is kept in step automatically (see section 4), so those
features keep working without any change.

Back-fill: existing rows get a title derived from their notice kind, a sensible
category, and their current wording copied into the matching language column.

The old check that restricted `notice_type` to seven fixed values is replaced by a
format check, so a school can invent its own kinds. The `(notice_type, language)`
unique key is kept.

## 3. New table: `school_sent_notices`

The record of every notice, warning or message the school has sent about a student.
- `id`, `student_id` (deleted with the student, matching the rest of the history),
  `template_id`, `title`, `category`, `body_english`, `body_urdu`, `language`,
  `rendered_text` (the exact wording that was sent), `delivery_channels`
  (whatsapp / print / portal), `status`, `whatsapp_number`,
  `portal_notification_id`, `sent_by`, `sent_by_name`, `created_at`.

Indexed on the student and on the send time, so a student's notice history and the
most recent notices are both fast to read.

## 4. New functions

- `save_notice_template(...)` — creates or updates a template. It fills `template_text`
  from the English wording (falling back to Urdu) so the older features keep reading
  the same column, and validates the title, category and kind before writing.
- `delete_notice_template(uuid)` — removes a template.
- `send_student_notice(...)` — writes the notice to the Parent Portal inbox and to the
  Sent Notices history in one step, resolving the sender's name on the server.

## 5. Security

- `school_notice_templates` is no longer readable or writable with the public key.
  Anonymous access is revoked; only signed-in staff can read or write templates.
- `school_sent_notices` has row level security with four separate policies: staff can
  read, add, change and remove; a parent can read their own child's notices and a
  student can read their own, matching how portal notifications already work.
- Every new function is security definer, revoked from the public key, and checks
  `is_staff()` before doing anything.

## 6. Notes

- A fresh database replays this file and ends up with the same shape and the same
  starter templates.
- No row identifiers are copied in; the starter templates are matched on their kind.
*/

-- ---------------------------------------------------------------------------
-- 1. Richer notice templates
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_notice_templates
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'NOTICE',
  ADD COLUMN IF NOT EXISTS body_english text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS body_urdu text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE public.school_notice_templates
  DROP CONSTRAINT IF EXISTS school_notice_templates_notice_type_check;

ALTER TABLE public.school_notice_templates
  DROP CONSTRAINT IF EXISTS school_notice_templates_category_check;

ALTER TABLE public.school_notice_templates
  ADD CONSTRAINT school_notice_templates_category_check
  CHECK (category IN ('NOTICE', 'REMINDER', 'WARNING', 'ATTENDANCE', 'FEE', 'HOMEWORK', 'EXAM', 'GENERAL'));

ALTER TABLE public.school_notice_templates
  ADD CONSTRAINT school_notice_templates_notice_type_check
  CHECK (notice_type ~ '^[a-z][a-z0-9_]{0,40}$');

-- Back-fill titles and categories for rows that predate these columns.
UPDATE public.school_notice_templates
SET title = initcap(replace(notice_type, '_', ' '))
WHERE title = '';

UPDATE public.school_notice_templates
SET category = CASE notice_type
  WHEN 'fee_clearance_reminder' THEN 'REMINDER'
  WHEN 'warning_notice' THEN 'WARNING'
  WHEN 'absentee_alert' THEN 'ATTENDANCE'
  WHEN 'leave_alert' THEN 'ATTENDANCE'
  WHEN 'late_alert' THEN 'ATTENDANCE'
  WHEN 'homework_alert' THEN 'HOMEWORK'
  WHEN 'homework_reminder' THEN 'HOMEWORK'
  ELSE 'NOTICE'
END
WHERE category = 'NOTICE' AND notice_type <> 'notice';

-- Move the old single-column wording into the language it was written in.
UPDATE public.school_notice_templates
SET body_english = template_text
WHERE language = 'English' AND body_english = '' AND template_text <> '';

UPDATE public.school_notice_templates
SET body_urdu = template_text
WHERE language = 'Urdu' AND body_urdu = '' AND template_text <> '';

-- Starter templates. ON CONFLICT keeps any wording the school has already written,
-- and a fresh database ends up with the same set.
INSERT INTO public.school_notice_templates
  (notice_type, language, template_text, title, category, body_english, body_urdu)
VALUES
  ('fee_due_reminder', 'English',
   'Dear Parent or Guardian, this is a reminder that Rs {{due_amount}} of school fee for {{student_name}} ({{class_name}}, Roll No {{roll_no}}) is still payable. Kindly clear it at the school office at your earliest convenience.',
   'Fee due reminder', 'FEE',
   'Dear Parent or Guardian, this is a reminder that Rs {{due_amount}} of school fee for {{student_name}} ({{class_name}}, Roll No {{roll_no}}) is still payable. Kindly clear it at the school office at your earliest convenience.',
   'محترم والدین، اطلاع دیا جاتا ہے کہ {{student_name}} (کلاس {{class_name}}، رول نمبر {{roll_no}}) کی فیس میں سے {{due_amount}} روپے ابھی تک واجب الادا ہیں۔ براہ کرم سہولت کے مطابق اسکول دفتر میں ادائیگی کر دیں۔'),
  ('attendance_warning', 'English',
   'Dear Parent or Guardian, the attendance of {{student_name}} ({{class_name}}, Roll No {{roll_no}}) has been irregular. We request your cooperation in sending the child to school regularly so that studies are not affected.',
   'Irregular attendance warning', 'ATTENDANCE',
   'Dear Parent or Guardian, the attendance of {{student_name}} ({{class_name}}, Roll No {{roll_no}}) has been irregular. We request your cooperation in sending the child to school regularly so that studies are not affected.',
   'محترم والدین، {{student_name}} (کلاس {{class_name}}، رول نمبر {{roll_no}}) کی حاضری باقاعدہ نہیں رہی۔ براہ کرم بچے کو روزانہ اسکول بھیجنے میں تعاون فرمائیں تاکہ تعلیم متاثر نہ ہو۔'),
  ('exam_result_notice', 'English',
   'Dear Parent or Guardian, the result of {{student_name}} ({{class_name}}, Roll No {{roll_no}}) has been prepared. Kindly collect the report card from the school office on {{date}}.',
   'Result collection notice', 'EXAM',
   'Dear Parent or Guardian, the result of {{student_name}} ({{class_name}}, Roll No {{roll_no}}) has been prepared. Kindly collect the report card from the school office on {{date}}.',
   'محترم والدین، {{student_name}} (کلاس {{class_name}}، رول نمبر {{roll_no}}) کا نتیجہ تیار ہے۔ براہ کرم {{date}} کو اسکول دفتر سے رپورٹ کارڈ وصول کریں۔'),
  ('general_notice', 'English',
   'Dear Parent or Guardian, this is to inform you about {{student_name}} ({{class_name}}). Please contact the school office if you need any further detail.',
   'General notice', 'NOTICE',
   'Dear Parent or Guardian, this is to inform you about {{student_name}} ({{class_name}}). Please contact the school office if you need any further detail.',
   'محترم والدین، یہ اطلاع {{student_name}} (کلاس {{class_name}}) کے بارے میں ہے۔ مزید تفصیل کے لیے اسکول دفتر سے رابطہ فرمائیں۔')
ON CONFLICT (notice_type, language) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Sent notices history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_sent_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.school_students(id) ON DELETE CASCADE,
  template_id uuid,
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'NOTICE',
  body_english text NOT NULL DEFAULT '',
  body_urdu text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'English',
  rendered_text text NOT NULL DEFAULT '',
  delivery_channels text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'logged',
  whatsapp_number text NOT NULL DEFAULT '',
  portal_notification_id uuid,
  sent_by uuid DEFAULT auth.uid(),
  sent_by_name text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.school_sent_notices
  DROP CONSTRAINT IF EXISTS school_sent_notices_language_check;
ALTER TABLE public.school_sent_notices
  ADD CONSTRAINT school_sent_notices_language_check
  CHECK (language IN ('English', 'Urdu', 'Bilingual'));

ALTER TABLE public.school_sent_notices
  DROP CONSTRAINT IF EXISTS school_sent_notices_status_check;
ALTER TABLE public.school_sent_notices
  ADD CONSTRAINT school_sent_notices_status_check
  CHECK (status IN ('logged', 'sent', 'portal_only', 'failed'));

CREATE INDEX IF NOT EXISTS school_sent_notices_student_idx
  ON public.school_sent_notices (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS school_sent_notices_created_idx
  ON public.school_sent_notices (created_at DESC);

ALTER TABLE public.school_sent_notices ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_sent_notices TO authenticated;

DROP POLICY IF EXISTS "Staff can read sent notices" ON public.school_sent_notices;
CREATE POLICY "Staff can read sent notices"
ON public.school_sent_notices FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Parents and students can read their sent notices" ON public.school_sent_notices;
CREATE POLICY "Parents and students can read their sent notices"
ON public.school_sent_notices FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM parent_student_links psl
    WHERE psl.parent_user_id = auth.uid()
      AND psl.student_id = school_sent_notices.student_id
  )
  OR student_id = own_student_id()
);

DROP POLICY IF EXISTS "Staff can add sent notices" ON public.school_sent_notices;
CREATE POLICY "Staff can add sent notices"
ON public.school_sent_notices FOR INSERT
TO authenticated
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can change sent notices" ON public.school_sent_notices;
CREATE POLICY "Staff can change sent notices"
ON public.school_sent_notices FOR UPDATE
TO authenticated
USING (is_staff())
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove sent notices" ON public.school_sent_notices;
CREATE POLICY "Staff can remove sent notices"
ON public.school_sent_notices FOR DELETE
TO authenticated
USING (is_staff());

-- ---------------------------------------------------------------------------
-- 3. Lock the template table down to signed-in staff
--    Previously the public key could read and write it, because the policy listed
--    the anonymous role. Nothing in the app needs templates before sign-in.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.school_notice_templates FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_notice_templates TO authenticated;

DROP POLICY IF EXISTS "School workspace can read notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can read notice templates"
ON public.school_notice_templates FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "School workspace can add notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can add notice templates"
ON public.school_notice_templates FOR INSERT
TO authenticated
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "School workspace can update notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can update notice templates"
ON public.school_notice_templates FOR UPDATE
TO authenticated
USING (is_staff())
WITH CHECK (is_staff());

DROP POLICY IF EXISTS "School workspace can remove notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can remove notice templates"
ON public.school_notice_templates FOR DELETE
TO authenticated
USING (is_staff());

-- ---------------------------------------------------------------------------
-- 4. Template functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_notice_template(
  p_id uuid,
  p_title text,
  p_category text,
  p_notice_type text,
  p_body_english text,
  p_body_urdu text,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text := btrim(coalesce(p_title, ''));
  v_category text := upper(btrim(coalesce(p_category, 'NOTICE')));
  v_type text := lower(btrim(coalesce(p_notice_type, '')));
  v_english text := coalesce(p_body_english, '');
  v_urdu text := coalesce(p_body_urdu, '');
  v_legacy text;
  v_id uuid;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Only school staff can manage message templates.';
  END IF;

  IF v_title = '' THEN
    RAISE EXCEPTION 'Give the template a title.';
  END IF;

  IF v_category NOT IN ('NOTICE', 'REMINDER', 'WARNING', 'ATTENDANCE', 'FEE', 'HOMEWORK', 'EXAM', 'GENERAL') THEN
    RAISE EXCEPTION 'Choose a valid category.';
  END IF;

  -- The kind is what other parts of the app look the wording up by, so it is derived
  -- from the title when the office has not set one, and always kept in a safe shape.
  IF v_type = '' THEN
    v_type := regexp_replace(lower(v_title), '[^a-z0-9]+', '_', 'g');
    v_type := btrim(v_type, '_');
    v_type := left(v_type, 40);
  END IF;
  IF v_type !~ '^[a-z][a-z0-9_]{0,40}$' THEN
    v_type := 'notice_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;

  IF btrim(v_english) = '' AND btrim(v_urdu) = '' THEN
    RAISE EXCEPTION 'Write the message in English, Urdu, or both.';
  END IF;

  -- The absentee, homework and assistant features read the older single column, so it
  -- follows the English wording and falls back to Urdu when only Urdu was written.
  v_legacy := CASE WHEN btrim(v_english) <> '' THEN v_english ELSE v_urdu END;

  IF p_id IS NULL THEN
    -- A brand-new template needs both language rows to satisfy the unique key.
    INSERT INTO public.school_notice_templates
      (notice_type, language, template_text, title, category, body_english, body_urdu,
       is_active, created_at, created_by, updated_by)
    VALUES
      (v_type, 'English', v_legacy, v_title, v_category, v_english, v_urdu,
       coalesce(p_is_active, true), now(), auth.uid(), auth.uid())
    ON CONFLICT (notice_type, language) DO UPDATE
      SET title = EXCLUDED.title,
          category = EXCLUDED.category,
          body_english = EXCLUDED.body_english,
          body_urdu = EXCLUDED.body_urdu,
          is_active = EXCLUDED.is_active,
          template_text = EXCLUDED.template_text,
          updated_at = now(),
          updated_by = auth.uid()
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.school_notice_templates
    SET title = v_title,
        category = v_category,
        notice_type = v_type,
        body_english = v_english,
        body_urdu = v_urdu,
        is_active = coalesce(p_is_active, true),
        template_text = v_legacy,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'That template no longer exists.';
    END IF;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_notice_template(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Only school staff can manage message templates.';
  END IF;

  DELETE FROM public.school_notice_templates WHERE id = p_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Sending a notice: Parent Portal inbox plus the Sent Notices history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_student_notice(
  p_student_id uuid,
  p_template_id uuid,
  p_title text,
  p_category text,
  p_body_english text,
  p_body_urdu text,
  p_language text,
  p_rendered_text text,
  p_channels text[],
  p_whatsapp_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_language text := coalesce(nullif(btrim(p_language), ''), 'English');
  v_channels text[] := coalesce(p_channels, ARRAY[]::text[]);
  v_post_to_portal boolean := 'portal' = ANY (v_channels);
  v_notification_id uuid;
  v_notice_id uuid;
  v_sender text;
  v_student_name text;
BEGIN
  IF NOT is_staff() THEN
    RAISE EXCEPTION 'Only school staff can send a notice.';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Choose a student before sending a notice.';
  END IF;

  IF btrim(coalesce(p_rendered_text, '')) = '' THEN
    RAISE EXCEPTION 'The notice is empty.';
  END IF;

  IF v_language NOT IN ('English', 'Urdu', 'Bilingual') THEN
    RAISE EXCEPTION 'Choose English, Urdu or both.';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'School office')
    INTO v_sender
  FROM public.user_profiles
  WHERE id = auth.uid();

  SELECT full_name INTO v_student_name
  FROM public.school_students
  WHERE id = p_student_id;

  IF v_student_name IS NULL THEN
    RAISE EXCEPTION 'That student could not be found.';
  END IF;

  -- The portal inbox only carries the wording; the history keeps the full record.
  IF v_post_to_portal THEN
    INSERT INTO public.school_portal_notifications
      (student_id, notification_type, title, body, audience, created_by)
    VALUES
      (p_student_id, 'student_notice', coalesce(nullif(btrim(p_title), ''), 'Notice from the school'),
       p_rendered_text, 'parent', auth.uid())
    RETURNING id INTO v_notification_id;
  END IF;

  INSERT INTO public.school_sent_notices
    (student_id, template_id, title, category, body_english, body_urdu, language,
     rendered_text, delivery_channels, status, whatsapp_number,
     portal_notification_id, sent_by, sent_by_name)
  VALUES
    (p_student_id, p_template_id, coalesce(nullif(btrim(p_title), ''), 'Notice'),
     coalesce(nullif(upper(btrim(p_category)), ''), 'NOTICE'),
     coalesce(p_body_english, ''), coalesce(p_body_urdu, ''), v_language,
     p_rendered_text, v_channels,
     CASE WHEN v_post_to_portal THEN 'portal_only' ELSE 'logged' END,
     coalesce(p_whatsapp_number, ''), v_notification_id, auth.uid(), coalesce(v_sender, ''))
  RETURNING id INTO v_notice_id;

  RETURN v_notice_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Function access
--    Postgres grants EXECUTE to everyone by default, so the public key is revoked.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.save_notice_template(uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_notice_template(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.send_student_notice(uuid, uuid, text, text, text, text, text, text, text[], text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_notice_template(uuid, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_notice_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_student_notice(uuid, uuid, text, text, text, text, text, text, text[], text) TO authenticated;
