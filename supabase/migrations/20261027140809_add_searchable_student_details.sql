/*
# Add searchable student details

1. Purpose
- Expands the single-school student roster so the Search Student module can search real records instead of placeholder-only fields.

2. New Columns on `school_students`
- `fathers_name` stores the father’s full name.
- `fathers_cnic` stores the father’s national identity number when supplied by the school.
- `roll_number` stores the classroom roll number.
- `mother_number` stores the mother’s contact number.
- `religion`, `house`, `student_group`, `area`, `mother_tongue`, and `nationality` store optional student profile details.
- `data_source` identifies whether a record belongs to the current session or archive.
- `clearance_status` tracks whether the student is cleared or not clear.

3. Security
- Existing row level security and single-school anon/authenticated CRUD policies remain in effect.
- No new table or role is introduced.

4. Important Notes
- All new profile details are optional so existing student records continue to work.
- Search indexes are added for admission number, roll number, and frequently searched names.
- Existing records are marked as current-session and cleared to provide sensible initial filter results.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS fathers_name text,
  ADD COLUMN IF NOT EXISTS fathers_cnic text,
  ADD COLUMN IF NOT EXISTS roll_number text,
  ADD COLUMN IF NOT EXISTS mother_number text,
  ADD COLUMN IF NOT EXISTS religion text,
  ADD COLUMN IF NOT EXISTS house text,
  ADD COLUMN IF NOT EXISTS student_group text,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS mother_tongue text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'current_session',
  ADD COLUMN IF NOT EXISTS clearance_status text NOT NULL DEFAULT 'cleared';

UPDATE public.school_students
SET data_source = COALESCE(data_source, 'current_session'),
    clearance_status = COALESCE(clearance_status, 'cleared')
WHERE data_source IS NULL OR clearance_status IS NULL;

CREATE INDEX IF NOT EXISTS school_students_admission_number_idx ON public.school_students (admission_number);
CREATE INDEX IF NOT EXISTS school_students_roll_number_idx ON public.school_students (roll_number);
CREATE INDEX IF NOT EXISTS school_students_fathers_name_idx ON public.school_students (fathers_name);
CREATE INDEX IF NOT EXISTS school_students_data_source_idx ON public.school_students (data_source);
CREATE INDEX IF NOT EXISTS school_students_clearance_status_idx ON public.school_students (clearance_status);