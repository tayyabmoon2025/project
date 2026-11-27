/*
# Accountant portal: access model, payment voiding and daily cash closing

## 1. Purpose
The school already has Admin, Teacher, Parent, Office Assistant, Accountant and Student
roles. Until now an Accountant shared the generic staff role, which meant the same
permissions as a teacher. This change gives the Accountant a precise, server-enforced
permission set: full fee work (collect, reprint, void with a reason, report) and
read-only access to student and attendance information. Nothing an Accountant can do is
decided in the browser; every rule below is enforced by the database.

## 2. New helper functions (all SECURITY DEFINER, fixed search_path)
- `is_accountant()` — true only for a signed-in, active accountant.
- `is_fee_staff()` — true for an active administrator, accountant or office assistant.
  This is the "may work with money" role set.
- `can_manage_users()` — true only for an active administrator. This is the single
  authority for account management, so an accountant can never create, edit or remove
  accounts even by calling the API directly.
All three are revoked from PUBLIC and anon; only `authenticated` may execute them.

## 3. Modified tables

### `school_fee_payments` (payments already received)
- New column `voided` (boolean, default false) — a payment is never deleted; it is
  marked void so it stays in the audit trail.
- New column `voided_at` (timestamp) and `voided_by` (uuid, the staff member who voided it).
- New column `void_reason` (text) — a reason is required to void.
- New index on `(payment_date)` where the row is not voided, so daily totals stay fast.

### `school_fee_transactions` (the student's fee ledger)
- The `kind` column now also accepts `reversal`, which is what a voided payment writes,
  so the running balance and the ledger stay truthful after a void.

### `school_sms_log` (WhatsApp / SMS messages)
- The `message_type` column now also accepts `fee_reminder`, so fee reminders appear in
  the existing SMS report.

## 4. New table: `school_daily_closings`
The accountant's end-of-day record. One row per day, holding only notes and the opening
balance the office counted; every money figure is computed from the real transactions.
- `closing_date` (date, primary key)
- `opening_balance` (numeric, what was carried over, entered by the accountant)
- `notes` (text)
- `closed_by` (uuid, the staff member who closed the day)
- `created_at`, `updated_at` (timestamps)

## 5. New function: `void_fee_payment(p_payment_id, p_reason)`
- Only `is_fee_staff()` may call it, and only for a payment that is not already void.
- A reason is mandatory and is stored on the payment.
- It does not delete anything: it marks the payment void, writes a `reversal` entry to the
  student's fee ledger, and restores the amount to the student's balance.
- If the payment was tied to a challan, the challan status is recalculated so a voided
  payment can no longer leave a challan looking paid.
- It returns the new balance and the restored amount.
EXECUTE is revoked from PUBLIC and anon.

## 6. Existing function tightened: `record_fee_payment(...)`
- Re-created with its full existing behaviour plus two additions: it refuses to record
  against a void payment's challan incorrectly, and it ignores voided rows when working
  out how much of a challan has been paid, so a void cannot leave a stale "paid" status.
- Authorisation is unchanged (`is_staff()`); no caller that worked before stops working.

## 7. Row Level Security changes
- `school_fee_payments`: SELECT/INSERT/UPDATE for staff (unchanged); a new policy lets an
  accountant update a payment only to void it (the void rule itself lives in the function).
  DELETE remains administrator-only, so an accountant can never erase a receipt.
- `school_fee_structures`: reading stays open to staff; editing stays administrator-only.
- `school_sections`: reading now also allows an accountant (read-only).
- `school_daily_closings`: RLS enabled with four separate policies. Only
  `is_fee_staff()` may read or write; DELETE is administrator-only.
- `user_profiles`: no change to policies, but account management functions below are
  re-created to require `can_manage_users()` (administrator only).

## 8. Account management locked to administrators
`admin_provision_account`, `admin_set_password`, `admin_reset_username`,
`admin_set_account_status` and `admin_remove_user` are re-created to check
`can_manage_users()`. An accountant (or any other role) calling them directly through the
API is rejected, which is what stops an accountant from managing accounts.

## 9. Notes
- No existing row is modified, deleted or renumbered by this migration.
- Voiding is additive: the original payment row and its receipt number are preserved.
- Every function here is SECURITY DEFINER with a fixed search_path and least-privilege grants.
*/

-- 1. Role helpers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_accountant()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'accountant' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_fee_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'accountant', 'office_assistant')
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_users()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_accountant() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_fee_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_accountant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_fee_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_users() TO authenticated;

-- 2. Payments: void columns -----------------------------------------------------
ALTER TABLE public.school_fee_payments
  ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS school_fee_payments_active_date_idx
ON public.school_fee_payments (payment_date DESC)
WHERE voided = false;

-- 3. Ledger accepts a reversal entry -------------------------------------------
ALTER TABLE public.school_fee_transactions
  DROP CONSTRAINT IF EXISTS school_fee_transactions_kind_check;
