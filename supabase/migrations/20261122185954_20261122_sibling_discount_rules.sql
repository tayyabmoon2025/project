/*
# Sibling discount rules and the sibling discount recorded on a student

## 1. Purpose
A family with more than one child on the roll gets a sibling discount. The school
needs to decide those percentages once, and every new admission should pick the
right one up automatically from the family group it belongs to (the same groups the
Brother & Sister tab already shows). The percentage actually granted is also stored
on the student so the record explains itself later.

## 2. New Tables
- `school_fee_discount_rules` — one row per "child number" in a family.
  - `id` (uuid, primary key)
  - `sibling_order` (integer, unique, not null) — which child this rate is for.
    Starts at 2, because the first child in a family gets no sibling discount.
  - `discount_percentage` (numeric(5,2), not null) — the tuition fee percentage
    taken off for that child, e.g. 10.00 for 10%.
  - `label` (text, nullable) — a plain-English name for the rule, e.g. "Second child".
  - `updated_at` (timestamptz, not null, default now())
  - Constraints: `sibling_order` between 2 and 20; `discount_percentage` between 0 and 100.

## 3. Seeded Rows
Three sensible starting rules are inserted, matching the usual school practice:
second child 10%, third child 15%, fourth child onwards 20%. These are a starting
point only — the office can change the percentages at any time, and re-running this
migration will not overwrite edited values.

## 4. Modified Tables
- `school_students`
  - `sibling_discount_percentage` (numeric(5,2), nullable) — the sibling discount
    percentage granted to this student, so the concession on their record can be
    traced back to a sibling rule. Null means no sibling discount applied.

## 5. Security
- RLS is enabled on `school_fee_discount_rules`.
- Fee staff (`is_fee_staff()`) may read the rules, because the admission form and
  the fee screens need them.
- Only administrators (`is_admin()`) may insert, update or delete a rule — these
  percentages decide how much money the school collects, so they are not
  self-service for every staff member.
- Four separate policies, one per verb, and no `FOR ALL`.
- Grants: SELECT, INSERT, UPDATE, DELETE to `authenticated`, matching the roles the
  policies target. No sequence grant is needed because the key is a uuid.
- `school_students` keeps its existing policies and grants; the new column inherits
  them.

## 6. Notes
- Additive only: a new table, three seed rows, and one nullable column. No existing
  column, row or policy is changed or removed, so nothing already built breaks.
- `sibling_order` is unique, so a percentage cannot be recorded twice for the same
  child number; the seed uses ON CONFLICT DO NOTHING to stay safe to re-run.
*/

CREATE TABLE IF NOT EXISTS public.school_fee_discount_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sibling_order integer NOT NULL,
  discount_percentage numeric(5,2) NOT NULL,
  label text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_fee_discount_rules_order_check CHECK (sibling_order >= 2 AND sibling_order <= 20),
  CONSTRAINT school_fee_discount_rules_percentage_check CHECK (discount_percentage >= 0 AND discount_percentage <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_fee_discount_rules_order_key
  ON public.school_fee_discount_rules (sibling_order);

ALTER TABLE public.school_fee_discount_rules ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_fee_discount_rules TO authenticated;

DROP POLICY IF EXISTS "school_fee_discount_rules_select_staff" ON public.school_fee_discount_rules;
CREATE POLICY "school_fee_discount_rules_select_staff"
ON public.school_fee_discount_rules FOR SELECT
TO authenticated
USING (public.is_fee_staff());

DROP POLICY IF EXISTS "school_fee_discount_rules_insert_admin" ON public.school_fee_discount_rules;
CREATE POLICY "school_fee_discount_rules_insert_admin"
ON public.school_fee_discount_rules FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "school_fee_discount_rules_update_admin" ON public.school_fee_discount_rules;
CREATE POLICY "school_fee_discount_rules_update_admin"
ON public.school_fee_discount_rules FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "school_fee_discount_rules_delete_admin" ON public.school_fee_discount_rules;
CREATE POLICY "school_fee_discount_rules_delete_admin"
ON public.school_fee_discount_rules FOR DELETE
TO authenticated
USING (public.is_admin());

INSERT INTO public.school_fee_discount_rules (sibling_order, discount_percentage, label)
VALUES
  (2, 10, 'Second child'),
  (3, 15, 'Third child'),
  (4, 20, 'Fourth child onwards')
ON CONFLICT (sibling_order) DO NOTHING;

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS sibling_discount_percentage numeric(5,2);

COMMENT ON COLUMN public.school_students.sibling_discount_percentage IS
  'The sibling discount percentage granted to this student, taken from the family group they belong to. Null means no sibling discount was applied.';
