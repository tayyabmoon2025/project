/*
# Staff payroll: pay packages, advances, provident fund and salary payments

1. Purpose
- Adds the four missing payroll screens to Staff Management: Pay Packages,
  Salary Advances, Provident Fund, and Pay Salary with its Paid History.
- Everything is stored in the school database, so payroll survives a reload and
  is visible to every administrator, not just the browser that typed it in.

2. New tables
- `school_staff_pay_packages` — one salary structure per staff member.
  * `basic_salary` — the monthly basic pay.
  * `house_rent_allowance`, `conveyance_allowance`, `medical_allowance`,
    `other_allowance` — the monthly allowances added to basic pay.
  * `pf_percentage` — the provident fund percentage taken from basic pay each month.
  * `absent_deduction_rate` — amount deducted for each absent day.
  * `late_deduction_rate` — amount deducted for each late day.
  * `effective_from`, `notes` — when the package starts and any remarks.
  * A unique key on the staff member means editing always updates the same row.

- `school_staff_advances` — a loan/advance given to a staff member.
  * `advance_date`, `amount`, `monthly_installment`, `purpose`.
  * `status` is 'active' while money is still owed and becomes 'closed'
    automatically once the instalments have repaid it in full.

- `school_staff_salary_payments` — one paid salary per staff member per month.
  * Keeps the full working: basic pay, every allowance, gross salary, absent and
    late days with their deductions, the advance instalment recovered, the
    provident fund deduction, any other deduction, the total deducted and the
    final net salary.
  * `advance_id` records which advance the instalment was recovered against, so
    each loan's outstanding balance stays accurate.
  * `payment_method`, `paid_on`, `note`, `paid_by` record how and when it was paid.
  * A unique key on (staff member, month) makes paying the same month twice
    impossible; the payment can be deleted from Paid History to correct a mistake.

- `school_staff_pf_contributions` — the monthly provident fund ledger.
  * `employee_contribution` is the amount taken from the salary and
    `school_contribution` is the matching amount the school adds.
  * One row per staff member per month, created automatically when salary is paid.

3. New functions
- `admin_save_staff_pay_package(...)` — creates or updates a staff member's pay
  package. Administrators only.
- `admin_save_staff_advance(...)` — records a new salary advance. Administrators only.
- `admin_close_staff_advance(...)` — marks an advance as fully settled.
- `admin_delete_staff_advance(...)` — removes an advance that was entered by mistake.
- `admin_delete_staff_salary_payment(...)` — undoes a paid salary, removing its
  provident fund entry as well, so the month can be paid again correctly.
- `staff_advance_outstanding(p_staff_user_id)` — how much of that staff member's
  active advances is still owed. Used to suggest the next instalment.
- `admin_pay_staff_salary(...)` — the whole calculation happens in the database:
  it loads the pay package, counts absent and late days from the staff attendance
  register for that month (unless the caller overrides them), works out gross
  salary, every deduction and the net salary, then writes the salary payment, the
  provident fund entry, and closes the advance when it has been repaid in full.
  It returns the complete slip so the app can print or message it.

4. Security
- Row level security is enabled on all four tables.
- Every table is readable by administrators only, through `can_manage_users()`.
  No write privilege is granted to the app at all: all changes go through the
  SECURITY DEFINER functions above, so a payroll record cannot be forged or
  edited from the browser.
- Each function checks the caller with `can_manage_users()` before touching a row,
  and `EXECUTE` is revoked from PUBLIC and anon and granted to authenticated only.

5. Notes
- Nothing existing is changed, dropped or renamed: no other table is touched, so
  staff records, attendance and every other module keep working exactly as before.
- Amounts are stored as exact decimals (numeric), never floating point, so money
  totals stay accurate.
- Net salary is never allowed to fall below zero.
*/

CREATE TABLE IF NOT EXISTS public.school_staff_pay_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  house_rent_allowance numeric(12,2) NOT NULL DEFAULT 0,
  conveyance_allowance numeric(12,2) NOT NULL DEFAULT 0,
  medical_allowance numeric(12,2) NOT NULL DEFAULT 0,
  other_allowance numeric(12,2) NOT NULL DEFAULT 0,
  pf_percentage numeric(5,2) NOT NULL DEFAULT 0,
  absent_deduction_rate numeric(12,2) NOT NULL DEFAULT 0,
  late_deduction_rate numeric(12,2) NOT NULL DEFAULT 0,
  effective_from date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_staff_pay_packages_staff_key UNIQUE (staff_user_id)
);

