/*
# Receipts remember their own breakdown (due fee, fine, concession, discount)

## 1. What this does in plain English

When a receipt is taken at the counter, the school now stores the whole calculation behind
it, not just the money that changed hands. That is what lets an Acknowledgment receipt be
reprinted weeks later and still show the same Due Fee, Late Fee Fine, Fee Concession,
Discount, Total Fee Payable, Fee Paid and Balance as the day it was issued.

## 2. Changes to record_fee_payment

Four optional inputs are added:

- p_due_fee     : the fee that was outstanding before this receipt
- p_fine        : late fee fine added
- p_concession  : concession taken off
- p_discount    : discount taken off

Total fee payable is worked out in the database as due + fine - concession - discount and
never below zero. It is stored on the receipt together with the four inputs.

The amount the student's account is reduced by is still exactly the money actually
received (p_amount). A concession or discount therefore changes what the student is asked
for, while the balance only moves by what was really collected.

## 3. Security

- The function stays SECURITY DEFINER and still refuses any caller who is not active
  staff, and it is the only path that writes a receipt.
- EXECUTE is granted to signed-in users only; the anonymous role cannot call it.
- The previous eight-argument version is dropped so there is exactly one way in, with no
  ambiguous overload left behind.
*/

DROP FUNCTION IF EXISTS public.record_fee_payment(uuid, numeric, text, date, text, text, text, text);

CREATE OR REPLACE FUNCTION public.record_fee_payment(
  p_student_id uuid,
  p_amount numeric DEFAULT NULL,
  p_method text DEFAULT 'cash',
  p_payment_date date DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_receipt_number text DEFAULT NULL,
  p_challan_number text DEFAULT NULL,
  p_source text DEFAULT 'manual',
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
  v_student public.school_students%ROWTYPE;
  v_challan public.school_fee_challans%ROWTYPE;
  v_method text;
  v_source text;
  v_receipt text;
  v_payment_date date;
  v_amount numeric(10,2);
  v_balance numeric(10,2);
  v_new_balance numeric(10,2);
  v_payment_id uuid;
  v_challan_id uuid;
  v_paid numeric(10,2);
  v_remaining numeric(10,2);
  v_status text;
  v_due numeric(10,2);
  v_fine numeric(10,2);
  v_concession numeric(10,2);
  v_discount numeric(10,2);
  v_payable numeric(10,2);
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_source := lower(btrim(coalesce(p_source, 'manual')));
  IF v_source NOT IN ('manual', 'scan') THEN
    v_source := 'manual';
  END IF;

  IF btrim(coalesce(p_challan_number, '')) <> '' THEN
    v_challan_id := public.resolve_fee_challan(p_challan_number);
    IF v_challan_id IS NULL THEN
      RAISE EXCEPTION 'No fee challan matches that code';
    END IF;

    SELECT * INTO v_challan FROM public.school_fee_challans WHERE id = v_challan_id;
    IF v_challan.student_id <> p_student_id THEN
      RAISE EXCEPTION 'That challan belongs to a different student';
    END IF;

    v_paid := coalesce((
      SELECT sum(amount) FROM public.school_fee_payments
      WHERE challan_id = v_challan_id AND voided = false
    ), 0);
    v_remaining := greatest(0, coalesce(v_challan.total, 0) - v_paid);
  END IF;

  v_amount := p_amount;
  IF v_amount IS NULL THEN
    IF v_challan_id IS NULL THEN
      RAISE EXCEPTION 'Enter an amount greater than zero';
    END IF;
    IF v_remaining <= 0 THEN
      RAISE EXCEPTION 'That challan is already fully paid';
    END IF;
    v_amount := v_remaining;
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  IF v_amount > 1000000 THEN
    RAISE EXCEPTION 'That amount is larger than this form accepts';
  END IF;

  v_method := lower(btrim(coalesce(p_method, '')));
  IF v_method NOT IN ('cash', 'bank', 'online') THEN
    RAISE EXCEPTION 'Choose a payment method';
  END IF;

  v_payment_date := coalesce(p_payment_date, CURRENT_DATE);
  IF v_payment_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'The payment date cannot be in the future';
  END IF;

  v_receipt := nullif(btrim(coalesce(p_receipt_number, '')), '');
  IF v_receipt IS NULL THEN
    v_receipt := 'RCPT-' || to_char(v_payment_date, 'YYMMDD') || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  END IF;
  IF length(v_receipt) > 40 THEN
    RAISE EXCEPTION 'That receipt number is too long';
  END IF;
  IF EXISTS (SELECT 1 FROM public.school_fee_payments WHERE receipt_number = v_receipt) THEN
    RAISE EXCEPTION 'That receipt number is already used';
  END IF;

  v_fine := greatest(coalesce(p_fine, 0), 0);
  v_concession := greatest(coalesce(p_concession, 0), 0);
  v_discount := greatest(coalesce(p_discount, 0), 0);

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  v_balance := coalesce(v_student.fee_balance, 0);
  v_due := greatest(coalesce(p_due_fee, v_balance), 0);
  v_payable := greatest(0, v_due + v_fine - v_concession - v_discount);
  v_new_balance := greatest(0, v_balance - v_amount);

  INSERT INTO public.school_fee_payments (
    student_id, receipt_number, amount, method, payment_date, remarks, balance_after,
    recorded_by, challan_id, challan_number, source,
    due_fee, fine_amount, concession, discount, payable_fee
  ) VALUES (
    v_student.id, v_receipt, v_amount, v_method, v_payment_date,
    nullif(btrim(coalesce(p_remarks, '')), ''), v_new_balance, auth.uid(),
    v_challan_id, v_challan.challan_number, v_source,
    v_due, v_fine, v_concession, v_discount, v_payable
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
  VALUES (v_student.id, 'payment', v_amount, v_new_balance);

  UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_student.id;

  IF v_challan_id IS NOT NULL THEN
    v_paid := coalesce((
      SELECT sum(amount) FROM public.school_fee_payments
      WHERE challan_id = v_challan_id AND voided = false
    ), 0);
    v_status := CASE
      WHEN v_paid >= coalesce(v_challan.total, 0) THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END;
    UPDATE public.school_fee_challans SET status = v_status WHERE id = v_challan_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_number', v_receipt,
    'amount', v_amount,
    'due_fee', v_due,
    'fine_amount', v_fine,
    'concession', v_concession,
    'discount', v_discount,
    'payable_fee', v_payable,
    'balance_after', v_new_balance,
    'payment_date', v_payment_date,
    'method', v_method,
    'challan_number', v_challan.challan_number,
    'challan_status', v_status
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text, numeric, numeric, numeric, numeric) TO authenticated;
