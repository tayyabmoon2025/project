-- # Concession categories on student records and posted adjustments
--
-- ## What this adds
--
-- - `school_students.fee_concession_category` — the named category a student's standing
--   reduction belongs to (orphan, scholarship, staff, standing concession, discount,
--   write-off, other). The amount itself keeps living in the existing
--   `fee_concession_amount` / `fee_concession_percentage` columns, so every challan,
--   ledger and report that already reads them needs no change. This column only names
--   the reduction, which is what lets the Fee Concessions & Discounts report file it
--   under the right category instead of a generic "concession on record".
--
-- - `school_fee_adjustments.category` — the category the office picked when posting a
--   reduction, so a discount, scholarship or write-off is reported under the category
--   chosen rather than guessed at from the wording of the remark.
--
-- - `school_fee_adjustment_history.new_category` — the category at the time of an edit,
--   kept alongside the previous amount and reason so an edit stays auditable.
--
-- ## Why the functions are recreated
--
-- `create_fee_adjustment` and `update_fee_adjustment` gain a `p_category` parameter. The
-- old five-argument versions are dropped first, because a five-argument defaulted
-- overload alongside the new six-argument one would make an RPC call with five arguments
-- ambiguous. Both keep their `is_fee_staff()` guard and reject an unknown category.
--
-- ## Grants
--
-- No table grants change: `school_students` already carries table-level INSERT/UPDATE for
-- staff, and the two new adjustment columns inherit the existing adjustment grants. Both
-- functions keep EXECUTE for `authenticated` only.

-- ---------------------------------------------------------------------------
-- 1. The new columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS fee_concession_category text;

ALTER TABLE public.school_fee_adjustments
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.school_fee_adjustment_history
  ADD COLUMN IF NOT EXISTS new_category text;

COMMENT ON COLUMN public.school_students.fee_concession_category IS
  'Named category of the student''s standing reduction: sibling, orphan, scholarship, staff, concession, discount, write_off or other.';
COMMENT ON COLUMN public.school_fee_adjustments.category IS
  'Category the reduction was filed under when posted, used by the Fee Concessions & Discounts report.';

-- ---------------------------------------------------------------------------
-- 2. create_fee_adjustment — now files the row under a category
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_fee_adjustment(uuid, text, numeric, text, date);

CREATE OR REPLACE FUNCTION public.create_fee_adjustment(
  p_student_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text DEFAULT NULL::text,
  p_effective_date date DEFAULT NULL::date,
  p_category text DEFAULT NULL::text
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

  IF p_category IS NOT NULL AND btrim(p_category) <> ''
     AND p_category NOT IN ('sibling','orphan','scholarship','staff','concession','discount','write_off','other') THEN
    RAISE EXCEPTION 'Invalid concession category';
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
    (student_id, adjustment_type, amount, reason, category, effective_date, entry_date, created_by)
  VALUES
    (p_student_id, p_adjustment_type, p_amount,
     nullif(btrim(coalesce(p_reason, '')), ''),
     nullif(btrim(coalesce(p_category, '')), ''),
     v_date, v_date, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.sync_fee_balance_from_challans(p_student_id);
  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_fee_adjustment(uuid, text, numeric, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_fee_adjustment(uuid, text, numeric, text, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. update_fee_adjustment — edit in place, leaving a history row
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_fee_adjustment(uuid, text, numeric, text, date);

CREATE OR REPLACE FUNCTION public.update_fee_adjustment(
  p_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text DEFAULT NULL::text,
  p_entry_date date DEFAULT NULL::date,
  p_category text DEFAULT NULL::text
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

  IF p_category IS NOT NULL AND btrim(p_category) <> ''
     AND p_category NOT IN ('sibling','orphan','scholarship','staff','concession','discount','write_off','other') THEN
    RAISE EXCEPTION 'Invalid concession category';
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
     new_category,
     previous_entry_date, new_entry_date,
     changed_by)
  VALUES
    (v_old.id, v_old.student_id, 'updated',
     v_old.amount, p_amount,
     v_old.reason, nullif(btrim(coalesce(p_reason, '')), ''),
     nullif(btrim(coalesce(p_category, '')), ''),
     v_old.entry_date, v_date,
     auth.uid());

  UPDATE public.school_fee_adjustments
  SET adjustment_type = p_adjustment_type,
      amount = p_amount,
      reason = nullif(btrim(coalesce(p_reason, '')), ''),
      remarks = nullif(btrim(coalesce(p_reason, '')), ''),
      category = nullif(btrim(coalesce(p_category, '')), ''),
      entry_date = v_date,
      effective_date = v_date,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = p_id;

  PERFORM public.sync_fee_balance_from_challans(v_old.student_id);
  RETURN p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_fee_adjustment(uuid, text, numeric, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_fee_adjustment(uuid, text, numeric, text, date, text) TO authenticated;
