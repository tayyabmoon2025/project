/*
# Add blood group and "father CNIC submitted" fields to student records

## 1. Summary
Two small text fields are added to the student roster so the printed Student
Admission Form can show them:

- `blood_group` — the student's blood group, typed in the "Other Info" tab of the
  admission form (for example `A+`, `O-`, `AB+`).
- `submitted_father_cnic` — the status of the father's CNIC photocopy in the
  "Submitted Doc" tab (for example `Submitted`, `Pending`, `N/A`). The existing
  submitted-document columns cover B-Form, previous school TC, birth certificate,
  photos and other documents; the father's CNIC copy had no column of its own, so
  the printed "Submitted Documents" checklist could not read it.

## 2. Modified Tables
### `school_students`
- NEW COLUMN `blood_group` (text, nullable) — the student's blood group.
- NEW COLUMN `submitted_father_cnic` (text, nullable) — status of the father's
  CNIC photocopy supplied at admission.

Both columns are nullable and default to NULL, so every existing student record is
left untouched and keeps working. Nothing is renamed, retyped or dropped.

## 3. Security
No security change. Row Level Security is already enabled on `school_students`
with the existing policies, and the table-level SELECT / INSERT / UPDATE / DELETE
grants held by `authenticated` and `service_role` already cover new columns, so no
new grants or policies are needed. Access rules for these fields are therefore
exactly the same as every other column on the table.

## 4. Notes
1. The migration is idempotent — re-running it makes no change.
2. Both fields are optional; the admission form and the printed sheet show an
   em dash when a value has not been recorded yet.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_students'
      AND column_name = 'blood_group'
  ) THEN
    ALTER TABLE public.school_students ADD COLUMN blood_group text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_students'
      AND column_name = 'submitted_father_cnic'
  ) THEN
    ALTER TABLE public.school_students ADD COLUMN submitted_father_cnic text;
  END IF;
END $$;
