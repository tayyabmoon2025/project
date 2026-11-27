/*
# Expand student admission information

1. New columns on `public.school_students`
- `student_name_prefix` stores an optional prefix such as Mr., Ms., or Dr. for the student name.
- `father_name_prefix` stores an optional prefix for the father name.
- `mother_name` stores the student's mother name.
- `last_school` stores the previous school name.
- `last_class` stores the student's previous class.
- `subject_group` stores the selected subject group.
- `place_of_birth` stores the student's place of birth.
- `student_form_b` stores the Student Form-B identifier.
- `assigned_subjects` stores the subjects assigned during admission.
- `photo_url` stores an optional student photo data URL selected from the admission form.

2. Modified table
- `public.school_students` gains the admission fields above without changing or removing existing data.

3. Security
- The existing single-school RLS policies remain in place.
- Existing anon and authenticated table grants continue to cover these added columns.

4. Important notes
- Existing student records remain valid because all new fields are nullable.
- Admission number and admission date continue to be supplied by the admission form.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS student_name_prefix text,
  ADD COLUMN IF NOT EXISTS father_name_prefix text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS last_school text,
  ADD COLUMN IF NOT EXISTS last_class text,
  ADD COLUMN IF NOT EXISTS subject_group text,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS student_form_b text,
  ADD COLUMN IF NOT EXISTS assigned_subjects text,
  ADD COLUMN IF NOT EXISTS photo_url text;