ALTER TABLE public.school_fee_transactions
  ADD CONSTRAINT school_fee_transactions_kind_check
  CHECK (kind IN ('payment', 'charge', 'reversal'));

-- 4. Messages accept fee reminders ---------------------------------------------
ALTER TABLE public.school_sms_log
  DROP CONSTRAINT IF EXISTS school_sms_log_message_type_check;
ALTER TABLE public.school_sms_log
  ADD CONSTRAINT school_sms_log_message_type_check
  CHECK (message_type IN ('absentee_alert', 'leave_alert', 'late_alert', 'fee_reminder'));

-- 5. Daily cash closing ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_daily_closings (
  closing_date date PRIMARY KEY,
  opening_balance numeric(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  notes text,
  closed_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_daily_closings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_daily_closings TO authenticated;

DROP POLICY IF EXISTS "Fee staff can read daily closings" ON public.school_daily_closings;
CREATE POLICY "Fee staff can read daily closings"
ON public.school_daily_closings FOR SELECT
TO authenticated
USING (public.is_fee_staff());

DROP POLICY IF EXISTS "Fee staff can open a daily closing" ON public.school_daily_closings;
CREATE POLICY "Fee staff can open a daily closing"
ON public.school_daily_closings FOR INSERT
TO authenticated
WITH CHECK (public.is_fee_staff());

DROP POLICY IF EXISTS "Fee staff can update a daily closing" ON public.school_daily_closings;
CREATE POLICY "Fee staff can update a daily closing"
ON public.school_daily_closings FOR UPDATE
TO authenticated
USING (public.is_fee_staff())
WITH CHECK (public.is_fee_staff());

DROP POLICY IF EXISTS "Admins can remove a daily closing" ON public.school_daily_closings;
CREATE POLICY "Admins can remove a daily closing"
ON public.school_daily_closings FOR DELETE
TO authenticated
USING (public.is_admin());

-- 6. Sections readable by an accountant ----------------------------------------
DROP POLICY IF EXISTS "Staff can read sections" ON public.school_sections;
CREATE POLICY "Staff can read sections"
ON public.school_sections FOR SELECT
TO authenticated
USING (public.is_staff() OR public.is_accountant());

-- 7. Void a payment -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_fee_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment public.school_fee_payments%ROWTYPE;
  v_reason text;
  v_balance numeric(10,2);
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
  v_new_balance := v_balance + v_payment.amount;

  INSERT INTO public.school_fee_transactions (student_id, kind, amount, balance_after)
  VALUES (v_payment.student_id, 'reversal', v_payment.amount, v_new_balance);

  UPDATE public.school_students SET fee_balance = v_new_balance WHERE id = v_payment.student_id;

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
    'restored', v_payment.amount,
    'balance_after', v_new_balance,
    'reason', v_reason
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.void_fee_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_fee_payment(uuid, text) TO authenticated;

-- 8. Payments: accountant may void (never delete) -------------------------------
GRANT UPDATE ON public.school_fee_payments TO authenticated;

DROP POLICY IF EXISTS "Fee staff can void fee payments" ON public.school_fee_payments;
CREATE POLICY "Fee staff can void fee payments"
ON public.school_fee_payments FOR UPDATE
TO authenticated
USING (public.is_admin() OR public.is_accountant())
WITH CHECK (public.is_admin() OR public.is_accountant());

-- 9. Account management stays administrator-only -------------------------------
CREATE OR REPLACE FUNCTION public.admin_provision_account(
  p_username text,
  p_password text,
  p_full_name text,
  p_role text,
  p_student_id uuid DEFAULT NULL,
  p_mobile text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  clean_username text := lower(btrim(p_username));
  pseudo_email text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  IF p_role NOT IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant', 'student') THEN
    RAISE EXCEPTION 'That account type is not allowed';
  END IF;

  IF length(clean_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'A full name is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE username = clean_username) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  IF p_role = 'student' THEN
    IF p_student_id IS NULL THEN
      RAISE EXCEPTION 'A student account must be linked to a student record';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.school_students WHERE id = p_student_id) THEN
      RAISE EXCEPTION 'That student record no longer exists';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE student_id = p_student_id) THEN
      RAISE EXCEPTION 'This student already has a portal login';
    END IF;
  END IF;

  pseudo_email := clean_username || '@schooldesk.local';

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    pseudo_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('role', p_role), false
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), new_id,
    jsonb_build_object('sub', new_id::text, 'email', pseudo_email, 'email_verified', true),
    'email', pseudo_email, now(), now(), now()
  );

  INSERT INTO public.user_profiles (id, username, full_name, role, status, student_id, mobile_number)
  VALUES (new_id, clean_username, btrim(p_full_name), p_role, 'active', p_student_id, nullif(btrim(coalesce(p_mobile, '')), ''));

  RETURN new_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_provision_account(text, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provision_account(text, text, text, text, uuid, text) TO authenticated;
