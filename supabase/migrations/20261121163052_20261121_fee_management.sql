/*
# Fee Management: structure, payments, challans and reminders

## 1. Purpose
Gives the portal a complete fee section: what each class is charged, a receipt for every
payment, monthly or term challans, and reminders for families with dues. Payments are
recorded by one server-side action so the receipt, the fee history and the student's
balance are always written together.

## 2. New Tables

### `school_fee_structures`
The standard monthly charge for one class.
- `class_name` (text, primary key, e.g. `Class 5`)
- `tuition_fee` (numeric, the monthly tuition)
- `admission_misc` (numeric, admission and miscellaneous charges)
- `exam_lab` (numeric, examination and laboratory charges)
- `transport` (numeric, transport charges, 0 when not used)
- `late_fine` (numeric, the fine added once a challan is past its due date)
- `updated_at` (timestamp)

### `school_fee_payments`
One row per payment received, which is what a receipt is printed from.
- `id` (uuid, primary key)
- `student_id` (uuid, references `school_students`, removed with the student)
- `receipt_number` (text, unique, so two receipts can never share a number)
- `amount` (numeric, must be greater than zero)
- `method` (text, `cash` / `bank` / `online`)
- `payment_date` (date, the day the money was received)
- `remarks` (text, optional)
- `balance_after` (numeric, the student's balance immediately after this payment)
- `recorded_by` (uuid, defaults to the signed-in account)
- `created_at` (timestamp)

### `school_fee_challans`
A generated fee bill for one student for one month.
- `id` (uuid, primary key)
- `student_id` (uuid, references `school_students`, removed with the student)
- `student_name` (text, kept so an old challan stays readable)
- `class_name`, `section_name` (text, where the student was when it was issued)
- `month` (text, `YYYY-MM`)
- `due_date` (date)
- `tuition_fee`, `admission_misc`, `exam_lab`, `transport`, `arrears`, `concession`, `late_fine` (numeric fee heads)
- `total` (numeric, the sum of the heads less the concession)
- `status` (text, `unpaid` / `partial` / `paid`)
- `created_by` (uuid), `created_at` (timestamp)
- One challan per student per month, so re-issuing corrects rather than duplicates.

## 3. New Function
- `record_fee_payment(...)` records a payment in one transaction: it checks the caller is
  staff, validates the amount, method, date and receipt number itself, writes the payment
  and the matching fee history entry, and lowers the student's balance. It returns the
  receipt number and the new balance.

## 4. Modified Behaviour
- `school_sms_log.message_type` now also accepts `fee_reminder`, so fee reminders sent
  from the Defaulters tab appear in the WhatsApp SMS Report beside the attendance alerts.
  Existing rows are unaffected.

## 5. Security
- RLS is enabled on all three new tables, with four separate policies each.
- Fee structure is readable by staff and editable by administrators only.
- Payments and challans are readable by staff; payments may be inserted by staff (the
  office collects money) but only administrators may delete them.
- All three tables are granted to `authenticated` only; there is no `anon` access.
- `record_fee_payment` is SECURITY DEFINER with a fixed `search_path`, authorises the
  caller with `is_staff()`, and its EXECUTE is revoked from PUBLIC and `anon`.

## 6. Notes
- `school_students.tuition_fee` still holds a student's own agreed tuition and takes
  priority over the class structure, so existing concession arrangements keep working.
- Starting structure figures are seeded once per class and can be edited at any time;
  a class that already has a structure is left untouched.
*/

-- 1. Fee structure per class ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_fee_structures (
  class_name text PRIMARY KEY,
  tuition_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (tuition_fee >= 0),
  admission_misc numeric(10,2) NOT NULL DEFAULT 0 CHECK (admission_misc >= 0),
  exam_lab numeric(10,2) NOT NULL DEFAULT 0 CHECK (exam_lab >= 0),
  transport numeric(10,2) NOT NULL DEFAULT 0 CHECK (transport >= 0),
  late_fine numeric(10,2) NOT NULL DEFAULT 0 CHECK (late_fine >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_fee_structures ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_fee_structures TO authenticated;

DROP POLICY IF EXISTS "Staff can read fee structure" ON public.school_fee_structures;
CREATE POLICY "Staff can read fee structure"
ON public.school_fee_structures FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can add fee structure" ON public.school_fee_structures;
CREATE POLICY "Admins can add fee structure"
ON public.school_fee_structures FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can edit fee structure" ON public.school_fee_structures;
CREATE POLICY "Admins can edit fee structure"
ON public.school_fee_structures FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can remove fee structure" ON public.school_fee_structures;
CREATE POLICY "Admins can remove fee structure"
ON public.school_fee_structures FOR DELETE
TO authenticated
USING (public.is_admin());

INSERT INTO public.school_fee_structures (class_name, tuition_fee, admission_misc, exam_lab, transport, late_fine)
SELECT 'Class ' || series.n, 1500 + (series.n - 1) * 150, 500, 300, 0, 100
FROM generate_series(1, 10) AS series(n)
ON CONFLICT (class_name) DO NOTHING;

-- 2. Payments received ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_fee_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'bank', 'online')),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  remarks text,
  balance_after numeric(10,2) NOT NULL CHECK (balance_after >= 0),
  recorded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_fee_payments_receipt_key