CREATE TABLE IF NOT EXISTS public.school_staff_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  advance_date date NOT NULL DEFAULT current_date,
  amount numeric(12,2) NOT NULL,
  monthly_installment numeric(12,2) NOT NULL DEFAULT 0,
  purpose text,
  status text NOT NULL DEFAULT 'active',
  closed_on date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_staff_advances_status_check CHECK (status IN ('active', 'closed'))
);

CREATE TABLE IF NOT EXISTS public.school_staff_salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  staff_name text NOT NULL DEFAULT '',
  staff_role text NOT NULL DEFAULT '',
  basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  house_rent_allowance numeric(12,2) NOT NULL DEFAULT 0,
  conveyance_allowance numeric(12,2) NOT NULL DEFAULT 0,
  medical_allowance numeric(12,2) NOT NULL DEFAULT 0,
  other_allowance numeric(12,2) NOT NULL DEFAULT 0,
  gross_salary numeric(12,2) NOT NULL DEFAULT 0,
  absent_days integer NOT NULL DEFAULT 0,
  late_days integer NOT NULL DEFAULT 0,
  absent_deduction numeric(12,2) NOT NULL DEFAULT 0,
  late_deduction numeric(12,2) NOT NULL DEFAULT 0,
  advance_deduction numeric(12,2) NOT NULL DEFAULT 0,
  pf_deduction numeric(12,2) NOT NULL DEFAULT 0,
  other_deduction numeric(12,2) NOT NULL DEFAULT 0,
  total_deductions numeric(12,2) NOT NULL DEFAULT 0,
  net_salary numeric(12,2) NOT NULL DEFAULT 0,
  advance_id uuid REFERENCES public.school_staff_advances(id) ON DELETE SET NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  paid_on date NOT NULL DEFAULT current_date,
  note text,
  paid_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_staff_salary_payments_period_key UNIQUE (staff_user_id, period_month)
);

CREATE TABLE IF NOT EXISTS public.school_staff_pf_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  employee_contribution numeric(12,2) NOT NULL DEFAULT 0,
  school_contribution numeric(12,2) NOT NULL DEFAULT 0,
  payment_id uuid REFERENCES public.school_staff_salary_payments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_staff_pf_contributions_period_key UNIQUE (staff_user_id, period_month)
);

CREATE INDEX IF NOT EXISTS school_staff_salary_payments_staff_idx
  ON public.school_staff_salary_payments (staff_user_id, period_month DESC);

CREATE INDEX IF NOT EXISTS school_staff_advances_staff_idx
  ON public.school_staff_advances (staff_user_id, status);

ALTER TABLE public.school_staff_pay_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_staff_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_staff_salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_staff_pf_contributions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_staff_pay_packages TO authenticated;
GRANT SELECT ON public.school_staff_advances TO authenticated;
GRANT SELECT ON public.school_staff_salary_payments TO authenticated;
GRANT SELECT ON public.school_staff_pf_contributions TO authenticated;

DROP POLICY IF EXISTS "Administrators can read pay packages" ON public.school_staff_pay_packages;
CREATE POLICY "Administrators can read pay packages"
ON public.school_staff_pay_packages FOR SELECT
TO authenticated
USING (public.can_manage_users());

DROP POLICY IF EXISTS "Administrators can read staff advances" ON public.school_staff_advances;
CREATE POLICY "Administrators can read staff advances"
ON public.school_staff_advances FOR SELECT
TO authenticated
USING (public.can_manage_users());

DROP POLICY IF EXISTS "Administrators can read salary payments" ON public.school_staff_salary_payments;
CREATE POLICY "Administrators can read salary payments"
ON public.school_staff_salary_payments FOR SELECT
TO authenticated
USING (public.can_manage_users());

DROP POLICY IF EXISTS "Administrators can read pf contributions" ON public.school_staff_pf_contributions;
CREATE POLICY "Administrators can read pf contributions"
ON public.school_staff_pf_contributions FOR SELECT
TO authenticated
USING (public.can_manage_users());

