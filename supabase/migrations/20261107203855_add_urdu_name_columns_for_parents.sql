/*
# Add Urdu name fields to student records

1. Modified Table
- `school_students` gains three optional Urdu name fields:
  - `fathers_name_urdu` (text) - the father's name written in Urdu
  - `mother_name_urdu` (text) - the mother's name written in Urdu
- `full_name_urdu` (text) was added by the previous step of this change.

2. Security
- No new tables. Existing access rules on `school_students` already cover the new columns.

3. Important notes
- All statements are idempotent, and no existing data is changed.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS full_name_urdu text,
  ADD COLUMN IF NOT EXISTS fathers_name_urdu text,
  ADD COLUMN IF NOT EXISTS mother_name_urdu text;
