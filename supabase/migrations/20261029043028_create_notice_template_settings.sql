/*
# Create editable notice template settings

1. Purpose
- Adds a small single-school settings table for the default text used by fee clearance reminders and warning notices.

2. New Table
- `school_notice_templates`
- `id` is the generated template identifier.
- `notice_type` identifies `fee_clearance_reminder` or `warning_notice`.
- `language` identifies the English or Urdu version.
- `template_text` stores editable notice copy with optional `{{student_name}}` and `{{school_name}}` placeholders.
- `updated_at` records the latest save time.

3. Security
- Row level security is enabled on the new table.
- This is a single-school workspace without a sign-in screen, so anon and authenticated receive only SELECT, INSERT, and UPDATE access through explicit policies.

4. Important Notes
- The unique notice type and language pair prevents duplicate templates.
- Four starter templates are inserted only when they do not already exist.
- Existing notice history is not changed.
*/

CREATE TABLE IF NOT EXISTS public.school_notice_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_type text NOT NULL CHECK (notice_type IN ('fee_clearance_reminder', 'warning_notice')),
  language text NOT NULL CHECK (language IN ('English', 'Urdu')),
  template_text text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_type, language)
);

ALTER TABLE public.school_notice_templates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.school_notice_templates TO anon, authenticated;

DROP POLICY IF EXISTS "School workspace can read notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can read notice templates" ON public.school_notice_templates FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "School workspace can add notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can add notice templates" ON public.school_notice_templates FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "School workspace can update notice templates" ON public.school_notice_templates;
CREATE POLICY "School workspace can update notice templates" ON public.school_notice_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

INSERT INTO public.school_notice_templates (notice_type, language, template_text)
VALUES
  ('fee_clearance_reminder', 'English', 'Dear {{student_name}}, please complete your fee clearance at the earliest. Contact {{school_name}} if you need any help.'),
  ('fee_clearance_reminder', 'Urdu', '{{student_name}}، براہ کرم فیس کلیئرنس مکمل کریں۔ مزید معلومات کے لیے {{school_name}} سے رابطہ کریں۔'),
  ('warning_notice', 'English', 'Dear {{student_name}}, this is an important warning notice from {{school_name}}. Please contact the school office to resolve your pending clearance.'),
  ('warning_notice', 'Urdu', '{{student_name}}، یہ {{school_name}} کی جانب سے اہم انتباہی اطلاع ہے۔ براہ کرم اپنی زیر التوا کلیئرنس کے لیے اسکول کے دفتر سے رابطہ کریں۔')
ON CONFLICT (notice_type, language) DO NOTHING;