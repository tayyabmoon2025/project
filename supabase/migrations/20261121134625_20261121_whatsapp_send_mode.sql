/*
# WhatsApp send mode and attendance alert log types

## 1. Purpose
The alert sender can now open WhatsApp Web in a single reused browser tab, or hand the
message straight to the installed WhatsApp Desktop app. The chosen option is a school-wide
setting, so it is stored in the database and shared by every office account. The alert log
also needs to record which kind of alert each row is (Absent, Leave or Late).

## 2. New Columns
- `school_absentee_settings.send_mode` (text, NOT NULL, default 'web')
  — 'web' opens WhatsApp Web, 'desktop' opens the WhatsApp Desktop app.

## 3. Modified Constraints
- `school_sms_log.message_type` is now checked against the three alert kinds
  ('absentee_alert', 'leave_alert', 'late_alert') instead of being unconstrained text.
  All existing rows use 'absentee_alert', so they satisfy the new rule.

## 4. Security
- RLS stays enabled on both tables and every existing policy is left untouched. The new
  column inherits the table's current read and write rules, and no grant changes.
- No function is created or replaced by this migration.
*/

ALTER TABLE public.school_absentee_settings
  ADD COLUMN IF NOT EXISTS send_mode text NOT NULL DEFAULT 'web';

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.school_absentee_settings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%send_mode%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_absentee_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.school_absentee_settings
  ADD CONSTRAINT school_absentee_settings_send_mode_check
  CHECK (send_mode IN ('web', 'desktop'));

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
  CHECK (message_type IN ('absentee_alert', 'leave_alert', 'late_alert'));
