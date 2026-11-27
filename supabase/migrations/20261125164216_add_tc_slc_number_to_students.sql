/*
# Add TC / SLC Number to students

1. New Columns
- `public.school_students.tc_slc_number` (text, nullable)
  The Transfer Certificate (TC) or School Leaving Certificate (SLC) number issued by the
  student's previous school, recorded at the time of admission. It is optional, because a
  family often admits a child before the previous school hands the certificate over.

2. Modified Tables
- `public.school_students` — one new nullable column added. No existing column is changed,
  renamed or dropped, so no stored data is affected.

3. Security
- No change. Row level security is already enabled on `public.school_students`, and access
  is granted at table level to the signed-in roles, so the existing SELECT / INSERT /
  UPDATE / DELETE policies and grants already cover the new column.

4. Notes
1. The column is nullable so every existing student row stays valid without a backfill.
2. The Students List uses this column together with the existing submitted-document fields
   (`submitted_previous_tc`, `submitted_b_form`) and `whatsapp_number` to flag students
   whose paperwork is still pending.
3. The statement is idempotent — re-running it is safe.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'school_students'
      AND column_name = 'tc_slc_number'
  ) THEN
    ALTER TABLE public.school_students ADD COLUMN tc_slc_number text;
  END IF;
END $$;
