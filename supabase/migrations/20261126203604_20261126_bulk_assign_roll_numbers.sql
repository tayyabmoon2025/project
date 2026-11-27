/*
# Bulk assign / re-sequence class roll numbers

1. Purpose
- Lets the office number a whole class in one go from the Students List or the
  Marks Entry toolbar, instead of editing each student profile by hand.
- The screen shows a preview first (current roll no. vs new roll no.) and only
  writes when the office confirms, so nothing is changed by accident.

2. New function
- `public.bulk_assign_roll_numbers(p_class_name text, p_section_name text,
  p_student_ids uuid[], p_start integer) returns integer`
  - Writes a clean, contiguous sequence starting at `p_start` to the students
    named in `p_student_ids`, in the order the ids are given (the caller passes
    the already-sorted roster, so what the preview showed is what gets saved).
  - Numbers are zero padded: starting at 1 gives `01`, `02`, `03`; starting at
    101 gives `101`, `102`, `103`.
  - A student is only touched when they are still active and still belong to the
    chosen class (and the chosen section, when one is given). Anything that no
    longer matches is skipped without consuming a number, so the sequence stays
    gap free.
  - Returns how many students were numbered.

3. Security
- `SECURITY DEFINER` with a pinned `search_path` so the write does not depend on
  the caller holding a direct table grant, and the role check cannot be skipped
  by a crafted search path.
- Caller must be school staff or examination staff (`is_staff()` /
  `is_exam_staff()`); anyone else is refused with `42501`.
- `EXECUTE` is revoked from `PUBLIC` and `anon`, and granted to `authenticated`
  only. This function is not a public RPC.

4. Notes
- Re-sequencing overwrites existing roll numbers on purpose: that is what
  "re-sequence" means. The confirmation step in the UI is what protects the
  office from an unintended change.
- `roll_number` has no unique constraint, so two students can never be blocked
  from being numbered because of a clashing value.
- Safe to re-run: the function is created or replaced, never dropped.
*/

CREATE OR REPLACE FUNCTION public.bulk_assign_roll_numbers(
  p_class_name text,
  p_section_name text,
  p_student_ids uuid[],
  p_start integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assigned integer := 0;
  v_width integer;
  v_offset integer := 0;
  v_id uuid;
BEGIN
  IF NOT (public.is_staff() OR public.is_exam_staff()) THEN
    RAISE EXCEPTION 'Only school staff can assign roll numbers.' USING ERRCODE = '42501';
  END IF;

  IF p_class_name IS NULL OR btrim(p_class_name) = '' THEN
    RAISE EXCEPTION 'Choose a class before numbering.' USING ERRCODE = '22023';
  END IF;

  IF p_start IS NULL OR p_start < 1 OR p_start > 9999 THEN
    RAISE EXCEPTION 'The starting number must be between 1 and 9999.' USING ERRCODE = '22023';
  END IF;

  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_width := greatest(2, length(p_start::text));

  FOREACH v_id IN ARRAY p_student_ids
  LOOP
    UPDATE public.school_students
    SET roll_number = lpad((p_start + v_offset)::text, v_width, '0')
    WHERE id = v_id
      AND class_name = p_class_name
      AND status = 'active'
      AND (p_section_name IS NULL OR btrim(p_section_name) = '' OR section_name = p_section_name);

    IF FOUND THEN
      v_offset := v_offset + 1;
      v_assigned := v_assigned + 1;
    END IF;
  END LOOP;

  RETURN v_assigned;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bulk_assign_roll_numbers(text, text, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_assign_roll_numbers(text, text, uuid[], integer) TO authenticated;
