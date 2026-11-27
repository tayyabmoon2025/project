/*
# Add WhatsApp Number to students

1. Purpose
- Adds a dedicated WhatsApp contact number per student so staff can send
  attendance and fee messages through WhatsApp separately from the regular
  guardian/phone contacts.

2. New columns
- `school_students.whatsapp_number` (text, nullable) — the student/guardian's
  WhatsApp number used for messaging.

3. Security
- No policy changes required: this column is covered by the existing
  school_students SELECT/INSERT/UPDATE policies and grants.
*/

ALTER TABLE public.school_students
ADD COLUMN IF NOT EXISTS whatsapp_number text;
