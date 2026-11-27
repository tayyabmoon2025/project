/*
# Make fee challan lookup flexible across admission, challan and barcode codes

## What this changes, in plain English

The Fee Collection counter, the barcode scanner and the student fee slip all resolve a
typed or scanned code back to a fee challan. Until now the resolver only matched a bare
admission number exactly (so "SD-2401" worked but "2401" did not) and only matched the
"<admission>+<month>" barcode form exactly (so a slightly different casing or spacing
failed). Staff typing a challan number, an admission number or a barcode all need the same
record to land on the counter.

This migration rewrites `resolve_fee_challan` so every form a staff member or a barcode
can present resolves to the right challan, with the same "newest challan for the student"
fallback that was already there.

## Matching order (first hit wins)

1. **Exact challan number** — `upper(challan_number) = upper(<code>)`. Handles "CH-000007".
2. **CH-<digits>-<YYYYMM>** — the formatted number printed on a challan or preview. The
   digits are matched against the admission number with non-digits stripped, so
   "CH-2401-202611" finds SD-2401's challan for 2026-11.
3. **<admission>+<month>** — the barcode code printed on unsaved previews. Admission is
   matched with non-digits stripped so "SD-2401+2026-11" and "2401+202611" both work.
4. **Bare admission number, exact** — `upper(admission_number) = upper(<code>)`. Handles
   "SD-2401". Falls back to the student's newest challan.
5. **Bare admission digits** — `regexp_replace(admission_number, '[^0-9]', '', 'g') = <digits>`.
   Handles "2401" when no prefix was typed.

When a bare admission number or digits resolve a student with more than one challan, the
newest challan is returned so the counter sees the month currently being collected.

## Security

The function stays `SECURITY DEFINER`, `STABLE`, `SET search_path = 'public'`, and is the
only code path the browser uses to resolve a scanned code. EXECUTE stays revoked from
`PUBLIC`/`anon` and granted only to `authenticated`. No table grants change.
*/

CREATE OR REPLACE FUNCTION public.resolve_fee_challan(p_code text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_digits text;
  v_month text;
  v_month_key text;
  v_admission text;
  v_id uuid;
BEGIN
  IF v_code = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Exact challan number ("CH-000007").
  SELECT id INTO v_id
  FROM public.school_fee_challans
  WHERE upper(challan_number) = v_code
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- 2. "CH-<admission digits>-<YYYYMM>": the formatted number printed on a challan that
  --    may not be saved yet, so a printed preview stays scannable.
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

  -- 3. "<admission number>+<fee month>": the barcode code printed on an unsaved preview.
  --    The admission part is matched by digits so "SD-2401+2026-11" and "2401+202611"
  --    both resolve.
  IF position('+' in v_code) > 0 THEN
    v_admission := split_part(v_code, '+', 1);
    v_month := split_part(v_code, '+', 2);

    -- Normalise the month to YYYY-MM whether it came in as 2026-11 or 202611.
    IF v_month ~ '^[0-9]{6}$' THEN
      v_month := substr(v_month, 1, 4) || '-' || substr(v_month, 5, 2);
    END IF;

    v_digits := regexp_replace(v_admission, '[^0-9]', '', 'g');

    SELECT c.id INTO v_id
    FROM public.school_fee_challans c
    JOIN public.school_students s ON s.id = c.student_id
    WHERE regexp_replace(coalesce(s.admission_number, ''), '[^0-9]', '', 'g') = v_digits
      AND c.month = v_month
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  -- 4. A bare admission number, matched exactly first ("SD-2401").
  SELECT c.id INTO v_id
  FROM public.school_fee_challans c
  JOIN public.school_students s ON s.id = c.student_id
  WHERE upper(s.admission_number) = v_code
  ORDER BY c.created_at DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- 5. A bare admission number typed as digits only ("2401"). The non-digits are stripped
  --    from the stored admission number so SD-2401 still matches.
  v_digits := regexp_replace(v_code, '[^0-9]', '', 'g');
  IF v_digits <> '' THEN
    SELECT c.id INTO v_id
    FROM public.school_fee_challans c
    JOIN public.school_students s ON s.id = c.student_id
    WHERE regexp_replace(coalesce(s.admission_number, ''), '[^0-9]', '', 'g') = v_digits
    ORDER BY c.created_at DESC
    LIMIT 1;
  END IF;

  RETURN v_id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.resolve_fee_challan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fee_challan(text) TO authenticated;
