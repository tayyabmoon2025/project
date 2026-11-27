/*
# Finance module: expenses, other income and the general ledger

## 1. Purpose
Adds a small accounting layer to SchoolDesk so the office can record what the school
spends and what it earns outside fees, then see those figures together with the fee
money already collected.

## 2. New tables

### `school_ledger_accounts` — the chart of accounts
The single list of money heads. Every head is either `income` or `expense`.
- `id` (uuid, primary key)
- `name` (text) — the head name, e.g. "Electricity bill" or "Donations"
- `account_type` (text) — `income` or `expense`
- `is_active` (boolean) — hidden heads stay on old records but leave the pickers
- `sort_order` (integer) — display order
- `created_at` (timestamptz)
A unique index on `(account_type, lower(name))` stops the same head being created twice.
A starter set of common heads is inserted only when the table is empty, so an existing
school that has already renamed its heads is never overwritten.

### `school_expenses` — money the school pays out
- `id`, `expense_date` (date), `category_id` (uuid → `school_ledger_accounts`)
- `amount` (numeric, must be greater than zero)
- `payment_mode` (text) — cash, bank, cheque, online or other
- `paid_to` (text) — who received the money
- `reference` (text) — bill or voucher number
- `description` (text)
- `created_by` (uuid, defaults to the signed-in user), `created_at`, `updated_at`

### `school_other_income` — money the school earns outside fees
- `id`, `income_date` (date), `category_id` (uuid → `school_ledger_accounts`)
- `amount` (numeric, must be greater than zero)
- `payment_mode` (text)
- `reference` (text)
- `notes` (text)
- `created_by` (uuid, defaults to the signed-in user), `created_at`, `updated_at`

## 3. The general ledger function
`public.finance_ledger_entries(p_from date, p_to date)` returns one chronological row
per money movement for the requested period, derived live from three sources:
- fee receipts already recorded in `school_fee_payments` (a debit / money in),
- rows in `school_other_income` (a debit / money in),
- rows in `school_expenses` (a credit / money out).

Each row carries the running balance, so the ledger always agrees with the fee
collection screens without copying the money into a second table. Nothing is duplicated
and nothing needs re-syncing. Receipts that were reversed still appear, marked as
reversed and excluded from the balance, so the day's history stays complete.

The function is `SECURITY DEFINER` and checks the caller is a member of staff before
returning anything. Only authenticated staff may execute it.

## 4. Security
- Row level security is enabled on all three new tables.
- Staff may read all finance rows. Administrators, accountants and the office
  assistant may add and edit. Only administrators may delete a record.
- The ledger accounts are readable by all staff, writable by the same finance roles,
  and removable only by an administrator.
- Every table is granted to `authenticated` only; the anon role gets nothing, matching
  the rest of the school schema.

## 5. Notes
- No existing table is altered and no data is deleted by this migration.
- Re-running this migration is safe: every statement is guarded with IF EXISTS /
  IF NOT EXISTS or a matching DROP POLICY IF EXISTS.
*/

-- 1. Chart of accounts ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('income', 'expense')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_ledger_accounts_type_name_key
  ON public.school_ledger_accounts (account_type, lower(btrim(name)));

INSERT INTO public.school_ledger_accounts (name, account_type, sort_order)
SELECT seed.name, seed.account_type, seed.sort_order
FROM (VALUES
  ('Tuition fee', 'income', 10),
  ('Admission fee', 'income', 20),
  ('Exam fee', 'income', 30),
  ('Transport fee', 'income', 40),
  ('Donations', 'income', 50),
  ('Rent of hall', 'income', 60),
  ('Sale of old furniture', 'income', 70),
  ('Miscellaneous income', 'income', 90),
  ('Salaries', 'expense', 10),
  ('Electricity bill', 'expense', 20),
  ('Water bill', 'expense', 30),
  ('Gas bill', 'expense', 40),
  ('Internet and telephone', 'expense', 50),
  ('Building repairs', 'expense', 60),
  ('Furniture and equipment', 'expense', 70),
  ('Stationery and printing', 'expense', 80),
  ('Examination expenses', 'expense', 90),
  ('Transport and fuel', 'expense', 100),
  ('Cleaning and maintenance', 'expense', 110),
  ('Marketing and advertising', 'expense', 120),
  ('Miscellaneous expense', 'expense', 190)
) AS seed(name, account_type, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.school_ledger_accounts);

