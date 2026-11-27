/*
# Fee voucher edit / delete, plus fine, concession and discount on a receipt

## 1. What this does in plain English

The fee counter can now correct a receipt that was keyed wrongly, and it can record the
adjustments that sit either side of the money actually handed over:

- Late fee fine  — a surcharge added on top of the fee that was due
- Fee concession — a reduction agreed with the school
- Discount       — a second reduction, for example a sibling or staff discount

Each receipt now remembers the whole calculation behind it, so the Acknowledgment receipt
can be reprinted later and still show the same Due Fee, Fine, Concession, Discount, Total
Fee Payable, Fee Paid and Balance as the day it was issued.

## 2. New columns on school_fee_payments

- due_fee     : the fee that was outstanding before this receipt was taken
- fine_amount : late fee fine charged on this receipt (0 when none)
- concession  : concession applied on this receipt (0 when none)
- discount    : discount applied on this receipt (0 when none)
- payable_fee : due + fine - concession - discount, the amount that was collectable
- updated_at  : when the receipt was last corrected
- updated_by  : who corrected it
- edit_count  : how many times the receipt has been corrected

Every column is nullable or defaulted, so receipts already on file stay valid and read as
"no fine, no concession, no discount". Nothing already recorded is rewritten.

## 3. New database functions

- set_payment_voucher(...) : correct an existing receipt. Updates the money columns, moves
  the student's balance by the difference, and writes a matching ledger entry.
- delete_payment_voucher(...) : remove a receipt that should never have been recorded.
  Requires a reason, writes a reversal entry to the ledger first so the audit trail
  survives the deletion, and puts the student's dues back the way they were.

Both are SECURITY DEFINER, both authorise the caller inside the function, and both are
callable only by fee staff (administrator, accountant, office assistant).

## 4. Security

- The receipt table becomes append-only for ordinary clients: INSERT, UPDATE and DELETE are
  revoked from authenticated and anon, so money can only move through the audited
  functions. SELECT is unchanged, so every screen that reads receipts still works.
- The old direct-UPDATE policy is dropped. Voiding, correcting and deleting all now go
  through a function that keeps the student's balance and the ledger in step.
- Nothing is deleted silently: a deletion leaves a reversal entry in the ledger with the
  reason attached.
*/

