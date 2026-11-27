/*
# Create student fee transaction history

1. Purpose
- Keeps a running log of every fee payment and charge recorded for a student, so staff can see how the balance got to where it is.

2. New Table
- `school_fee_transactions`
- `id` is the generated transaction identifier.
- `student_id` links each entry to a student in `school_students`.
- `kind` is either `payment` (money received) or `charge` (amount added to the balance).
- `amount` is the positive amount of the entry, stored with two decimal places.
- `balance_after` is the student's fee balance immediately after this entry.
- `created_at` records when the entry was made.

3. Security
- Row level security is enabled on the new table.
- This is a single-school workspace without a sign-in screen, so anon and authenticated receive only SELECT and INSERT access through explicit policies.
- No UPDATE or DELETE access is granted, so the history cannot be edited from the app.

4. Important Notes
- Deleting a student also removes that student's fee history, matching the other student history tables.
- Existing balances have no history entries; history starts from the first payment or charge recorded after this change.
*/

CREATE TABLE IF NOT EXISTS public.school_fee_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('payment', 'charge')),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  balance_after numeric(10,2) NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_fee_transactions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.school_fee_transactions TO anon, authenticated;

DROP POLICY IF EXISTS "School workspace can read fee transactions" ON public.school_fee_transactions;
CREATE POLICY "School workspace can read fee transactions" ON public.school_fee_transactions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "School workspace can record fee transactions" ON public.school_fee_transactions;
CREATE POLICY "School workspace can record fee transactions" ON public.school_fee_transactions FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS school_fee_transactions_student_id_idx ON public.school_fee_transactions (student_id, created_at DESC);
