/*
# Promote Students: final results, promotion history and the promotion action

## 1. Purpose
The Promote Students screen previously only listed students. This migration gives it the
data it needs to promote a whole year group safely: each student's final term result, a
permanent record of every promotion decision, and one server-side action that promotes
students and writes that record together so the two can never drift apart.

## 2. New Tables

### `school_final_results`
The end-of-term outcome for one student in one session.
- `id` (uuid, primary key)
- `student_id` (uuid, references `school_students`, deleted with the student)
- `session` (text, the academic session the result belongs to, e.g. `2026-2027`)
- `status` (text, `passed` / `failed` / `pending`, defaults to `pending`)
- `remarks` (text, optional note)
- `recorded_by` (uuid, defaults to the signed-in account)
- `created_at`, `updated_at` (timestamps)
- One row per student per session (unique index), so a result is corrected, never duplicated.

### `school_promotion_records`
The permanent promotion history: one row per student per promotion action.
- `id` (uuid, primary key)
- `student_id` (uuid, references `school_students`, deleted with the student)
- `student_name` (text, kept so history stays readable even after a name change)
- `from_class`, `from_section` (text, where the student was)
- `to_class`, `to_section` (text, where they moved to; empty for a pass out)
- `outcome` (text, `promoted` / `conditional` / `passed_out`)
- `condition_note` (text, the condition attached to a conditional promotion)
- `session` (text), `promoted_by` (uuid), `promoted_at` (timestamp)

## 3. New Function
- `promote_students(p_promotions jsonb, p_session text)` — promotes the supplied students
  in one transaction: it writes the history row first, then moves the student to the chosen
  class and section, or marks a Class 10 student as passed out. It validates every rule
  itself (unknown option, missing class or section, missing condition, unknown or already
  departed student, and a size limit), so a crafted request cannot skip a check the screen
  makes. It returns the number of students changed.

## 4. Security
- RLS is enabled on both new tables.
- Reading is allowed to staff (`is_staff()`); writing is allowed to administrators only
  (`is_admin()`). Four separate policies per table, one per action.
- Both tables are granted to `authenticated` only, since every screen that uses them
  requires sign-in. No `anon` access.
- `promote_students` is SECURITY DEFINER with a fixed `search_path`, checks `is_admin()`
  for the caller, and its EXECUTE is revoked from PUBLIC and `anon`.

## 5. Notes
- Passed-out students keep their class and section for the historical record; only their
  status changes, so they drop out of the active class lists.
- No existing table, column or policy is modified.
*/

-- 1. Final term result per student per session ---------------------------------
CREATE TABLE IF NOT EXISTS public.school_final_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  session text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  remarks text,
  recorded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_final_results_status_check CHECK (status IN ('passed', 'failed', 'pending'))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_final_results_student_session_key
ON public.school_final_results (student_id, session);

ALTER TABLE public.school_final_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_final_results TO authenticated;

DROP POLICY IF EXISTS "Staff can read final results" ON public.school_final_results;
CREATE POLICY "Staff can read final results"
ON public.school_final_results FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can record final results" ON public.school_final_results;
CREATE POLICY "Admins can record final results"
ON public.school_final_results FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update final results" ON public.school_final_results;
CREATE POLICY "Admins can update final results"
ON public.school_final_results FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete final results" ON public.school_final_results;
CREATE POLICY "Admins can delete final results"
ON public.school_final_results FOR DELETE
TO authenticated
USING (public.is_admin());

-- 2. Promotion history ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_promotion_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  from_class text,
  from_section text,
  to_class text,
  to_section text,
  outcome text NOT NULL,
  condition_note text,
  session text NOT NULL,
  promoted_by uuid DEFAULT auth.uid(),
  promoted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_promotion_records_outcome_check CHECK (outcome IN ('promoted', 'conditional', 'passed_out'))
);

CREATE INDEX IF NOT EXISTS school_promotion_records_student_idx
ON public.school_promotion_records (student_id, promoted_at DESC);

