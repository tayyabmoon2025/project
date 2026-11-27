/*
# Keep one DMC record per student and period

## Summary
Adds a unique index so a student can hold only one Detailed Marks Certificate
row for a given date range. Re-generating a certificate for the same range
updates the existing row instead of creating a duplicate, which is what the
"Save DMC" action in the app relies on.

## 1. Modified tables
- `school_dmc_records`: new unique index on (student_id, period_start, period_end).
  No columns are added, changed or removed, and no rows are touched.

## 2. Notes
- The index is created with IF NOT EXISTS so re-running is safe.
- Rows where the period is empty are still allowed to repeat, which keeps
  partially filled drafts usable.
*/

CREATE UNIQUE INDEX IF NOT EXISTS school_dmc_records_period_key
  ON school_dmc_records (student_id, period_start, period_end);
