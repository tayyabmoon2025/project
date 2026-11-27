/*
# Fee Management sub-tabs: adjustments and opening balance

## 1. Purpose
Adds the two data pieces the new Fee Management sub-tabs need — a per-student
opening balance (arrears brought forward) and a fee adjustments ledger (concession,
discount, write-off, correction, scholarship) — and folds both into the student's
running fee balance so every existing screen keeps showing the correct amount owed.

## 2. New table
### `school_fee_adjustments`
- `id` (uuid, primary key)
- `student_id` (uuid, references school_students, cascade delete)
- `adjustment_type` (text: concession | discount | write_off | correction | scholarship)
- `amount` (numeric, SIGNED — a negative value reduces what the family owes, a
  positive value increases it)
- `reason` (text, optional note)
- `effective_date` (date, defaults to today)
- `created_by` (uuid, the signed-in staff account)
- `created_at` (timestamptz)

## 3. New columns on `school_students`
- `fee_opening_balance` (numeric, default 0) — dues carried forward from before
  this system, added on top of the challan-based balance.
- `fee_opening_balance_date` (date) — the date that opening balance is as of.

## 4. Modified function
`sync_fee_balance_from_challans` now computes the balance as:
opening balance + unpaid challan totals − challan-linked receipts + adjustments.
With no opening balances and no adjustments set, every existing balance is
unchanged, so this is fully additive.

## 5. Security
- RLS enabled on `school_fee_adjustments`.
- SELECT for fee staff (admin, accountant, office_assistant) and for the student /
  their linked parents, matching how challans are protected.
- No direct INSERT / UPDATE / DELETE grant to authenticated: writes go through the
  SECURITY DEFINER functions below, which check the caller is fee staff.
- New functions are SECURITY DEFINER with a fixed search_path; EXECUTE is revoked
  from PUBLIC and anon and granted to authenticated.

## 6. Notes
- Nothing is deleted from existing fee data. Adjustments are append-only rows; a
  mistaken adjustment is removed by id through its own function.
*/

-- 1. New columns on students ------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='school_students'
                 AND column_name='fee_opening_balance') THEN
    ALTER TABLE public.school_students ADD COLUMN fee_opening_balance numeric(12,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='school_students'
                 AND column_name='fee_opening_balance_date') THEN
    ALTER TABLE public.school_students ADD COLUMN fee_opening_balance_date date;
  END IF;
END $$;

-- 2. Adjustments table ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_fee_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('concession','discount','write_off','correction','scholarship')),
  amount numeric(12,2) NOT NULL,
  reason text,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_fee_adjustments_student_idx
  ON public.school_fee_adjustments (student_id, effective_date DESC);

ALTER TABLE public.school_fee_adjustments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_fee_adjustments TO authenticated;
GRANT ALL ON public.school_fee_adjustments TO service_role;

DROP POLICY IF EXISTS "fee_adjustments_staff_select" ON public.school_fee_adjustments;
CREATE POLICY "fee_adjustments_staff_select" ON public.school_fee_adjustments
  FOR SELECT TO authenticated
  USING (public.is_fee_staff());

DROP POLICY IF EXISTS "fee_adjustments_family_select" ON public.school_fee_adjustments;
CREATE POLICY "fee_adjustments_family_select" ON public.school_fee_adjustments
  FOR SELECT TO authenticated
  USING (
    student_id = public.own_student_id()
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_fee_adjustments.student_id
    )
  );

-- 3. Fold opening balance and adjustments into the running balance -----------
CREATE OR REPLACE FUNCTION public.sync_fee_balance_from_challans(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_challan_total numeric(12,2);
  v_paid numeric(12,2);
  v_opening numeric(12,2);
  v_adjustments numeric(12,2);
  v_owes numeric(12,2);
BEGIN
  -- Total still owed across this student's challans that are not fully paid.
  SELECT
    coalesce(sum(
      CASE
        WHEN c.status = 'paid' THEN 0
        ELSE greatest(coalesce(c.total, 0), 0)
      END
    ), 0)
  INTO v_challan_total
  FROM public.school_fee_challans c
  WHERE c.student_id = p_student_id;

  -- Money already received against those challans (non-voided receipts only).
  SELECT coalesce(sum(p.amount), 0)
  INTO v_paid
  FROM public.school_fee_payments p
  WHERE p.student_id = p_student_id
    AND p.voided = false
    AND p.challan_id IS NOT NULL;

  -- Dues carried forward plus any adjustments (a negative adjustment reduces dues).
  SELECT coalesce(fee_opening_balance, 0) INTO v_opening
  FROM public.school_students WHERE id = p_student_id;

  SELECT coalesce(sum(a.amount), 0) INTO v_adjustments
  FROM public.school_fee_adjustments a
  WHERE a.student_id = p_student_id;

  v_owes := greatest(0, coalesce(v_opening, 0) + v_challan_total - v_paid + coalesce(v_adjustments, 0));

  UPDATE public.school_students
  SET fee_balance = v_owes
  WHERE id = p_student_id;
END;
$function$;

-- 4. Privileged mutations ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fee_adjustment(
  p_student_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text DEFAULT NULL,
  p_effective_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
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

  INSERT INTO public.school_fee_adjustments (student_id, adjustment_type, amount, reason, effective_date, created_by)
  VALUES (p_student_id, p_adjustment_type, p_amount, nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_effective_date, CURRENT_DATE), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.sync_fee_balance_from_challans(p_student_id);
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_fee_adjustment(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student uuid;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.school_fee_adjustments WHERE id = p_id RETURNING student_id INTO v_student;

  IF v_student IS NOT NULL THEN
    PERFORM public.sync_fee_balance_from_challans(v_student);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_fee_opening_balance(
  p_student_id uuid,
  p_amount numeric,
  p_as_of date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 10000000 THEN
    RAISE EXCEPTION 'Enter a valid opening balance';
  END IF;

  UPDATE public.school_students
  SET fee_opening_balance = p_amount,
      fee_opening_balance_date = CASE WHEN p_amount > 0 THEN coalesce(p_as_of, CURRENT_DATE) ELSE NULL END
  WHERE id = p_student_id;

  PERFORM public.sync_fee_balance_from_challans(p_student_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_fee_adjustment(uuid, text, numeric, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_fee_adjustment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_fee_opening_balance(uuid, numeric, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_fee_adjustment(uuid, text, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_fee_adjustment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_fee_opening_balance(uuid, numeric, date) TO authenticated;
