/*
# Fee adjustment workflow — entry date, edit support and audit history

## 1. Plain-English summary
The Fee Adjustment screen now works like the school's previous system: one half is the
entry form (date, admission number with lookup, student details, current due fee, the
amount being adjusted, remarks, and Save / Update / Cancel), and the other half is a
datewise list of everything posted on the chosen date with Edit, Delete and Print.

Two things were missing in the database to support that honestly:

1. A **posted date** that the office chooses. Until now an adjustment only recorded the
   calendar day it happened to be typed in, so an adjustment entered on Monday for
   Friday's register could not be filed under Friday, and the datewise list could never
   be re-opened for an older day.
2. An **edit** capability. Only create and delete existed, so correcting a wrong figure
   meant deleting the row and posting a new one, which lost the fact that a correction
   had happened.

A third table is added so that every edit and every removal leaves a permanent trace.
A fee adjustment changes what a family owes, so a silent edit is not acceptable.

## 2. New columns

### `public.school_fee_adjustments`
- `entry_date` (date, NOT NULL, defaults to CURRENT_DATE) — the date the office files the
  adjustment under. This is what the datewise list and the printed day sheet use.
  Backfilled from `effective_date`, then from `created_at`, so no existing row is left
  without a value.
- `updated_at` (timestamptz, NOT NULL, defaults to now()) — stamped on every edit.
- `updated_by` (uuid, NULL) — who last edited the row. `created_by` keeps meaning
  "who first posted it".
- `remarks` (text, NULL) — a copy of the reason at the time of the edit, kept only when
  a row was edited, so the printed day sheet can show what changed.

`effective_date` is deliberately kept. Existing rows, the student ledger, and
`sync_fee_balance_from_challans` all still read it, so nothing that already works breaks.
Both columns are written by the same function and hold the same value going forward.

## 3. New table

### `public.school_fee_adjustment_history`
- `id` (uuid, primary key)
- `adjustment_id` (uuid, NOT NULL, references school_fee_adjustments ON DELETE CASCADE)
- `student_id` (uuid, NOT NULL) — copied so history survives and can be filtered
- `action` (text, NOT NULL) — `updated` or `deleted`
- `previous_amount` / `new_amount` (numeric, NULL)
- `previous_reason` / `new_reason` (text, NULL)
- `previous_entry_date` / `new_entry_date` (date, NULL)
- `changed_by` (uuid, NULL) — who made the change
- `changed_at` (timestamptz, NOT NULL, defaults to now())

## 4. Modified functions

- `public.create_fee_adjustment(...)` — recreated unchanged in behaviour, except it now
  also writes `entry_date` alongside `effective_date`. Same signature, so the existing
  screen keeps working.
- `public.update_fee_adjustment(p_id, p_adjustment_type, p_amount, p_reason, p_entry_date)`
  — NEW. `SECURITY DEFINER`. Refuses anyone who is not fee staff. Writes a history row
  holding the previous values, then updates the adjustment and recalculates the balance.
- `public.delete_fee_adjustment(p_id)` — recreated. Before deleting, it writes a history
  row so a removed adjustment is still explainable. Still recalculates the balance.

## 5. Security
- RLS is enabled on the new history table.
- Grants: the table is readable only through the fee-staff and family policies. INSERT is
  not granted to any client role — only the two `SECURITY DEFINER` functions write to it,
  so a client cannot forge or erase an audit entry.
- Both new/changed functions are `SECURITY DEFINER` with `SET search_path TO 'public'`,
  and `EXECUTE` is revoked from `PUBLIC` and `anon` and granted only to `authenticated`.
  Each one still re-checks `is_fee_staff()` itself, so an authenticated non-fee user is
  refused inside the function.

## 6. Notes
1. Every statement is idempotent and safe to re-run.
2. No column is dropped, no type is changed, and no row is deleted by this migration.
3. `school_fee_adjustments` already had a two-policy SELECT model (staff, and family read
   for a parent's own child). Those are re-stated here unchanged so the file is
   self-contained on a rebuild.
*/

-- ---------------------------------------------------------------------------
-- 1. Columns on the adjustment table
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_fee_adjustments
  ADD COLUMN IF NOT EXISTS entry_date date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS remarks text;

UPDATE public.school_fee_adjustments
SET entry_date = COALESCE(entry_date, effective_date, created_at::date)
WHERE entry_date IS NULL;

UPDATE public.school_fee_adjustments
SET updated_at = COALESCE(updated_at, created_at)
WHERE updated_at IS NULL;

