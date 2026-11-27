/*
# Store the calculated actual (net) tuition fee on each student

1. Purpose
   The admission form's "Other Info" tab now works out the tuition fee a family
   actually pays each month: the class tuition fee from the Fee Structure, minus
   any concession recorded for that student. This migration stores that figure so
   it can be read back later without recalculating.

2. Modified Tables
- `school_students`
  - `net_tuition_fee` (numeric(12,2), nullable) — the tuition fee after the
    student's concession is deducted. It is derived only from `tuition_fee` and
    `fee_concession_amount`. It deliberately excludes lab, transport,
    admission/misc and exam fees, which belong to the challan, not to this
    admission-form figure.

3. Backfill
   Existing rows that already carry a tuition fee get their net figure filled in
   from `tuition_fee - fee_concession_amount`, never below zero. Rows with no
   tuition fee stay null. This only writes a derived value; no existing column
   is changed and no row is removed.

4. Security
   No policy or grant changes. `school_students` already carries table-level
   privileges for the roles its existing policies target, so the new column is
   covered by those existing grants and policies.

5. Notes
- Additive only: the column is nullable, so no existing insert or update breaks.
- The application writes this column on every student save, so it cannot drift
  from the tuition fee and concession it is calculated from.
*/

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS net_tuition_fee numeric(12,2);

COMMENT ON COLUMN school_students.net_tuition_fee IS
  'Monthly tuition fee after the student concession is deducted (tuition_fee - fee_concession_amount, minimum 0). Excludes lab, transport, admission/misc and exam fees.';

UPDATE school_students
SET net_tuition_fee = GREATEST(0, COALESCE(tuition_fee, 0) - COALESCE(fee_concession_amount, 0))
WHERE tuition_fee IS NOT NULL
  AND net_tuition_fee IS NULL;
