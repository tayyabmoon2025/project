/*
# Automatic class-wise roll numbers

## Purpose
Gives every active student a clean sequential roll number within their class
(`01`, `02`, `03`, …), while never touching a roll number the office typed in by
hand. The office can still override any student's roll number on the student
profile; this function only fills the gaps.

## 1. New Function
- `public.ensure_class_roll_numbers(p_class_name text) returns integer`
  - Numbers the active students of one class who have no roll number yet.
  - Students are taken alphabetically by full name (admission number breaks ties),
    so the numbering is stable and repeatable.
  - A number already used by a manually entered roll number in the same class is
    skipped, so a hand-typed roll number can never be duplicated.
  - Returns how many students were given a roll number.

## 2. Security
- `SECURITY DEFINER` so the numbering can be written in one pass regardless of
  row-level policies.
- `search_path` pinned to `public`.
- Callers must be signed-in school staff (`is_staff()` or `is_exam_staff()`);
  anyone else is refused with a permission error.
- EXECUTE is revoked from `PUBLIC` and `anon`, and granted only to `authenticated`.
- No table, column or policy is changed, so no existing data is affected.
*/

CREATE OR REPLACE FUNCTION public.ensure_class_roll_numbers(p_class_name text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned integer := 0;
  v_used integer[];
  v_next integer := 1;
  v_candidate text;
  v_row record;
BEGIN
  IF NOT (public.is_staff() OR public.is_exam_staff()) THEN
    RAISE EXCEPTION 'Only school staff can assign roll numbers.' USING ERRCODE = '42501';
  END IF;

  IF p_class_name IS NULL OR btrim(p_class_name) = '' THEN
    RETURN 0;
  END IF;

  SELECT coalesce(array_agg(DISTINCT btrim(roll_number)::integer), ARRAY[]::integer[])
    INTO v_used
    FROM public.school_students
   WHERE class_name = p_class_name
     AND roll_number ~ '^[0-9]+$';

  FOR v_row IN
    SELECT id
      FROM public.school_students
     WHERE class_name = p_class_name
       AND status = 'active'
       AND (roll_number IS NULL OR btrim(roll_number) = '')
     ORDER BY full_name, admission_number
  LOOP
    LOOP
      IF NOT (v_next = ANY (v_used)) THEN
        EXIT;
      END IF;
      v_next := v_next + 1;
    END LOOP;

    v_candidate := lpad(v_next::text, 2, '0');
    UPDATE public.school_students SET roll_number = v_candidate WHERE id = v_row.id;
    v_used := array_append(v_used, v_next);
    v_next := v_next + 1;
    v_assigned := v_assigned + 1;
  END LOOP;

  RETURN v_assigned;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_class_roll_numbers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_class_roll_numbers(text) TO authenticated;
