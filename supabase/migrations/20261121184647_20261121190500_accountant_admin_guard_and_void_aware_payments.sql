/*
# Accountant portal: lock account management to admins and honour voided payments

## 1. Purpose
Follow-up to the accountant access change. Two things are tightened here:

1. Account management functions now require `can_manage_users()` (an active
   administrator) instead of the looser `is_admin()` check. Behaviour is identical for
   administrators; the point is a single, explicit authority for account management so
   no other role can create, rename, re-password, suspend or remove accounts by calling
   the API directly.
2. `record_fee_payment(...)` now ignores reversed (voided) payments when it works out how
   much of a challan has been paid, so a void can never leave a challan showing "paid".

## 2. Functions re-created (no signature changes)
- `admin_set_password(p_user_id, p_password)` — still refuses to change another
  administrator's password; now gated by `can_manage_users()`.
- `admin_reset_username(p_user_id, p_username)` — unchanged rules, gated by
  `can_manage_users()`.
- `admin_set_account_status(p_user_id, p_status)` — unchanged rules (self-suspension and
  last-administrator protection kept), gated by `can_manage_users()`.
- `admin_remove_user(p_user_id)` — unchanged rules (cannot remove yourself), gated by
  `can_manage_users()`.
- `record_fee_payment(...)` — full existing behaviour plus `voided = false` in the two
  challan-paid calculations.

## 3. Security
- No new grants are opened. EXECUTE stays revoked from PUBLIC and anon for every function
  here and granted only to `authenticated`.
- All are SECURITY DEFINER with a fixed `search_path`.

## 4. Notes
- No row is created, changed or deleted by this migration.
- These re-creations are idempotent and safe to re-run.
*/

-- 1. Password reset -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_password(
  p_user_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  target_role text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can reset passwords';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  SELECT role INTO target_role FROM public.user_profiles WHERE id = p_user_id;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF target_role = 'admin' AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'An administrator password can only be changed by that administrator';
  END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_password(uuid, text) TO authenticated;

-- 2. Username change ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_username(
  p_user_id uuid,
  p_username text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  clean_username text := lower(btrim(p_username));
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change usernames';
  END IF;

  IF length(clean_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE username = clean_username AND id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  UPDATE public.user_profiles SET username = clean_username WHERE id = p_user_id;
  UPDATE auth.users
     SET email = clean_username || '@schooldesk.local', updated_at = now()
   WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_reset_username(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_username(uuid, text) TO authenticated;

-- 3. Suspend / reactivate -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_user_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  remaining_admins int;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change account status';
  END IF;

  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Account status must be active or suspended';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF p_status = 'suspended' THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot suspend your own account';
    END IF;

    SELECT count(*) INTO remaining_admins
      FROM public.user_profiles
     WHERE role = 'admin' AND status = 'active' AND id <> p_user_id;

    IF EXISTS (
      SELECT 1 FROM public.user_profiles
       WHERE id = p_user_id AND role = 'admin' AND status = 'active'
    ) AND remaining_admins = 0 THEN
      RAISE EXCEPTION 'The last administrator account cannot be suspended';
    END IF;
  END IF;

  UPDATE public.user_profiles SET status = p_status WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid, text) TO authenticated;

-- 4. Remove an account ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_remove_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove accounts';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove your own account';
  END IF;

  DELETE FROM public.user_profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_remove_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_user(uuid) TO authenticated;

-- 5. record_fee_payment ignores reversed payments -------------------------------
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
    'balance_after', v_new_balance,
    'payment_date', v_payment_date,
    'method', v_method,
    'challan_number', v_challan.challan_number,
    'challan_status', v_status
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, text, date, text, text, text, text) TO authenticated;