ALTER TABLE public.school_ledger_accounts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_ledger_accounts TO authenticated;

DROP POLICY IF EXISTS "Staff can read ledger accounts" ON public.school_ledger_accounts;
CREATE POLICY "Staff can read ledger accounts"
ON public.school_ledger_accounts FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Finance staff can add ledger accounts" ON public.school_ledger_accounts;
CREATE POLICY "Finance staff can add ledger accounts"
ON public.school_ledger_accounts FOR INSERT
TO authenticated
WITH CHECK (public.is_fee_staff());

DROP POLICY IF EXISTS "Finance staff can edit ledger accounts" ON public.school_ledger_accounts;
CREATE POLICY "Finance staff can edit ledger accounts"
ON public.school_ledger_accounts FOR UPDATE
TO authenticated
USING (public.is_fee_staff())
WITH CHECK (public.is_fee_staff());

DROP POLICY IF EXISTS "Admins can remove ledger accounts" ON public.school_ledger_accounts;
CREATE POLICY "Admins can remove ledger accounts"
ON public.school_ledger_accounts FOR DELETE
TO authenticated
USING (public.is_admin());

-- 2. Expenses ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  category_id uuid REFERENCES public.school_ledger_accounts(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL DEFAULT 'cash',
  paid_to text,
  reference text,
  description text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_expenses_date_idx ON public.school_expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS school_expenses_category_idx ON public.school_expenses (category_id);

ALTER TABLE public.school_expenses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_expenses TO authenticated;

DROP POLICY IF EXISTS "Staff can read expenses" ON public.school_expenses;
CREATE POLICY "Staff can read expenses"
ON public.school_expenses FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Finance staff can add expenses" ON public.school_expenses;
CREATE POLICY "Finance staff can add expenses"
ON public.school_expenses FOR INSERT
TO authenticated
WITH CHECK (public.is_fee_staff() AND created_by = auth.uid());

DROP POLICY IF EXISTS "Finance staff can edit expenses" ON public.school_expenses;
CREATE POLICY "Finance staff can edit expenses"
ON public.school_expenses FOR UPDATE
TO authenticated
USING (public.is_fee_staff())
WITH CHECK (public.is_fee_staff());

DROP POLICY IF EXISTS "Admins can remove expenses" ON public.school_expenses;
CREATE POLICY "Admins can remove expenses"
ON public.school_expenses FOR DELETE
TO authenticated
USING (public.is_admin());

-- 3. Other income --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_other_income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  income_date date NOT NULL DEFAULT CURRENT_DATE,
  category_id uuid REFERENCES public.school_ledger_accounts(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_other_income_date_idx ON public.school_other_income (income_date DESC);
CREATE INDEX IF NOT EXISTS school_other_income_category_idx ON public.school_other_income (category_id);

ALTER TABLE public.school_other_income ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_other_income TO authenticated;

DROP POLICY IF EXISTS "Staff can read other income" ON public.school_other_income;
CREATE POLICY "Staff can read other income"
ON public.school_other_income FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Finance staff can add other income" ON public.school_other_income;
CREATE POLICY "Finance staff can add other income"
ON public.school_other_income FOR INSERT
TO authenticated
WITH CHECK (public.is_fee_staff() AND created_by = auth.uid());

DROP POLICY IF EXISTS "Finance staff can edit other income" ON public.school_other_income;
CREATE POLICY "Finance staff can edit other income"
ON public.school_other_income FOR UPDATE
TO authenticated
USING (public.is_fee_staff())
WITH CHECK (public.is_fee_staff());

DROP POLICY IF EXISTS "Admins can remove other income" ON public.school_other_income;
CREATE POLICY "Admins can remove other income"
ON public.school_other_income FOR DELETE
TO authenticated
USING (public.is_admin());

-- 4. The general ledger --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_ledger_entries(p_from date, p_to date)
RETURNS TABLE (
  entry_id bigint,
  entry_date date,
  created_at timestamptz,
  entry_kind text,
  account_id uuid,
  account_name text,
  reference text,
  description text,
  payment_mode text,
  debit numeric,
  credit numeric,
  balance numeric,
  is_voided boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_id bigint := 0;
  v_balance numeric := 0;
  v_debit numeric;
  v_credit numeric;
  v_fee_account uuid;
  v_fee_account_name text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Every fee receipt is filed under the school's tuition head when one exists.
  SELECT a.id, a.name INTO v_fee_account, v_fee_account_name
  FROM public.school_ledger_accounts a
  WHERE a.account_type = 'income' AND lower(btrim(a.name)) = 'tuition fee'
  LIMIT 1;

  FOR v_row IN
    SELECT * FROM (
      SELECT
        p.payment_date AS entry_date,
        p.created_at AS created_at,
        'fee_collection'::text AS entry_kind,
        v_fee_account AS account_id,
        COALESCE(v_fee_account_name, 'Tuition fee') AS account_name,
        p.receipt_number AS reference,
        'Fee collected — ' || COALESCE(s.full_name, 'student')
          || CASE WHEN s.class_name IS NOT NULL THEN ' (' || s.class_name || ')' ELSE '' END AS description,
        p.method AS payment_mode,
        p.amount AS debit,
        0::numeric AS credit,
        p.voided AS is_voided
      FROM public.school_fee_payments p
      LEFT JOIN public.school_students s ON s.id = p.student_id
      WHERE (p_from IS NULL OR p.payment_date >= p_from)
        AND (p_to IS NULL OR p.payment_date <= p_to)

      UNION ALL

      SELECT
        o.income_date,
        o.created_at,
        'other_income'::text,
        o.category_id,
        COALESCE(oa.name, 'Uncategorised income'),
        o.reference,
        COALESCE(NULLIF(btrim(o.notes), ''), 'Other income'),
        o.payment_mode,
        o.amount,
        0::numeric,
        false
      FROM public.school_other_income o
      LEFT JOIN public.school_ledger_accounts oa ON oa.id = o.category_id
      WHERE (p_from IS NULL OR o.income_date >= p_from)
        AND (p_to IS NULL OR o.income_date <= p_to)

      UNION ALL

      SELECT
        e.expense_date,
        e.created_at,
        'expense'::text,
        e.category_id,
        COALESCE(ea.name, 'Uncategorised expense'),
        e.reference,
        COALESCE(NULLIF(btrim(e.description), ''), 'Expense')
          || CASE WHEN e.paid_to IS NOT NULL AND btrim(e.paid_to) <> '' THEN ' — paid to ' || e.paid_to ELSE '' END,
        e.payment_mode,
        0::numeric,
        e.amount,
        false
      FROM public.school_expenses e
      LEFT JOIN public.school_ledger_accounts ea ON ea.id = e.category_id
      WHERE (p_from IS NULL OR e.expense_date >= p_from)
        AND (p_to IS NULL OR e.expense_date <= p_to)
    ) AS ledger_rows
    ORDER BY ledger_rows.entry_date, ledger_rows.created_at
  LOOP
    -- A reversed receipt is shown so the history is complete, but it must not move
    -- the balance: the money was taken in and given back.
    v_debit := CASE WHEN v_row.is_voided THEN 0 ELSE COALESCE(v_row.debit, 0) END;
    v_credit := CASE WHEN v_row.is_voided THEN 0 ELSE COALESCE(v_row.credit, 0) END;
    v_balance := v_balance + v_debit - v_credit;
    v_id := v_id + 1;

    entry_id := v_id;
    entry_date := v_row.entry_date;
    created_at := v_row.created_at;
    entry_kind := v_row.entry_kind;
    account_id := v_row.account_id;
    account_name := v_row.account_name;
    reference := v_row.reference;
    description := v_row.description || CASE WHEN v_row.is_voided THEN ' (reversed)' ELSE '' END;
    payment_mode := v_row.payment_mode;
    debit := v_debit;
    credit := v_credit;
    balance := v_balance;
    is_voided := v_row.is_voided;

    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finance_ledger_entries(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_ledger_entries(date, date) TO authenticated;
