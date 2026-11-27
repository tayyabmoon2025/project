/*
# Fee reversal balance accuracy

## Summary
Reversing a receipt (voiding a fee payment) must put the student's balance back to
exactly what it would have been if that receipt had never been recorded. The
previous version of `void_fee_payment` added the full receipt amount back onto the
balance. That is wrong whenever the original receipt did not reduce the balance by
its full amount, which happens when a student had already overpaid:

  - balance before receipt: 0.00
  - receipt recorded: 250.00  -> balance stays 0.00 (recording never lets a
    balance fall below zero, so an overpayment is not stored as a negative balance)
  - receipt reversed: balance became 250.00  (WRONG - it should return to 0.00)

The same over-credit could appear whenever the student's balance was changed by
another route (an admin adjusting the account directly) between the receipt and its
reversal.

## What changes
1. Modified function: `public.void_fee_payment(p_payment_id uuid, p_reason text)`
   - The amount put back is now `least(receipt amount, current balance)`, so a
     reversal can only ever undo balance the receipt actually removed. The balance
     can never be pushed above what the student truly owes.
   - The function still requires a reason, still refuses to reverse a receipt twice,
     still keeps the original receipt row (marks it void, never deletes it), and
     still recalculates the challan status from the receipts that remain live.
   - A ledger entry (`school_fee_transactions`, kind `reversal`) is written only when
     money actually moved. The ledger requires a positive amount, and a reversal of a
     receipt that removed no balance moves nothing, so writing a zero row would be
     both impossible and misleading. The reversal is still fully recorded on the
     receipt itself via `voided`, `voided_at`, `voided_by` and `void_reason`.
   - The returned JSON now also reports how much was put back (`restored`) and how
     much of the receipt amount was not balance-related (`not_restored`), so the
     screen can explain the difference instead of silently showing a smaller number.

## Security
- Unchanged: the function is SECURITY DEFINER with a fixed `search_path`, is refused
  unless the caller is fee staff (admin, accountant or office assistant), and EXECUTE
  stays revoked from PUBLIC and anon and granted only to authenticated.
- No tables, columns, policies or grants are added or removed by this migration.

## Notes
- Receipts are still never deleted: only `voided`, `voided_at`, `voided_by` and
  `void_reason` are set on the existing row.
- Safe to re-run (CREATE OR REPLACE only).
*/

CREATE OR REPLACE FUNCTION public.void_fee_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.school_fee_payments%ROWTYPE;
  v_reason text;
  v_balance numeric(10,2);
  v_restore numeric(10,2);
  v_new_balance numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reverse a payment';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'That reason is too long';
  END IF;

  SELECT * INTO v_payment FROM public.school_fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That payment no longer exists';
  END IF;
  IF v_payment.voided THEN
    RAISE EXCEPTION 'That payment has already been reversed';
  END IF;

  UPDATE public.school_fee_payments
  SET voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  WHERE id = v_payment.id;

  SELECT coalesce(fee_balance, 0) INTO v_balance
  FROM public.school_students WHERE id = v_payment.student_id FOR UPDATE;

  -- Only undo the balance this receipt actually removed. A receipt recorded against
  -- an already-cleared or overpaid account removed nothing, so reversing it restores
  -- nothing; otherwise the balance would climb above what the student owes.
  v_restore := least(coalesce(v_payment.amount, 0), greatest(coalesce(v_balance, 0), 0));
  v_new_balance := coalesce(v_balance, 0) + v_restore;

  IF v_restore > 0 THEN
    INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
    VALUES (v_payment.student_id, 'reversal', v_restore, v_new_balance);

    UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_payment.student_id;
  END IF;

  IF v_payment.challan_id IS NOT NULL THEN
    SELECT coalesce(sum(amount), 0) INTO v_paid
    FROM public.school_fee_payments
    WHERE challan_id = v_payment.challan_id AND voided = false;

    v_status := CASE
      WHEN v_paid >= coalesce((SELECT total FROM public.school_fee_challans WHERE id = v_payment.challan_id), 0) THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END;
    UPDATE public.school_fee_challans SET status = v_status WHERE id = v_payment.challan_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'amount', v_payment.amount,
    'restored', v_restore,
    'not_restored', greatest(coalesce(v_payment.amount, 0) - v_restore, 0),
    'balance_after', v_new_balance,
    'reason', v_reason
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.void_fee_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_fee_payment(uuid, text) TO authenticated;
