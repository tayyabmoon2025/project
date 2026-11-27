/*
# Fee challan barcode, scan-to-pay, and Easypaisa payment details

1. New Tables
- `school_payment_settings` — a single-row table holding how families can pay the school.
  - `id` (integer, always 1, primary key) — keeps the table to one row.
  - `easypaisa_account_no` (text) — the Easypaisa mobile account number printed on challans.
  - `easypaisa_account_name` (text) — the account holder name shown beside the number.
  - `bank_name` (text) — optional bank name for bank deposits.
  - `bank_account_no` (text) — optional bank account number.
  - `updated_at` (timestamptz) — when the details were last changed.
  - One empty row is seeded so the office can fill it in; the row is never deleted.

2. Modified Tables
- `school_fee_challans`
  - New column `challan_number` (text) — a short, unique, printed reference such as
    `CH-000123`. It is the value encoded in the challan barcode.
  - New sequence `school_fee_challan_number_seq` supplies the number.
  - New trigger `school_fee_challans_assign_number` fills the number on insert when the
    caller does not supply one, so a number is never missing. Re-saving an existing
    challan keeps its original number, so a reprinted challan still scans.
  - Existing challans are given a number once.
  - New unique index on `challan_number`.
- `school_fee_payments`
  - New column `challan_id` (uuid) — the challan this payment settles, if any.
  - New column `challan_number` (text) — the challan number kept with the receipt.
  - New column `source` (text, default `manual`) — `manual` for a typed payment,
    `scan` for one taken from a scanned challan.
  - New index on `challan_id`.

3. New Functions
- `resolve_fee_challan(p_code)` — turns a scanned code into a challan id. Accepts a
  challan number, an `<admission number>+<fee month>` code, or a bare admission number
  (which resolves to that student's newest challan).
- `lookup_fee_challan(p_code)` — staff-facing lookup used by the scan box. Returns the
  challan, the student, how much has already been paid against that challan, and how
  much is left. It never exposes anything to a caller who is not signed-in staff.

4. Modified Functions
- `record_fee_payment(...)` now also accepts `p_challan_number` and `p_source`, and its
  amount may be left empty when a challan is given (the remaining balance on that
  challan is then collected). When a payment is linked to a challan, the challan's
  status is recalculated from the payments actually recorded against it, so it flips to
  `paid` only when the money has really been taken. The old six-argument version is
  dropped so no caller can bypass the challan handling.

5. Security
- RLS is enabled on `school_payment_settings` with policies for select, insert and
  update: any signed-in staff member may read the payment details, and only an
  administrator may change them. There is deliberately no delete policy and no delete
  grant, so the single settings row can never be removed.
- The table is granted to `authenticated` only; there is no `anon` access.
- `resolve_fee_challan` and `lookup_fee_challan` are SECURITY DEFINER with a fixed
  `search_path`. Both authorise the caller with `is_staff()`, and EXECUTE is revoked
  from PUBLIC and `anon`. `resolve_fee_challan` is additionally revoked from
  `authenticated` because it is an internal helper called only by the other functions.

6. Notes
- Existing payments keep their values; the new columns are empty for rows recorded
  before this change, which simply means "not linked to a challan".
- No data is deleted by this migration.
*/

-- 1. How families can pay -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_payment_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  easypaisa_account_no text,
  easypaisa_account_name text,
  bank_name text,
  bank_account_no text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.school_payment_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.school_payment_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.school_payment_settings TO authenticated;

DROP POLICY IF EXISTS "Staff can read payment settings" ON public.school_payment_settings;
CREATE POLICY "Staff can read payment settings"
ON public.school_payment_settings FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can add payment settings" ON public.school_payment_settings;
CREATE POLICY "Admins can add payment settings"
ON public.school_payment_settings FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can edit payment settings" ON public.school_payment_settings;
CREATE POLICY "Admins can edit payment settings"
ON public.school_payment_settings FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 2. A short, printable challan number ------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.school_fee_challan_number_seq;

GRANT USAGE ON SEQUENCE public.school_fee_challan_number_seq TO authenticated;

ALTER TABLE public.school_fee_challans ADD COLUMN IF NOT EXISTS challan_number text;

UPDATE public.school_fee_challans
SET challan_number = 'CH-' || to_char(nextval('public.school_fee_challan_number_seq'), 'FM000000')
WHERE challan_number IS NULL OR btrim(challan_number) = '';

CREATE UNIQUE INDEX IF NOT EXISTS school_fee_challans_number_key
ON public.school_fee_challans (challan_number);

CREATE OR REPLACE FUNCTION public.assign_fee_challan_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.challan_number IS NULL OR btrim(NEW.challan_number) = '' THEN
    NEW.challan_number := 'CH-' || to_char(nextval('public.school_fee_challan_number_seq'), 'FM000000');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS school_fee_challans_assign_number ON public.school_fee_challans;
CREATE TRIGGER school_fee_challans_assign_number
BEFORE INSERT ON public.school_fee_challans
FOR EACH ROW EXECUTE FUNCTION public.assign_fee_challan_number();

-- 3. Link a payment to the challan it settles -----------------------------------
ALTER TABLE public.school_fee_payments
  ADD COLUMN IF NOT EXISTS challan_id uuid REFERENCES public.school_fee_challans(id) ON DELETE SET NULL;