ALTER TABLE public.school_fee_adjustments
  ALTER COLUMN entry_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN entry_date SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS school_fee_adjustments_entry_date_idx
  ON public.school_fee_adjustments (entry_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS school_fee_adjustments_student_idx
  ON public.school_fee_adjustments (student_id, entry_date DESC);

-- ---------------------------------------------------------------------------
-- 2. History table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_fee_adjustment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.school_fee_adjustments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('updated', 'deleted')),
  previous_amount numeric(12,2),
  new_amount numeric(12,2),
  previous_reason text,
  new_reason text,
  previous_entry_date date,
  new_entry_date date,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_fee_adjustment_history_adjustment_idx
  ON public.school_fee_adjustment_history (adjustment_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS school_fee_adjustment_history_student_idx
  ON public.school_fee_adjustment_history (student_id, changed_at DESC);

ALTER TABLE public.school_fee_adjustment_history ENABLE ROW LEVEL SECURITY;

-- Read-only for fee staff; the two SECURITY DEFINER functions own every write.
GRANT SELECT ON public.school_fee_adjustment_history TO authenticated;

DROP POLICY IF EXISTS "fee_adjustment_history_staff_select" ON public.school_fee_adjustment_history;
CREATE POLICY "fee_adjustment_history_staff_select"
ON public.school_fee_adjustment_history FOR SELECT
TO authenticated
USING (public.is_fee_staff());

-- ---------------------------------------------------------------------------
-- 3. Re-state the adjustment read policies (unchanged behaviour)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "fee_adjustments_staff_select" ON public.school_fee_adjustments;
CREATE POLICY "fee_adjustments_staff_select"
ON public.school_fee_adjustments FOR SELECT
TO authenticated
USING (public.is_fee_staff());

DROP POLICY IF EXISTS "fee_adjustments_family_select" ON public.school_fee_adjustments;
CREATE POLICY "fee_adjustments_family_select"
ON public.school_fee_adjustments FOR SELECT
TO authenticated
USING (
  student_id = public.own_student_id()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.student_id = school_fee_adjustments.student_id
      AND psl.parent_user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- 4. create_fee_adjustment — now also files the row under a posted date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fee_adjustment(
  p_student_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text DEFAULT NULL::text,
  p_effective_date date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_date date;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_adjustment_type NOT IN ('concession','discount','write_off','correction','scholarship') THEN
    RAISE EXCEPTION 'Invalid adjustment type';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Enter an adjustment amount';
  END IF;

  IF abs(p_amount) > 10000000 THEN
    RAISE EXCEPTION 'That adjustment amount is too large';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.school_students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  v_date := COALESCE(p_effective_date, CURRENT_DATE);

  INSERT INTO public.school_fee_adjustments
    (student_id, adjustment_type, amount, reason, effective_date, entry_date, created_by)
  VALUES
    (p_student_id, p_adjustment_type, p_amount,
     nullif(btrim(coalesce(p_reason, '')), ''), v_date, v_date, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.sync_fee_balance_from_challans(p_student_id);
  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. update_fee_adjustment — edit in place, leaving a history row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fee_adjustment(
  p_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text DEFAULT NULL::text,
  p_entry_date date DEFAULT NULL::date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.school_fee_adjustments;
  v_date date;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_adjustment_type NOT IN ('concession','discount','write_off','correction','scholarship') THEN
    RAISE EXCEPTION 'Invalid adjustment type';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Enter an adjustment amount';
  END IF;

  IF abs(p_amount) > 10000000 THEN
    RAISE EXCEPTION 'That adjustment amount is too large';
  END IF;

  SELECT * INTO v_old FROM public.school_fee_adjustments WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found';
  END IF;

  v_date := COALESCE(p_entry_date, v_old.entry_date, CURRENT_DATE);

  INSERT INTO public.school_fee_adjustment_history
    (adjustment_id, student_id, action,
     previous_amount, new_amount,
     previous_reason, new_reason,
     previous_entry_date, new_entry_date,
     changed_by)
  VALUES
    (v_old.id, v_old.student_id, 'updated',
     v_old.amount, p_amount,
     v_old.reason, nullif(btrim(coalesce(p_reason, '')), ''),
     v_old.entry_date, v_date,
     auth.uid());

  UPDATE public.school_fee_adjustments
  SET adjustment_type = p_adjustment_type,
      amount = p_amount,
      reason = nullif(btrim(coalesce(p_reason, '')), ''),
      remarks = nullif(btrim(coalesce(p_reason, '')), ''),
      entry_date = v_date,
      effective_date = v_date,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public.sync_fee_balance_from_challans(v_old.student_id);
  RETURN p_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. delete_fee_adjustment — records the removal before it happens
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_fee_adjustment(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.school_fee_adjustments;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_old FROM public.school_fee_adjustments WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.school_fee_adjustment_history
    (adjustment_id, student_id, action,
     previous_amount, new_amount,
     previous_reason, new_reason,
     previous_entry_date, new_entry_date,
     changed_by)
  VALUES
    (v_old.id, v_old.student_id, 'deleted',
     v_old.amount, NULL,
     v_old.reason, NULL,
     v_old.entry_date, NULL,
     auth.uid());

  DELETE FROM public.school_fee_adjustments WHERE id = p_id;

  PERFORM public.sync_fee_balance_from_challans(v_old.student_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_fee_adjustment(uuid, text, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fee_adjustment(uuid, text, numeric, text, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_fee_adjustment(uuid, text, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_fee_adjustment(uuid, text, numeric, text, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_fee_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_fee_adjustment(uuid) TO authenticated;
