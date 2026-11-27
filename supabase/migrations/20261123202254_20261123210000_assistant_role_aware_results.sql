/*
# Assistant results reader with a fee gate

## 1. Summary
Adds one read-only function used by the School Assistant to show a student's exam
results to that student or their parent. The function decides on the server who is
allowed to see the marks, and refuses to hand over results while the student still
owes fees — so the fee rule is enforced by the database, not only by the screen.

## 2. New function

### public.assistant_student_results(p_student_id uuid) returns jsonb
- Confirms the caller is active staff, the student themselves, or a parent linked to
  that student. Anyone else receives `{"error":"not_allowed"}` and no data.
- When the student has an outstanding fee balance and the caller is not staff, returns
  `{"blocked": true, ...}` carrying the student name, class and amount due. **No marks
  are returned in that case**, so a pending-fee student cannot read results.
- Otherwise returns the student's marks together with the subject, the exam name, the
  paper total and the pass mark, so the assistant can build a result view.
- Returns `{"error":"not_found"}` for an unknown student.

## 3. Security
- `SECURITY DEFINER` with a fixed `search_path`, so the function reads the exam tables
  it needs while still refusing to answer for a student the caller is not entitled to.
- EXECUTE is revoked from PUBLIC and anon, and granted only to authenticated.
- No table, column or existing policy is changed; the current RLS remains the outer
  gate and this function adds an ownership check plus the fee rule on top.

## 4. Notes
1. Staff (admin, teacher, office assistant, accountant) are never fee-blocked.
2. Parents and students are fee-blocked, which is the rule the assistant displays.
3. The function never returns a date of birth.
4. The function is idempotent to re-run: it only creates or replaces the function.
*/

CREATE OR REPLACE FUNCTION public.assistant_student_results(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_student public.school_students%ROWTYPE;
  v_allowed boolean;
  v_staff boolean;
  v_balance numeric;
  v_results jsonb;
BEGIN
  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  v_staff := public.is_staff();
  v_allowed := v_staff
    OR public.own_student_id() = p_student_id
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid()
        AND psl.student_id = p_student_id
    );

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('error', 'not_allowed');
  END IF;

  v_balance := GREATEST(0, COALESCE(v_student.fee_balance, 0));

  IF v_balance > 0 AND NOT v_staff THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'student_name', v_student.full_name,
      'class_name', v_student.class_name,
      'section_name', v_student.section_name,
      'due_amount', v_balance
    );
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.exam_name, r.subject_name), '[]'::jsonb)
    INTO v_results
  FROM (
    SELECT et.name AS exam_name,
           es.subject_name,
           m.obtained_marks,
           m.is_absent,
           es.max_marks,
           es.pass_marks
    FROM public.school_exam_marks m
    JOIN public.school_exam_subjects es ON es.id = m.subject_id
    JOIN public.school_exam_types et ON et.id = m.exam_type_id
    WHERE m.student_id = p_student_id
  ) r;

  RETURN jsonb_build_object(
    'blocked', false,
    'student_name', v_student.full_name,
    'class_name', v_student.class_name,
    'section_name', v_student.section_name,
    'due_amount', v_balance,
    'results', v_results
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.assistant_student_results(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_student_results(uuid) TO authenticated;
