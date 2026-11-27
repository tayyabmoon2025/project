/*
# Remove unneeded notice delete permission

1. Modified Tables
- `school_student_notices`: removes the delete permission added in the previous migration.

2. Security
- Notice history can no longer be deleted directly by the app. It is still removed automatically when its student is deleted.

3. Important Notes
- No notice rows are changed by this migration.
*/

DROP POLICY IF EXISTS "School workspace can remove notices" ON school_student_notices;
REVOKE DELETE ON school_student_notices FROM anon, authenticated;
