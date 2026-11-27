/*
# Link other information entries to students

1. Modified Table
- `school_other_information` gains `student_id` (uuid), which points to the student the entry belongs to.
- Entries with no student (general notes) keep `student_id` empty.
- Deleting a student also deletes their other information entries.

2. Security
- No change to access rules. Existing policies on `school_other_information` already cover the new column.

3. Important notes
- The column is added with IF NOT EXISTS, so re-running this migration is safe.
- An index on `student_id` keeps per-student lookups fast.
*/

ALTER TABLE public.school_other_information
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.school_students(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS school_other_information_student_id_idx ON public.school_other_information (student_id);
