/*
# Class-off days (per class, per date)

## 1. Purpose
The School Assistant can mark one or more classes "off" on a chosen date — for an
exam day, a class trip, or any reason the office decides. A class that is off is
left out of that day's absentee alerts and WhatsApp SMS, so no parent receives an
absence message for a class that was not expected in school, while every other
class on that date is unaffected.

This is deliberately per class, not school-wide: a school-wide closure is already
handled by the school calendar (holiday / vacation / exam). This table records the
narrower case of one class being off while the rest of the school runs normally.

## 2. New table: `school_class_off_days`
One row per class per date.

| column | meaning |
| --- | --- |
| id | unique row id |
| off_date | the day the class is off |
| class_name | the class that is off (e.g. "Class 7") |
| note | optional reason shown to staff, e.g. "Annual exam" |
| created_at | when the row was created |
| created_by | the staff account that marked it |

- A unique key on `(off_date, class_name)` means a class can only be off once on a
  given date, so marking it again updates the one row instead of adding a duplicate.

## 3. Security
- Row level security is enabled.
- Every signed-in user may read the table, so the parent and student portals can
  show a class-off notice. This is intentionally shared school information.
- Only staff (`is_staff()`: admin, teacher, office assistant, accountant) may add,
  change or remove a class-off day. Four separate policies (one per verb), no
  `FOR ALL`.
- Table grants are issued in the same migration as the table.

## 4. Notes
- No existing table, column or row is changed.
- Safe to re-run: the table and its index use IF NOT EXISTS and the policies are
  dropped before being created.
*/

CREATE TABLE IF NOT EXISTS public.school_class_off_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  off_date date NOT NULL,
  class_name text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT school_class_off_days_unique UNIQUE (off_date, class_name)
);

CREATE INDEX IF NOT EXISTS school_class_off_days_date_idx ON public.school_class_off_days (off_date);

ALTER TABLE public.school_class_off_days ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_class_off_days TO authenticated;

DROP POLICY IF EXISTS "Class off days are readable by signed-in users" ON public.school_class_off_days;
CREATE POLICY "Class off days are readable by signed-in users"
ON public.school_class_off_days FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Staff can add class off days" ON public.school_class_off_days;
CREATE POLICY "Staff can add class off days"
ON public.school_class_off_days FOR INSERT
TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can change class off days" ON public.school_class_off_days;
CREATE POLICY "Staff can change class off days"
ON public.school_class_off_days FOR UPDATE
TO authenticated
USING (public.is_staff())
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can remove class off days" ON public.school_class_off_days;
CREATE POLICY "Staff can remove class off days"
ON public.school_class_off_days FOR DELETE
TO authenticated
USING (public.is_staff());
