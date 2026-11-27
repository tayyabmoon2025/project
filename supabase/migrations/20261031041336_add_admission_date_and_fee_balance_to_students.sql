/*
# Add admission date and fee balance to students

1. Modified Tables
- `school_students`
  - `admission_date` (date, defaults to today): the date the student was admitted.
  - `fee_balance` (numeric(10,2), defaults to 0, never negative): the amount the student still owes.

2. Security
- No policy or grant changes. Existing access rules on the table continue to apply.

3. Important Notes
- Existing student rows receive today's date as their admission date and a zero fee balance.
- No data is removed or changed.
*/

ALTER TABLE school_students ADD COLUMN IF NOT EXISTS admission_date date NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE school_students ADD COLUMN IF NOT EXISTS fee_balance numeric(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_students_fee_balance_non_negative'
  ) THEN
    ALTER TABLE school_students ADD CONSTRAINT school_students_fee_balance_non_negative CHECK (fee_balance >= 0);
  END IF;
END $$;
