/*
# School calendar policy: keep Sunday as the weekly off

1. Summary
- The `school_calendar_policy` table was seeded with all seven days marked as
  working days. The school's long-standing register treats Sunday as the weekly
  off, so the seeded row is corrected to Monday to Saturday.
- This keeps every existing attendance percentage, DMC figure and report
  unchanged until a staff member deliberately changes the working week.

2. Modified Tables
- `school_calendar_policy`
  - `working_days`: changed from `{0,1,2,3,4,5,6}` to `{1,2,3,4,5,6}` for the
    default row only (0 = Sunday in Postgres `date_part('dow')`).

3. Safety
- The update is guarded by `working_days = '{0,1,2,3,4,5,6}'`, so it only ever
  touches a row that still holds the untouched seeded value. A school that has
  already saved its own working week is left exactly as it is.
- No tables, columns or rows are created or removed. Nothing is dropped.
- Re-running this migration is a no-op.

4. Security
- No policy or grant changes. Access rules are unchanged from the migration that
  created the table: signed-in users may read the policy, admins may update it.
*/

UPDATE public.school_calendar_policy
SET working_days = '{1,2,3,4,5,6}',
    updated_at = now()
WHERE id = 'default'
  AND working_days = '{0,1,2,3,4,5,6}';
