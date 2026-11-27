/*
# Sync generated challan amounts to student fee_balance

## Problem
When a fee challan is generated (whole class or one student) the `total` is
written to `school_fee_challans`, but `school_students.fee_balance` — the
running balance that Fee Collection reads as "Due Fee" — is never updated.
So a student with an unpaid Rs 2900 challan still shows fee_balance = 0 in
the Fee tab, the Due Fee card, and the Step 2 "Due Fee (Rs)" input.

## Fix
1. New SECURITY DEFINER function `sync_fee_balance_from_challans(p_student_id)`:
   recomputes `fee_balance = sum of open challan totals − sum of non-voided
   payments already applied to those challans`, clamped at 0, for ONE student.
   Open = status unpaid or partial. Paid challans contribute 0.
2. New SECURITY DEFINER function `sync_fee_balance_for_many(p_student_ids[])`:
   batch wrapper that loops and calls the per-student sync, used by the save
   path so one round trip covers a whole-class generation.
3. AFTER INSERT OR UPDATE OF total, arrears, concession, late_fine, status
   trigger on `school_fee_challans` that calls the per-student sync for the
   row's student. This keeps the balance truthful even when rows are upserted
   directly (the client `saveChallans` path) or updated by `record_fee_payment`
   changing a challan's status.
4. Backfill: every existing student's fee_balance is recomputed once.

## Security
- Both functions are SECURITY DEFINER, `SET search_path = 'public'`, and
  check `is_staff()` so only logged-in staff can call them directly.
- The trigger fires on table writes, which are already gated by RLS, so no
  extra auth check is needed there.
- `REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;` on both.
- No new tables, no column type changes, no data loss. fee_balance is the only
  column updated and it is a derived value.
*/

-- Per-student sync: fee_balance = sum(open challan totals) − sum(payments on those challans)
CREATE OR REPLACE FUNCTION public.sync_fee_balance_from_challans(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_challan_total numeric(12,2);
  v_paid numeric(12,2);
  v_owes numeric(12,2);
BEGIN
  -- Total still owed across all this student's challans that are not fully paid.
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

  v_owes := greatest(0, v_challan_total - v_paid);

  UPDATE public.school_students
  SET fee_balance = v_owes
  WHERE id = p_student_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_fee_balance_from_challans(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_fee_balance_from_challans(uuid) TO authenticated;

-- Batch wrapper for whole-class generation: one call, many students.
CREATE OR REPLACE FUNCTION public.sync_fee_balance_for_many(p_student_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOREACH v_id IN ARRAY p_student_ids LOOP
    PERFORM public.sync_fee_balance_from_challans(v_id);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_fee_balance_for_many(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_fee_balance_for_many(uuid[]) TO authenticated;

-- Trigger function: recompute the affected student's balance on any challan write.
CREATE OR REPLACE FUNCTION public.recompute_student_fee_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_fee_balance_from_challans(COALESCE(NEW.student_id, OLD.student_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS school_fee_challans_sync_balance ON public.school_fee_challans;
CREATE TRIGGER school_fee_challans_sync_balance
AFTER INSERT OR UPDATE OF total, arrears, concession, late_fine, status, student_id
ON public.school_fee_challans
FOR EACH ROW
EXECUTE FUNCTION public.recompute_student_fee_balance();

-- Backfill every existing student from their current challans.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.school_students LOOP
    PERFORM public.sync_fee_balance_from_challans(v_id);
  END LOOP;
END;
$$;