ON public.school_fee_payments (receipt_number);

CREATE INDEX IF NOT EXISTS school_fee_payments_student_idx
ON public.school_fee_payments (student_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS school_fee_payments_date_idx
ON public.school_fee_payments (payment_date DESC);

ALTER TABLE public.school_fee_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.school_fee_payments TO authenticated;

DROP POLICY IF EXISTS "Staff can read fee payments" ON public.school_fee_payments;
CREATE POLICY "Staff can read fee payments"
ON public.school_fee_payments FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can record fee payments" ON public.school_fee_payments;
CREATE POLICY "Staff can record fee payments"
ON public.school_fee_payments FOR INSERT
TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Admins can correct fee payments" ON public.school_fee_payments;
CREATE POLICY "Admins can correct fee payments"
ON public.school_fee_payments FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can remove fee payments" ON public.school_fee_payments;
CREATE POLICY "Admins can remove fee payments"
ON public.school_fee_payments FOR DELETE
TO authenticated
USING (public.is_admin());

-- 3. Challans -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_fee_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  class_name text,
  section_name text,
  month text NOT NULL,
  due_date date NOT NULL,
  tuition_fee numeric(10,2) NOT NULL DEFAULT 0,
  admission_misc numeric(10,2) NOT NULL DEFAULT 0,
  exam_lab numeric(10,2) NOT NULL DEFAULT 0,
  transport numeric(10,2) NOT NULL DEFAULT 0,
  arrears numeric(10,2) NOT NULL DEFAULT 0,
  concession numeric(10,2) NOT NULL DEFAULT 0,
  late_fine numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_fee_challans_student_month_key
ON public.school_fee_challans (student_id, month);

CREATE INDEX IF NOT EXISTS school_fee_challans_month_idx
ON public.school_fee_challans (month, status);

ALTER TABLE public.school_fee_challans ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.school_fee_challans TO authenticated;

DROP POLICY IF EXISTS "Staff can read challans" ON public.school_fee_challans;
CREATE POLICY "Staff can read challans"
ON public.school_fee_challans FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can generate challans" ON public.school_fee_challans;
CREATE POLICY "Staff can generate challans"
ON public.school_fee_challans FOR INSERT
TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update challans" ON public.school_fee_challans;
CREATE POLICY "Staff can update challans"
ON public.school_fee_challans FOR UPDATE
TO authenticated
USING (public.is_staff())
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Admins can remove challans" ON public.school_fee_challans;
CREATE POLICY "Admins can remove challans"
ON public.school_fee_challans FOR DELETE
TO authenticated
USING (public.is_admin());

-- 4. Fee reminders join the alert report ----------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.school_sms_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%message_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_sms_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.school_sms_log
  ADD CONSTRAINT school_sms_log_message_type_check
  CHECK (message_type IN ('absentee_alert', 'leave_alert', 'late_alert', 'fee_reminder'));

-- 5. Recording a payment --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_fee_payment(
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_date date,
  p_remarks text,
  p_receipt_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_student public.school_students%ROWTYPE;
  v_method text;
  v_receipt text;
  v_payment_date date;
  v_balance numeric(10,2);
  v_new_balance numeric(10,2);
  v_payment_id uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  IF p_amount > 1000000 THEN
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

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  v_balance := coalesce(v_student.fee_balance, 0);
  v_new_balance := greatest(0, v_balance - p_amount);

  INSERT INTO public.school_fee_payments (
    student_id, receipt_number, amount, method, payment_date, remarks, balance_after, recorded_by
  ) VALUES (
    v_student.id, v_receipt, p_amount, v_method, v_payment_date,
    nullif(btrim(coalesce(p_remarks, '')), ''), v_new_balance, auth.uid()
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
  VALUES (v_student.id, 'payment', p_amount, v_new_balance);

  UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_student.id;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_number', v_receipt,
    'amount', p_amount,
    'balance_after', v_new_balance,
    'payment_date', v_payment_date,
    'method', v_method
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text) TO authenticated;
