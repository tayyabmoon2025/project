/*
# Add foreign key from school_half_day_leaves to school_students

## Purpose
The Half-Day Gate Pass Photo Gallery queries `school_half_day_leaves` with a
nested join `student:school_students(full_name, class_name, section_name)`.
PostgREST returned: "Could not find a relationship between
'school_half_day_leaves' and 'school_students' in the schema cache" because no
foreign key constraint linked the two tables. This migration adds that FK and
notifies PostgREST to reload its schema cache.

## Changes
1. Adds `ALTER TABLE school_half_day_leaves ADD CONSTRAINT ... FOREIGN KEY
   (student_id) REFERENCES school_students(id) ON DELETE CASCADE`.
2. Sends `NOTIFY pgrst, 'reload schema'` so the PostgREST schema cache picks up
   the new relationship immediately.

## Security
- No RLS, policy, or grant changes.
- The FK is data-integrity only; existing RLS policies on both tables still
  control row access.
*/

ALTER TABLE school_half_day_leaves
  DROP CONSTRAINT IF EXISTS school_half_day_leaves_student_id_fkey;

ALTER TABLE school_half_day_leaves
  ADD CONSTRAINT school_half_day_leaves_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES school_students(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