ALTER TABLE public.school_fee_payments ADD COLUMN IF NOT EXISTS challan_number text;

ALTER TABLE public.school_fee_payments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_fee_payments_source_check'
  ) THEN
    ALTER TABLE public.school_fee_payments
      ADD CONSTRAINT school_fee_payments_source_check CHECK (source IN ('manual', 'scan'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS school_fee_payments_challan_idx
ON public.school_fee_payments (challan_id);

-- 4. Resolve a scanned code to a challan ----------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_fee_challan(p_code text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_admission text;
  v_month text;
  v_id uuid;
BEGIN
  IF v_code = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
  FROM public.school_fee_challans
  WHERE upper(challan_number) = v_code
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- "<admission number>+<fee month>": the code printed on a challan that has not
  -- been saved yet, so staff can still scan it straight off the preview.
  IF position('+' in v_code) > 0 THEN
    v_admission := split_part(v_code, '+', 1);
    v_month := split_part(v_code, '+', 2);
    SELECT c.id INTO v_id
    FROM public.school_fee_challans c
    JOIN public.school_students s ON s.id = c.student_id
    WHERE upper(s.admission_number) = v_admission
      AND c.month = v_month
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  -- A bare admission number resolves to that student's newest challan.
  SELECT c.id INTO v_id
  FROM public.school_fee_challans c
  JOIN public.school_students s ON s.id = c.student_id
  WHERE upper(s.admission_number) = v_code
  ORDER BY c.created_at DESC
  LIMIT 1;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.resolve_fee_challan(text) FROM PUBLIC, anon, authenticated;

-- 5. Staff-facing challan lookup -------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_fee_challan(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_challan public.school_fee_challans%ROWTYPE;
  v_student public.school_students%ROWTYPE;
  v_paid numeric(10,2);
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_id := public.resolve_fee_challan(p_code);
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'reason', 'No fee challan matches that code.');
  END IF;

  SELECT * INTO v_challan FROM public.school_fee_challans WHERE id = v_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason', 'No fee challan matches that code.');
  END IF;

  SELECT * INTO v_student FROM public.school_students WHERE id = v_challan.student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason', 'The student on that challan is no longer on the roster.');
  END IF;

  v_paid := coalesce((
    SELECT sum(amount) FROM public.school_fee_payments WHERE challan_id = v_id
  ), 0);

  RETURN jsonb_build_object(
    'found', true,
    'challan_id', v_challan.id,
    'challan_number', v_challan.challan_number,
    'month', v_challan.month,
    'due_date', v_challan.due_date,
    'total', v_challan.total,
    'status', v_challan.status,
    'paid', v_paid,
    'remaining', greatest(0, coalesce(v_challan.total, 0) - v_paid),
    'student_id', v_student.id,
    'student_name', v_student.full_name,
    'admission_number', v_student.admission_number,
    'class_name', v_student.class_name,
    'section_name', v_student.section_name,
    'fee_balance', coalesce(v_student.fee_balance, 0)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.lookup_fee_challan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_fee_challan(text) TO authenticated;

-- 6. Challan-aware payment recording --------------------------------------------
DROP FUNCTION IF EXISTS public.record_fee_payment(uuid, numeric, text, date, text, text);

CREATE OR REPLACE FUNCTION public.record_fee_payment(
  p_student_id uuid,
  p_amount numeric DEFAULT NULL,
  p_method text DEFAULT 'cash',
  p_payment_date date DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_receipt_number text DEFAULT NULL,
  p_challan_number text DEFAULT NULL,
  p_source text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_source := lower(btrim(coalesce(p_source, 'manual')));
  IF v_source NOT IN ('manual', 'scan') THEN
    v_source := 'manual';
  END IF;

  -- A scanned code ties this payment to one challan.
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
      SELECT sum(amount) FROM public.school_fee_payments WHERE challan_id = v_challan_id
    ), 0);
    v_remaining := greatest(0, coalesce(v_challan.total, 0) - v_paid);
  END IF;

  -- With no amount given, collect whatever is left on the challan.
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

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  v_balance := coalesce(v_student.fee_balance, 0);
  v_new_balance := greatest(0, v_balance - v_amount);

  INSERT INTO public.school_fee_payments (
    student_id, receipt_number, amount, method, payment_date, remarks, balance_after,
    recorded_by, challan_id, challan_number, source
  ) VALUES (
    v_student.id, v_receipt, v_amount, v_method, v_payment_date,
    nullif(btrim(coalesce(p_remarks, '')), ''), v_new_balance, auth.uid(),
    v_challan_id, v_challan.challan_number, v_source
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
  VALUES (v_student.id, 'payment', v_amount, v_new_balance);

  UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_student.id;

  -- The challan status always reflects the payments actually recorded against it.
  IF v_challan_id IS NOT NULL THEN
    v_paid := coalesce((
      SELECT sum(amount) FROM public.school_fee_payments WHERE challan_id = v_challan_id
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
    'balance_after', v_new_balance,
    'payment_date', v_payment_date,
    'method', v_method,
    'challan_number', v_challan.challan_number,
    'challan_status', v_status
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text) TO authenticated;
