/*
# Formatted fee challan numbers (CH-<admission digits>-<YYYYMM>)

## 1. What this changes
Fee challans previously received a generic sequence number (CH-000001) that only
existed *after* the challan was saved, so a printed preview showed the placeholder
text "Generated on save". This migration makes the challan number a readable,
student-specific code that is known before saving and never changes afterwards.

New number format: `CH-<digits of the admission number>-<fee month as YYYYMM>`
Example: admission no. `SD-2401`, fee month `2026-11` -> `CH-2401-202611`.

## 2. New functions
- `public.fee_challan_number_for(p_student_id uuid, p_month text) returns text`
  Internal generator. Derives the code from the student's admission number and the
  fee month. If a challan for that student and month already exists it returns the
  number already stored on it, so a re-print always shows the same code. If that
  code is taken it appends a two-digit suffix (`-01`, `-02`, ...). Raises a readable
  error when the student is missing or has no admission number.
- `public.next_fee_challan_number(p_student_id uuid, p_month text default null)
  returns text` — staff-only RPC wrapper used by the app to show the number on a
  challan preview before it is saved.

## 3. Modified functions
- `public.assign_fee_challan_number()` (BEFORE INSERT trigger on
  `public.school_fee_challans`) now fills a blank challan number with the formatted
  code instead of the old sequence. The saved number is therefore identical to the
  one already printed on the preview.

## 4. Removed
- Sequence `public.school_fee_challan_number_seq`, no longer referenced by anything.
  Existing challan numbers (CH-000001 style) are left exactly as they are, because
  they are printed on challans that families already hold.

## 5. Security
- `fee_challan_number_for` is a SECURITY DEFINER helper: EXECUTE is revoked from
  PUBLIC, anon and authenticated (it is called by the trigger and by the wrapper).
- `next_fee_challan_number` is SECURITY DEFINER, checks `is_staff()` before doing
  anything, has EXECUTE revoked from PUBLIC and anon, and is granted to
  authenticated only.
- `assign_fee_challan_number` becomes SECURITY DEFINER so the trigger can call the
  internal generator; it stays bound to BEFORE INSERT and only ever fills a blank
  number, never overwriting one supplied by the application.
- No table, column or row is modified; no policies change.

## 6. Notes
- The generator takes a transaction-level advisory lock on the candidate code so two
  staff members generating the same student and month at the same time cannot pick
  the same suffix.
- Re-running this migration is safe: every function is CREATE OR REPLACE and the
  sequence drop is IF EXISTS.
*/

CREATE OR REPLACE FUNCTION public.fee_challan_number_for(p_student_id uuid, p_month text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admission text;
  v_month text;
  v_base text;
  v_existing text;
  v_candidate text;
  v_suffix integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.school_students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'That student no longer exists';
  END IF;

  SELECT regexp_replace(coalesce(admission_number, ''), '[^0-9]', '', 'g')
    INTO v_admission
    FROM public.school_students
   WHERE id = p_student_id;

  IF coalesce(v_admission, '') = '' THEN
    RAISE EXCEPTION 'That student has no admission number, so a challan number cannot be built';
  END IF;

  v_month := nullif(btrim(coalesce(p_month, '')), '');
  IF v_month IS NULL THEN
    v_month := to_char(CURRENT_DATE, 'YYYY-MM');
  END IF;
  IF v_month !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'That fee month is not valid';
  END IF;

  v_base := 'CH-' || v_admission || '-' || replace(v_month, '-', '');

  -- A challan already issued for this student and month keeps the number it was
  -- printed with.
  SELECT challan_number
    INTO v_existing
    FROM public.school_fee_challans
   WHERE student_id = p_student_id
     AND month = v_month
   LIMIT 1;

  IF coalesce(btrim(v_existing), '') <> '' THEN
    RETURN v_existing;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_base));

  v_candidate := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.school_fee_challans WHERE upper(challan_number) = v_candidate
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || lpad(v_suffix::text, 2, '0');
  END LOOP;

  RETURN v_candidate;
END $$;

REVOKE EXECUTE ON FUNCTION public.fee_challan_number_for(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_fee_challan_number(p_student_id uuid, p_month text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN public.fee_challan_number_for(p_student_id, p_month);
END $$;

REVOKE EXECUTE ON FUNCTION public.next_fee_challan_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_fee_challan_number(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_fee_challan_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.challan_number IS NULL OR btrim(NEW.challan_number) = '' THEN
    NEW.challan_number := public.fee_challan_number_for(NEW.student_id, NEW.month);
  END IF;
  RETURN NEW;
END $$;

DROP SEQUENCE IF EXISTS public.school_fee_challan_number_seq;