CREATE OR REPLACE FUNCTION public.admin_save_staff_pay_package(
  p_staff_user_id uuid,
  p_basic_salary numeric,
  p_house_rent_allowance numeric,
  p_conveyance_allowance numeric,
  p_medical_allowance numeric,
  p_other_allowance numeric,
  p_pf_percentage numeric,
  p_absent_deduction_rate numeric,
  p_late_deduction_rate numeric,
  p_effective_from date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change pay packages';
  END IF;

  IF p_staff_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_staff_user_id AND role IN ('admin', 'teacher', 'accountant', 'office_assistant')
  ) THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;

  IF coalesce(p_basic_salary, 0) < 0
     OR coalesce(p_house_rent_allowance, 0) < 0
     OR coalesce(p_conveyance_allowance, 0) < 0
     OR coalesce(p_medical_allowance, 0) < 0
     OR coalesce(p_other_allowance, 0) < 0
     OR coalesce(p_pf_percentage, 0) < 0
     OR coalesce(p_absent_deduction_rate, 0) < 0
     OR coalesce(p_late_deduction_rate, 0) < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative';
  END IF;

  INSERT INTO public.school_staff_pay_packages (
    staff_user_id, basic_salary, house_rent_allowance, conveyance_allowance,
    medical_allowance, other_allowance, pf_percentage, absent_deduction_rate,
    late_deduction_rate, effective_from, notes
  )
  VALUES (
    p_staff_user_id, coalesce(p_basic_salary, 0), coalesce(p_house_rent_allowance, 0),
    coalesce(p_conveyance_allowance, 0), coalesce(p_medical_allowance, 0),
    coalesce(p_other_allowance, 0), coalesce(p_pf_percentage, 0),
    coalesce(p_absent_deduction_rate, 0), coalesce(p_late_deduction_rate, 0),
    p_effective_from, nullif(btrim(coalesce(p_notes, '')), '')
  )
  ON CONFLICT (staff_user_id) DO UPDATE SET
    basic_salary = excluded.basic_salary,
    house_rent_allowance = excluded.house_rent_allowance,
    conveyance_allowance = excluded.conveyance_allowance,
    medical_allowance = excluded.medical_allowance,
    other_allowance = excluded.other_allowance,
    pf_percentage = excluded.pf_percentage,
    absent_deduction_rate = excluded.absent_deduction_rate,
    late_deduction_rate = excluded.late_deduction_rate,
    effective_from = excluded.effective_from,
    notes = excluded.notes,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'staff_user_id', p_staff_user_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_save_staff_pay_package(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_staff_pay_package(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_staff_advance(
  p_staff_user_id uuid,
  p_advance_date date,
  p_amount numeric,
  p_monthly_installment numeric,
  p_purpose text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can record salary advances';
  END IF;

  IF p_staff_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_staff_user_id AND role IN ('admin', 'teacher', 'accountant', 'office_assistant')
  ) THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;

  IF coalesce(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Enter the advance amount';
  END IF;

  IF coalesce(p_monthly_installment, 0) < 0 THEN
    RAISE EXCEPTION 'The monthly instalment cannot be negative';
  END IF;

  INSERT INTO public.school_staff_advances (
    staff_user_id, advance_date, amount, monthly_installment, purpose, created_by
  )
  VALUES (
    p_staff_user_id,
    coalesce(p_advance_date, current_date),
    p_amount,
    coalesce(p_monthly_installment, 0),
    nullif(btrim(coalesce(p_purpose, '')), ''),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'staff_user_id', p_staff_user_id, 'amount', p_amount);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_save_staff_advance(uuid, date, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_staff_advance(uuid, date, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_close_staff_advance(p_advance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can settle salary advances';
  END IF;

  UPDATE public.school_staff_advances
  SET status = 'closed', closed_on = current_date
  WHERE id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That advance could not be found';
  END IF;

  RETURN jsonb_build_object('id', p_advance_id, 'status', 'closed');
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_close_staff_advance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_staff_advance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_staff_advance(p_advance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recovered numeric;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove salary advances';
  END IF;

  SELECT coalesce(sum(advance_deduction), 0) INTO v_recovered
  FROM public.school_staff_salary_payments
  WHERE advance_id = p_advance_id;

  IF v_recovered > 0 THEN
    RAISE EXCEPTION 'This advance already has salary deductions against it. Mark it settled instead.';
  END IF;

  DELETE FROM public.school_staff_advances WHERE id = p_advance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That advance could not be found';
  END IF;

  RETURN jsonb_build_object('id', p_advance_id, 'deleted', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_staff_advance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_advance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_staff_salary_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_staff uuid;
  v_month date;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can undo a salary payment';
  END IF;

  SELECT staff_user_id, period_month INTO v_staff, v_month
  FROM public.school_staff_salary_payments
  WHERE id = p_payment_id;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'That salary payment could not be found';
  END IF;

  DELETE FROM public.school_staff_pf_contributions WHERE payment_id = p_payment_id;
  DELETE FROM public.school_staff_salary_payments WHERE id = p_payment_id;

  UPDATE public.school_staff_advances
  SET status = 'active', closed_on = NULL
  WHERE staff_user_id = v_staff AND status = 'closed'
    AND coalesce(amount, 0) > (
      SELECT coalesce(sum(advance_deduction), 0)
      FROM public.school_staff_salary_payments
      WHERE advance_id = public.school_staff_advances.id
    );

  RETURN jsonb_build_object('id', p_payment_id, 'period_month', v_month);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_staff_salary_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_salary_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_advance_outstanding(p_staff_user_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(sum(
    a.amount - coalesce((
      SELECT sum(p.advance_deduction)
      FROM public.school_staff_salary_payments p
      WHERE p.advance_id = a.id
    ), 0)
  ), 0)
  FROM public.school_staff_advances a
  WHERE a.staff_user_id = p_staff_user_id
    AND a.status = 'active'
    AND public.can_manage_users();
$$;

REVOKE EXECUTE ON FUNCTION public.staff_advance_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_advance_outstanding(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_pay_staff_salary(
  p_staff_user_id uuid,
  p_period_month date,
  p_absent_days integer DEFAULT NULL,
  p_late_days integer DEFAULT NULL,
  p_advance_deduction numeric DEFAULT NULL,
  p_other_deduction numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_package public.school_staff_pay_packages%ROWTYPE;
  v_staff public.user_profiles%ROWTYPE;
  v_month date;
  v_absent integer;
  v_late integer;
  v_allowances numeric;
  v_gross numeric;
  v_absent_deduction numeric;
  v_late_deduction numeric;
  v_pf numeric;
  v_advance numeric := 0;
  v_other numeric;
  v_total numeric;
  v_net numeric;
  v_advance_row public.school_staff_advances%ROWTYPE;
  v_outstanding numeric;
  v_advance_id uuid;
  v_payment_id uuid;
  v_paid_on date := current_date;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can pay salaries';
  END IF;

  v_month := date_trunc('month', coalesce(p_period_month, current_date))::date;

  SELECT * INTO v_staff FROM public.user_profiles WHERE id = p_staff_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;

  SELECT * INTO v_package FROM public.school_staff_pay_packages WHERE staff_user_id = p_staff_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Set up a pay package for this staff member first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.school_staff_salary_payments
    WHERE staff_user_id = p_staff_user_id AND period_month = v_month
  ) THEN
    RAISE EXCEPTION 'Salary for this month has already been paid';
  END IF;

  IF p_absent_days IS NULL THEN
    SELECT count(*) INTO v_absent
    FROM public.school_staff_attendance
    WHERE staff_user_id = p_staff_user_id
      AND status = 'absent'
      AND attendance_date >= v_month
      AND attendance_date < (v_month + interval '1 month');
  ELSE
    v_absent := greatest(coalesce(p_absent_days, 0), 0);
  END IF;

  IF p_late_days IS NULL THEN
    SELECT count(*) INTO v_late
    FROM public.school_staff_attendance
    WHERE staff_user_id = p_staff_user_id
      AND status = 'late'
      AND attendance_date >= v_month
      AND attendance_date < (v_month + interval '1 month');
  ELSE
    v_late := greatest(coalesce(p_late_days, 0), 0);
  END IF;

  v_allowances := v_package.house_rent_allowance + v_package.conveyance_allowance
                + v_package.medical_allowance + v_package.other_allowance;
  v_gross := v_package.basic_salary + v_allowances;
  v_absent_deduction := round(v_absent * v_package.absent_deduction_rate, 2);
  v_late_deduction := round(v_late * v_package.late_deduction_rate, 2);
  v_pf := round(v_package.basic_salary * v_package.pf_percentage / 100, 2);

  IF coalesce(p_advance_deduction, 0) > 0 THEN
    SELECT * INTO v_advance_row
    FROM public.school_staff_advances
    WHERE staff_user_id = p_staff_user_id AND status = 'active'
    ORDER BY advance_date, created_at
    LIMIT 1;

    IF FOUND THEN
      SELECT v_advance_row.amount - coalesce((
        SELECT sum(p.advance_deduction) FROM public.school_staff_salary_payments p
        WHERE p.advance_id = v_advance_row.id
      ), 0) INTO v_outstanding;

      v_advance := least(greatest(coalesce(p_advance_deduction, 0), 0), greatest(v_outstanding, 0));
      IF v_advance > 0 THEN
        v_advance_id := v_advance_row.id;
      ELSE
        v_advance := 0;
      END IF;
    END IF;
  END IF;

  v_other := greatest(coalesce(p_other_deduction, 0), 0);
  v_total := v_absent_deduction + v_late_deduction + v_advance + v_pf + v_other;
  v_net := greatest(v_gross - v_total, 0);

  INSERT INTO public.school_staff_salary_payments (
    staff_user_id, period_month, staff_name, staff_role, basic_salary,
    house_rent_allowance, conveyance_allowance, medical_allowance, other_allowance,
    gross_salary, absent_days, late_days, absent_deduction, late_deduction,
    advance_deduction, pf_deduction, other_deduction, total_deductions, net_salary,
    advance_id, payment_method, paid_on, note, paid_by
  )
  VALUES (
    p_staff_user_id, v_month, v_staff.full_name, v_staff.role, v_package.basic_salary,
    v_package.house_rent_allowance, v_package.conveyance_allowance,
    v_package.medical_allowance, v_package.other_allowance,
    v_gross, v_absent, v_late, v_absent_deduction, v_late_deduction,
    v_advance, v_pf, v_other, v_total, v_net,
    v_advance_id, coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash'),
    v_paid_on, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  )
  RETURNING id INTO v_payment_id;

  IF v_pf > 0 THEN
    INSERT INTO public.school_staff_pf_contributions (
      staff_user_id, period_month, basic_salary, employee_contribution,
      school_contribution, payment_id
    )
    VALUES (p_staff_user_id, v_month, v_package.basic_salary, v_pf, v_pf, v_payment_id)
    ON CONFLICT (staff_user_id, period_month) DO NOTHING;
  END IF;

  IF v_advance_id IS NOT NULL THEN
    SELECT v_advance_row.amount - coalesce((
      SELECT sum(p.advance_deduction) FROM public.school_staff_salary_payments p
      WHERE p.advance_id = v_advance_id
    ), 0) INTO v_outstanding;

    IF v_outstanding <= 0 THEN
      UPDATE public.school_staff_advances
      SET status = 'closed', closed_on = v_paid_on
      WHERE id = v_advance_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_payment_id,
    'staff_user_id', p_staff_user_id,
    'staff_name', v_staff.full_name,
    'staff_role', v_staff.role,
    'period_month', v_month,
    'basic_salary', v_package.basic_salary,
    'house_rent_allowance', v_package.house_rent_allowance,
    'conveyance_allowance', v_package.conveyance_allowance,
    'medical_allowance', v_package.medical_allowance,
    'other_allowance', v_package.other_allowance,
    'gross_salary', v_gross,
    'absent_days', v_absent,
    'late_days', v_late,
    'absent_deduction', v_absent_deduction,
    'late_deduction', v_late_deduction,
    'advance_deduction', v_advance,
    'pf_deduction', v_pf,
    'other_deduction', v_other,
    'total_deductions', v_total,
    'net_salary', v_net,
    'payment_method', coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'cash'),
    'paid_on', v_paid_on
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_pay_staff_salary(uuid, date, integer, integer, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pay_staff_salary(uuid, date, integer, integer, numeric, numeric, text, text) TO authenticated;
