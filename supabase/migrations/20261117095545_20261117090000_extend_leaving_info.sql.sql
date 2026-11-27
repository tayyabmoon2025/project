/*
# Add extended Leaving Info fields to school_students

1. Purpose
- The "Leaving Info" tab needs richer recording of a student's departure:
  leaving status and class, academic progress and conduct ratings, the period
  fees are paid up to, and auto-generated leaving certificate details.

2. New Columns (all nullable, safe to add to existing rows)
- leaving_status (text) — Transferred, Withdrawn, Pass Out, Expelled, Other
- leaving_class (text) — the class the student was in when leaving
- progress (text) — academic progress rating
- conduct (text) — conduct rating
- fee_paid_upto (text) — period/month fees are paid through
- leaving_certificate_number (text) — auto-generated certificate number
- leaving_certificate_date (date) — date the leaving certificate is issued

3. Security
- No RLS or grant changes. Columns inherit existing school_students policies.
*/

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS leaving_status text,
  ADD COLUMN IF NOT EXISTS leaving_class text,
  ADD COLUMN IF NOT EXISTS progress text,
  ADD COLUMN IF NOT EXISTS conduct text,
  ADD COLUMN IF NOT EXISTS fee_paid_upto text,
  ADD COLUMN IF NOT EXISTS leaving_certificate_number text,
  ADD COLUMN IF NOT EXISTS leaving_certificate_date date;
