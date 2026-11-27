/*
# Record what each fee receipt actually took off the account

## What this changes, in plain English

When a fee receipt is deleted or reversed, the student's outstanding balance has to go
back up by exactly the amount that receipt had taken off it. Until now the code tried to
work that amount out again at delete time by looking at the balance as it stood *then*.
That is wrong whenever anything else has happened to the account in between: if other
payments have since lowered the balance, the receipt appears to have taken off less than
it really did, and deleting it gives back too little. It could also give back too much.

The fix is to stop guessing. Every receipt now stores the amount it actually applied to
the account, written at the moment the payment is recorded. Deleting or reversing a
receipt gives back precisely that stored figure, whatever has happened to the balance
since.

## 1. New column on `school_fee_payments`

- `applied_amount` (numeric(10,2), nullable)
  The amount this receipt actually removed from the student's outstanding balance.
  A receipt of Rs 1,500 taken against a student who only owed Rs 1,000 applied Rs 1,000,
  because the balance never goes below zero. This is the figure that is given back when
  the receipt is deleted or reversed.

## 2. Backfill

Existing receipts have no stored figure, so `applied_amount` is filled in with the receipt
amount. That is exactly right for every receipt that was not clipped by a zero balance,
and it is the best available figure for the ones that were. The table currently holds no
receipts, so this backfill changes nothing in practice; it exists so a rebuild of the
project from these migration files lands in the same state. The backfill only touches rows
where the value is still missing, so re-running this migration cannot overwrite a real
figure.

## 3. Functions replaced

- `record_fee_payment` — now computes the applied amount as
  `balance before − balance after` and stores it on the receipt. Nothing else about
  recording a payment changed.
- `set_payment_voucher` — when a voucher is corrected, the applied amount moves by the
  same difference the account moved by, and is stored alongside the new figures.
- `delete_payment_voucher` — gives back the stored applied amount instead of guessing
  from the current balance. A receipt that was reversed first still gives back nothing.
- `void_fee_payment` — same correction, so a reversal restores exactly what the receipt
  took off.

## 4. Security

Unchanged and re-stated: all four functions remain `SECURITY DEFINER` with
`SET search_path = public`, keep their existing role checks, and EXECUTE stays revoked from
`PUBLIC` and `anon` and granted only to `authenticated`. `applied_amount` is not writable
by the browser: `authenticated` holds only SELECT on `school_fee_payments`, and the column
is written solely by these functions.
*/

-- 1. The amount each receipt actually removed from the balance.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'school_fee_payments' AND column_name = 'applied_amount'
  ) THEN
    ALTER TABLE public.school_fee_payments ADD COLUMN applied_amount numeric(10,2);
  END IF;
END $$;

-- 2. Fill in receipts recorded before the column existed. Idempotent: only rows still missing it.
UPDATE public.school_fee_payments
SET applied_amount = amount
WHERE applied_amount IS NULL;

-- 3a. Recording a payment now stores what it actually applied.
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
SET search_path = 'public'
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
  v_applied numeric(10,2);
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

  -- What this receipt actually took off the account. When the student owed less than the
  -- amount handed over, the balance stops at zero and only the owed part is applied.
  v_applied := v_balance - v_new_balance;

  INSERT INTO public.school_fee_payments (
    student_id, receipt_number, amount, method, payment_date, remarks, balance_after,
    recorded_by, challan_id, challan_number, source,
    due_fee, fine_amount, concession, discount, payable_fee, applied_amount
  ) VALUES (
    v_student.id, v_receipt, v_amount, v_method, v_payment_date,
    nullif(btrim(coalesce(p_remarks, '')), ''), v_new_balance, auth.uid(),
    v_challan_id, v_challan.challan_number, v_source,
    v_due, v_fine, v_concession, v_discount, v_payable, v_applied
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
    'applied_amount', v_applied,
    'payment_date', v_payment_date,
    'method', v_method,
    'challan_number', v_challan.challan_number,
    'challan_status', v_status
  );
END $function$;

-- 3b. Correcting a voucher moves the applied amount by the same difference as the account.
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
SET search_path = 'public'
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
  v_applied numeric(10,2);
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

  SELECT coalesce(fee_balance, 0) INTO v_balance
  FROM public.school_students WHERE id = v_payment.student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  v_delta := v_amount - coalesce(v_payment.amount, 0);
  v_new_balance := greatest(0, coalesce(v_balance, 0) - v_delta);
  -- The account moved by v_delta, so the part of it this receipt applied moves too.
  v_applied := greatest(0, coalesce(v_payment.applied_amount, v_payment.amount, 0) + v_delta);

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
      applied_amount = v_applied,
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
    'applied_amount', v_applied,
    'balance_after', v_new_balance,
    'challan_status', v_status
  );
END $function$;

-- 3c. Deleting a voucher gives back exactly what the receipt applied.
CREATE OR REPLACE FUNCTION public.delete_payment_voucher(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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

  -- Give back the amount this receipt itself applied, as recorded when it was taken. A
  -- receipt that was already reversed gives back nothing, because the money was already
  -- handed back once.
  IF v_payment.voided THEN
    v_restore := 0;
  ELSE
    v_restore := greatest(coalesce(v_payment.applied_amount, v_payment.amount, 0), 0);
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

-- 3d. Reversing a payment gives back exactly what the receipt applied.
CREATE OR REPLACE FUNCTION public.void_fee_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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

  -- Only undo the balance this receipt actually removed. A receipt recorded against an
  -- already cleared account removed nothing, so reversing it restores nothing; otherwise
  -- the balance would climb above what the student owes.
  v_restore := greatest(coalesce(v_payment.applied_amount, v_payment.amount, 0), 0);
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

-- 4. Privileges: the browser still only reads receipts; these functions are the write path.
REVOKE EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text, numeric, numeric, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_payment_voucher(uuid, numeric, text, date, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_voucher(uuid, numeric, text, date, text, numeric, numeric, numeric, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_payment_voucher(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payment_voucher(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.void_fee_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_fee_payment(uuid, text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.school_fee_payments FROM anon, authenticated;
GRANT SELECT ON public.school_fee_payments TO authenticated;
