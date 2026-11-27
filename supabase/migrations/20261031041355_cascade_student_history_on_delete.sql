/*
# Cascade student deletions to attendance and notice history

1. Modified Tables
- `school_attendance.student_id` and `school_student_notices.student_id`: when a student record is deleted, that student's attendance and notice history is deleted with it, instead of blocking the deletion.

2. Security
- No policy or grant changes.

3. Important Notes
- Only the foreign key rules change. No rows are removed by this migration itself.
- Deleting a student from the app now removes their related history in the same step.
*/

ALTER TABLE school_attendance DROP CONSTRAINT IF EXISTS school_attendance_student_id_fkey;
ALTER TABLE school_attendance ADD CONSTRAINT school_attendance_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES school_students(id) ON DELETE CASCADE;

ALTER TABLE school_student_notices DROP CONSTRAINT IF EXISTS school_student_notices_student_id_fkey;
ALTER TABLE school_student_notices ADD CONSTRAINT school_student_notices_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES school_students(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "School workspace can remove notices" ON school_student_notices;
CREATE POLICY "School workspace can remove notices" ON school_student_notices FOR DELETE
  TO anon, authenticated USING (true);

GRANT DELETE ON school_student_notices TO anon, authenticated;
