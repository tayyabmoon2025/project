/*
# Create student notice log

1. Purpose
- Adds a durable record of fee clearance reminders and warning notices sent from the Search Student workspace.

2. New Table
- `school_student_notices`
- `id` is the generated notice identifier.
- `student_id` links the notice to a student in `school_students`.
- `notice_type` identifies a `fee_clearance_reminder` or `warning_notice`.
- `language` records the notice language used for the message.
- `message` stores the exact notice copy shown to the recipient.
- `sent_at` records when the action was completed.

3. Security
- Row level security is enabled on the new table.
- This is a single-school workspace without a sign-in screen, so anon and authenticated receive only SELECT and INSERT access through explicit policies.

4. Important Notes
- Student records are never deleted by this feature.
- The foreign key keeps notice history connected to the student record and removes only dependent notice history if a student record is intentionally removed.
- The table acts as the durable outbox for the current in-app sending workflow.
*/

CREATE TABLE IF NOT EXISTS public.school_student_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  notice_type text NOT NULL CHECK (notice_type IN ('fee_clearance_reminder', 'warning_notice')),
  language text NOT NULL DEFAULT 'English' CHECK (language IN ('English', 'Urdu')),
  message text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_student_notices ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.school_student_notices TO anon, authenticated;

DROP POLICY IF EXISTS "School workspace can read student notices" ON public.school_student_notices;
CREATE POLICY "School workspace can read student notices" ON public.school_student_notices FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "School workspace can send student notices" ON public.school_student_notices;
CREATE POLICY "School workspace can send student notices" ON public.school_student_notices FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS school_student_notices_student_id_idx ON public.school_student_notices (student_id);
CREATE INDEX IF NOT EXISTS school_student_notices_sent_at_idx ON public.school_student_notices (sent_at DESC);