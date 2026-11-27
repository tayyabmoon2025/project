/*
# Resolve a formatted challan code (CH-<admission digits>-<YYYYMM>)

## 1. What this changes
`public.resolve_fee_challan(p_code text)` gains one extra lookup path so the
formatted challan number that is now printed on a challan *preview* (before the
challan row exists) can still be scanned and resolved.

The function now tries, in order:
1. an exact challan number match (unchanged, and it wins first, so a saved challan
   always resolves to itself);
2. `CH-<admission digits>-<YYYYMM>` — the new formatted code. The student is found by
   comparing the digits of their admission number, and the month is read from the
   code. This is what makes a printed preview challan scannable;
3. `"<admission number>+<fee month>"` (unchanged);
4. a bare admission number (unchanged).

## 2. Why
The challan barcode now carries the formatted challan number. Before this change a
scanned preview challan could not be resolved, because only the `+` form and a bare
admission number were understood.

## 3. Security
- No change to the function's privileges: it stays SECURITY DEFINER with EXECUTE
  revoked from PUBLIC, anon and authenticated (it is an internal helper called by
  `lookup_fee_challan` and `record_fee_payment`, which do their own `is_staff()` check).
- No table, column, policy or grant is touched.

## 4. Notes
- The old sequence-style numbers (CH-000001) do not match the new pattern and keep
  resolving through the exact-match branch, so nothing already printed breaks.
- Re-running this migration is safe: the function is CREATE OR REPLACE.
*/

CREATE OR REPLACE FUNCTION public.resolve_fee_challan(p_code text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_admission text;
  v_month text;
  v_id uuid;
  v_digits text;
  v_month_key text;
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

  -- "CH-<admission digits>-<YYYYMM>": the formatted number printed on a challan that
  -- may not be saved yet, so a printed preview stays scannable.
  IF v_code ~ '^CH-[0-9]+-[0-9]{6}$' THEN
    v_digits := split_part(v_code, '-', 2);
    v_month_key := split_part(v_code, '-', 3);
    v_month := substr(v_month_key, 1, 4) || '-' || substr(v_month_key, 5, 2);

    SELECT c.id INTO v_id
    FROM public.school_fee_challans c
    JOIN public.school_students s ON s.id = c.student_id
    WHERE regexp_replace(coalesce(s.admission_number, ''), '[^0-9]', '', 'g') = v_digits
      AND c.month = v_month
    ORDER BY c.created_at DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
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