CREATE INDEX IF NOT EXISTS school_promotion_records_date_idx
ON public.school_promotion_records (promoted_at DESC);

ALTER TABLE public.school_promotion_records ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_promotion_records TO authenticated;

DROP POLICY IF EXISTS "Staff can read promotion history" ON public.school_promotion_records;
CREATE POLICY "Staff can read promotion history"
ON public.school_promotion_records FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can record promotion history" ON public.school_promotion_records;
CREATE POLICY "Admins can record promotion history"
ON public.school_promotion_records FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update promotion history" ON public.school_promotion_records;
CREATE POLICY "Admins can update promotion history"
ON public.school_promotion_records FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete promotion history" ON public.school_promotion_records;
CREATE POLICY "Admins can delete promotion history"
ON public.school_promotion_records FOR DELETE
TO authenticated
USING (public.is_admin());

-- 3. The promotion action ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_students(p_promotions jsonb, p_session text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  item jsonb;
  v_student public.school_students%ROWTYPE;
  v_outcome text;
  v_to_class text;
  v_to_section text;
  v_note text;
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_promotions IS NULL OR jsonb_typeof(p_promotions) <> 'array' THEN
    RAISE EXCEPTION 'No students were supplied';
  END IF;
  IF jsonb_array_length(p_promotions) = 0 THEN
    RAISE EXCEPTION 'No students were supplied';
  END IF;
  IF jsonb_array_length(p_promotions) > 500 THEN
    RAISE EXCEPTION 'Too many students in one go';
  END IF;
  IF p_session IS NULL OR btrim(p_session) = '' THEN
    RAISE EXCEPTION 'A session is required';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
    v_outcome := nullif(btrim(coalesce(item->>'outcome', '')), '');
    v_to_class := nullif(btrim(coalesce(item->>'to_class', '')), '');
    v_to_section := nullif(btrim(coalesce(item->>'to_section', '')), '');
    v_note := nullif(btrim(coalesce(item->>'condition_note', '')), '');

    IF v_outcome IS NULL OR v_outcome NOT IN ('promoted', 'conditional', 'passed_out') THEN
      RAISE EXCEPTION 'Unknown promotion option';
    END IF;
    IF v_outcome = 'conditional' AND v_note IS NULL THEN
      RAISE EXCEPTION 'A condition is required for a conditional promotion';
    END IF;
    IF v_outcome <> 'passed_out' AND (v_to_class IS NULL OR v_to_section IS NULL) THEN
      RAISE EXCEPTION 'Choose the next class and section';
    END IF;
    IF v_outcome = 'passed_out' THEN
      v_to_class := NULL;
      v_to_section := NULL;
    END IF;

    SELECT * INTO v_student
    FROM public.school_students
    WHERE id = nullif(btrim(coalesce(item->>'student_id', '')), '')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected student no longer exists';
    END IF;
    IF v_student.status = 'withdrawn' THEN
      RAISE EXCEPTION 'A selected student has left the school';
    END IF;
    IF v_student.status = 'promoted' THEN
      RAISE EXCEPTION 'A selected student has already passed out';
    END IF;

    INSERT INTO public.school_promotion_records (
      student_id, student_name, from_class, from_section, to_class, to_section,
      outcome, condition_note, session, promoted_by
    ) VALUES (
      v_student.id, v_student.full_name, v_student.class_name, v_student.section_name,
      v_to_class, v_to_section, v_outcome, v_note, btrim(p_session), auth.uid()
    );

    IF v_outcome = 'passed_out' THEN
      UPDATE public.school_students SET status = 'promoted' WHERE id = v_student.id;
    ELSE
      UPDATE public.school_students
      SET class_name = v_to_class, section_name = v_to_section
      WHERE id = v_student.id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('promoted', v_count, 'session', btrim(p_session));
END $$;

REVOKE EXECUTE ON FUNCTION public.promote_students(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_students(jsonb, text) TO authenticated;
