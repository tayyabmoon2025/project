/*
# Add the father CNIC photocopy column to student records

## 1. Summary
The "Submitted Doc" tab lists the papers a family hands in at admission. Every
other document already stores both a status and an uploaded copy; the father's
CNIC photocopy was the one entry without a copy of its own, so the upload button
had nowhere to put the image.

## 2. Modified Tables
### `school_students`
- NEW COLUMN `submitted_father_cnic_file` (text, nullable) — the uploaded father
  CNIC image, stored the same way as the other document copies.

Nullable with a NULL default, so no existing record is affected. Nothing is
renamed, retyped or dropped.

## 3. Security
No security change. Row Level Security and the existing policies and table-level
grants on `school_students` already cover new columns.

## 4. Notes
1. Idempotent — re-running makes no change.
2. Companion to the `submitted_father_cnic` status column added earlier.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_students'
      AND column_name = 'submitted_father_cnic_file'
  ) THEN
    ALTER TABLE public.school_students ADD COLUMN submitted_father_cnic_file text;
  END IF;
END $$;