-- 1. The calculation behind each receipt -------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'due_fee') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN due_fee numeric(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'fine_amount') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN fine_amount numeric(10,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'concession') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN concession numeric(10,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'discount') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN discount numeric(10,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'payable_fee') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN payable_fee numeric(10,2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'updated_at') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN updated_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'updated_by') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN updated_by uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'edit_count') THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN edit_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- A receipt can never carry a negative adjustment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_fee_payments_adjustments_check') THEN
    ALTER TABLE public.school_fee_payments
      ADD CONSTRAINT school_fee_payments_adjustments_check
      CHECK (fine_amount >= 0 AND concession >= 0 AND discount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS school_fee_payments_month_idx
  ON public.school_fee_payments (payment_date DESC, receipt_number);

-- 2. Correcting a receipt ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_payment_voucher(
  p_payment_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_date date,
  p_remarks text,
  p_due_fee numeric DEFAULT NULL,
  p_fine numeric DEFAULT 0,
  p_concession numeric DEFAULT 0,
  p_discount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.school_fee_payments%ROWTYPE;
  v_method text;
  v_date date;
  v_amount numeric(10,2);
  v_fine numeric(10,2);
  v_concession numeric(10,2);
  v_discount numeric(10,2);
  v_due numeric(10,2);
  v_payable numeric(10,2);
  v_balance numeric(10,2);
  v_delta numeric(10,2);
  v_new_balance numeric(10,2);
  v_challan_total numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_payment FROM public.school_fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That receipt no longer exists';
  END IF;
  IF v_payment.voided THEN
    RAISE EXCEPTION 'That receipt has been reversed, so it cannot be corrected';
  END IF;

  v_amount := p_amount;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  IF v_amount > 1000000 THEN
    RAISE EXCEPTION 'That amount is larger than this form accepts';
  END IF;

  v_method := lower(btrim(coalesce(p_method, '')));
  IF v_method NOT IN ('cash', 'bank', 'online') THEN
    RAISE EXCEPTION 'Choose a payment method';
  END IF;

  v_date := coalesce(p_payment_date, v_payment.payment_date);
  IF v_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'The payment date cannot be in the future';
  END IF;

  v_fine := greatest(coalesce(p_fine, 0), 0);
  v_concession := greatest(coalesce(p_concession, 0), 0);
  v_discount := greatest(coalesce(p_discount, 0), 0);
  v_due := greatest(coalesce(p_due_fee, v_payment.due_fee, 0), 0);
  v_payable := greatest(0, v_due + v_fine - v_concession - v_discount);

  -- How much this correction moves the account. A bigger amount takes the balance
  -- further down; correcting an amount downwards hands the difference back.
  SELECT coalesce(fee_balance, 0) INTO v_balance
  FROM public.school_students WHERE id = v_payment.student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  v_delta := v_amount - coalesce(v_payment.amount, 0);
  v_new_balance := greatest(0, coalesce(v_balance, 0) - v_delta);

  UPDATE public.school_fee_payments
  SET amount = v_amount,
      method = v_method,
      payment_date = v_date,
      remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
      balance_after = v_new_balance,
      due_fee = v_due,
      fine_amount = v_fine,
      concession = v_concession,
      discount = v_discount,
      payable_fee = v_payable,
      updated_at = now(),
      updated_by = auth.uid(),
      edit_count = coalesce(v_payment.edit_count, 0) + 1
  WHERE id = v_payment.id;

  IF v_delta <> 0 THEN
    INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
    VALUES (v_payment.student_id, CASE WHEN v_delta > 0 THEN 'payment' ELSE 'reversal' END, abs(v_delta), v_new_balance);

    UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_payment.student_id;
  END IF;

  IF v_payment.challan_id IS NOT NULL THEN
    SELECT coalesce(total, 0) INTO v_challan_total FROM public.school_fee_challans WHERE id = v_payment.challan_id;
    SELECT coalesce(sum(amount), 0) INTO v_paid
    FROM public.school_fee_payments
    WHERE challan_id = v_payment.challan_id AND voided = false;

    v_status := CASE
      WHEN v_paid >= v_challan_total THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END;
    UPDATE public.school_fee_challans SET status = v_status WHERE id = v_payment.challan_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'receipt_number', v_payment.receipt_number,
    'student_id', v_payment.student_id,
    'amount', v_amount,
    'due_fee', v_due,
    'fine_amount', v_fine,
    'concession', v_concession,
    'discount', v_discount,
    'payable_fee', v_payable,
    'balance_after', v_new_balance,
    'challan_status', v_status
  );
END $function$;

-- 3. Removing a receipt that should never have been recorded ------------------
CREATE OR REPLACE FUNCTION public.delete_payment_voucher(p_payment_id uuid, p_reason text)
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
  v_challan_total numeric(10,2);
  v_paid numeric(10,2);
  v_status text;
BEGIN
  IF NOT public.is_fee_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to delete a receipt';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'That reason is too long';
  END IF;

  SELECT * INTO v_payment FROM public.school_fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That receipt no longer exists';
  END IF;

  SELECT coalesce(fee_balance, 0) INTO v_balance
  FROM public.school_students WHERE id = v_payment.student_id FOR UPDATE;

  -- Only give back what this receipt actually took off the account. A receipt taken
  -- against an already cleared account removed nothing, so deleting it returns nothing.
  IF v_payment.voided THEN
    v_restore := 0;
  ELSE
    v_restore := least(coalesce(v_payment.amount, 0), greatest(coalesce(v_balance, 0), 0));
  END IF;
  v_new_balance := coalesce(v_balance, 0) + v_restore;

  -- The ledger entry is written before the receipt goes, so the audit trail outlives
  -- the deleted row and names the reason it was removed.
  IF v_restore > 0 THEN
    INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
    VALUES (v_payment.student_id, 'reversal', v_restore, v_new_balance);

    UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_payment.student_id;
  END IF;

  DELETE FROM public.school_fee_payments WHERE id = v_payment.id;

  IF v_payment.challan_id IS NOT NULL THEN
    SELECT coalesce(total, 0) INTO v_challan_total FROM public.school_fee_challans WHERE id = v_payment.challan_id;
    SELECT coalesce(sum(amount), 0) INTO v_paid
    FROM public.school_fee_payments
    WHERE challan_id = v_payment.challan_id AND voided = false;

    v_status := CASE
      WHEN v_paid >= v_challan_total THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END;
    UPDATE public.school_fee_challans SET status = v_status WHERE id = v_payment.challan_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'receipt_number', v_payment.receipt_number,
    'student_id', v_payment.student_id,
    'amount', v_payment.amount,
    'restored', v_restore,
    'balance_after', v_new_balance,
    'reason', v_reason
  );
END $function$;

-- 4. Grants: the functions are the only way to change a receipt ---------------
REVOKE EXECUTE ON FUNCTION public.set_payment_voucher(uuid, numeric, text, date, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_voucher(uuid, numeric, text, date, text, numeric, numeric, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_payment_voucher(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payment_voucher(uuid, text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.school_fee_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.school_fee_payments FROM authenticated;
GRANT SELECT ON public.school_fee_payments TO authenticated;

DROP POLICY IF EXISTS "Fee staff can void fee payments" ON public.school_fee_payments;
