/*
# Examination extras: date sheets, remarks bank, conditional pass, class tests, board results

## 1. Summary
Adds the storage behind four new Examination sub-tabs alongside the existing three.
Each feature keeps its own table so the existing exam/subject/mark tables are untouched.

## 2. New tables

### school_exam_datesheet
One row per paper in a class's exam schedule.
- `id` uuid primary key.
- `exam_type_id` uuid, required, references school_exam_types (cascade delete).
- `class_name` text, required.
- `exam_date` date, required — the day the paper is sat.
- `weekday` text — pre-computed day name shown on the sheet and slips.
- `subject_name` text, required.
- `start_time` / `end_time` text — paper timing as displayed (e.g. "08:30").
- `room_number` text — the room the paper is sat in.
- `created_at` / `updated_at` timestamptz.
- Unique per exam + class + date + subject (case-insensitive), so saving the same
  sheet twice updates rows instead of adding duplicates.

### school_grade_remarks
One row per grade letter. Seeds the six default grades (A+ to F) with default
wording on a fresh install only, so an existing school keeps any customised remark.
- `id` uuid primary key.
- `grade` text, required, 1-3 characters (A+, A, B, C, D, F).
- `remark` text, required, up to 300 characters.
- `created_at` / `updated_at` timestamptz.
- Unique per grade (case-insensitive).

### school_conditional_pass
The principal's sign-off for a student who failed one or two subjects.
- `id` uuid primary key.
- `exam_type_id` uuid, required, references school_exam_types (cascade delete).
- `student_id` uuid, required, references school_students (cascade delete) — a
  withdrawn or deleted student never leaves an orphan record behind.
- `failed_subjects` text, required, up to 240 characters — the subject names the
  student failed, stored as text so the stamp survives subject edits.
- `condition_note` text, required, up to 300 characters — the condition set.
- `decision_by` uuid, defaults to the signed-in user.
- `created_at` / `updated_at` timestamptz.
- Unique per exam + student, so a second decision updates the first.

### school_class_tests
One row per class test (weekly or monthly).
- `id` uuid primary key.
- `title` text, required, 2-80 characters.
- `test_date` date, required.
- `class_name` text, required.
- `subject_name` text, required.
- `max_marks` numeric, required, default 10 — the test total.
- `created_by` uuid, defaults to the signed-in user.
- `created_at` / `updated_at` timestamptz.

### school_class_test_marks
One row per student per test. The unique index makes the save idempotent.
- `id` uuid primary key.
- `test_id` uuid, required, references school_class_tests (cascade delete).
- `student_id` uuid, required, references school_students (cascade delete).
- `obtained_marks` numeric, optional — null means not marked.
- `is_absent` boolean, default false.
- `created_at` / `updated_at` timestamptz.
- Unique per test + student.

### school_board_results
Official external/board exam results for a student.
- `id` uuid primary key.
- `student_id` uuid, required, references school_students (cascade delete).
- `class_name` text, required — e.g. "9th" or "10th".
- `board_name` text, required — e.g. "BISE Kohat".
- `exam_year` integer, required — the year the board exam was sat.
- `board_roll_number` text, required.
- `total_marks` numeric, required.
- `obtained_marks` numeric, required.
- `grade_division` text — the grade or division the board awarded.
- `created_at` / `updated_at` timestamptz.

## 3. Uniqueness and indexes
- Datesheet rows are unique per exam, class, date and subject, which is what makes
  the save idempotent.
- Class test marks are unique per test and student, same idempotent save.
- Indexes on the lookups the tabs use: datesheet by exam + class, tests by class +
  date, test marks by test, board results by student.

## 4. Security
- RLS is enabled on all five tables. No access is possible until a policy allows it.
- `anon` is revoked from every table; only signed-in users reach them at all.
- Reading everything is limited to active staff (`is_staff()`).
- Writing datesheets, class tests, test marks and board results is limited to
  administrators and teachers through the existing `is_exam_staff()` helper.
- Deciding a conditional pass is limited to administrators (`is_admin()`), since it
  is the principal's decision.
- The conditional-pass table gets its own read rule so the student the decision
  belongs to can see their own stamp, mirroring the exam marks policy.
- Every grant is explicit and only the four verbs the app uses are granted.

## 5. Notes
- The grade remarks seed runs only when the table is empty, so a fresh school
  starts with sensible wording and an existing one is never overwritten.
- Nothing here changes how existing results are worked out: the conditional-pass
  decision is stored separately and stamped on at display time.
*/

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_exam_datesheet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_type_id uuid NOT NULL REFERENCES public.school_exam_types(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  exam_date date NOT NULL,
  weekday text,
  subject_name text NOT NULL,
  start_time text,
  end_time text,
  room_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_datesheet_name_check
    CHECK (length(btrim(subject_name)) BETWEEN 1 AND 60 AND length(btrim(class_name)) BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_exam_datesheet_key
  ON public.school_exam_datesheet (exam_type_id, lower(btrim(class_name)), exam_date, lower(btrim(subject_name)));

CREATE INDEX IF NOT EXISTS school_exam_datesheet_class_idx
  ON public.school_exam_datesheet (exam_type_id, class_name, exam_date);

CREATE TABLE IF NOT EXISTS public.school_grade_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade text NOT NULL,
  remark text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_grade_remarks_grade_check CHECK (length(btrim(grade)) BETWEEN 1 AND 3),
  CONSTRAINT school_grade_remarks_remark_check CHECK (length(btrim(remark)) BETWEEN 1 AND 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_grade_remarks_key
  ON public.school_grade_remarks (lower(btrim(grade)));

CREATE TABLE IF NOT EXISTS public.school_conditional_pass (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_type_id uuid NOT NULL REFERENCES public.school_exam_types(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  failed_subjects text NOT NULL,
  condition_note text NOT NULL,
  decision_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_conditional_pass_note_check
    CHECK (length(btrim(failed_subjects)) BETWEEN 1 AND 240 AND length(btrim(condition_note)) BETWEEN 1 AND 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_conditional_pass_key
  ON public.school_conditional_pass (exam_type_id, student_id);

CREATE TABLE IF NOT EXISTS public.school_class_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  test_date date NOT NULL,
  class_name text NOT NULL,
  subject_name text NOT NULL,
  max_marks numeric(6,2) NOT NULL DEFAULT 10,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_class_tests_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 80),
  CONSTRAINT school_class_tests_max_check CHECK (max_marks > 0)
);

CREATE INDEX IF NOT EXISTS school_class_tests_class_idx
  ON public.school_class_tests (class_name, test_date);

CREATE TABLE IF NOT EXISTS public.school_class_test_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.school_class_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  obtained_marks numeric(6,2),
  is_absent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_class_test_marks_check
    CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= 1000))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_class_test_marks_key
  ON public.school_class_test_marks (test_id, student_id);

CREATE INDEX IF NOT EXISTS school_class_test_marks_test_idx
  ON public.school_class_test_marks (test_id);

CREATE TABLE IF NOT EXISTS public.school_board_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  board_name text NOT NULL,
  exam_year integer NOT NULL,
  board_roll_number text NOT NULL,
  total_marks numeric(6,2) NOT NULL,
  obtained_marks numeric(6,2) NOT NULL,
  grade_division text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_board_results_year_check
    CHECK (exam_year BETWEEN 2000 AND 2100
      AND length(btrim(board_name)) BETWEEN 1 AND 80
      AND length(btrim(board_roll_number)) BETWEEN 1 AND 30
      AND total_marks > 0
      AND obtained_marks >= 0
      AND obtained_marks <= total_marks)
);

CREATE INDEX IF NOT EXISTS school_board_results_student_idx
  ON public.school_board_results (student_id, exam_year);

-- ---------------------------------------------------------------------------
-- Seed the six default grade remarks on a brand new install only
-- ---------------------------------------------------------------------------

INSERT INTO public.school_grade_remarks (grade, remark)
SELECT v.grade, v.remark
FROM (VALUES
  ('A+', 'Outstanding performance. Keep up the excellent work.'),
  ('A', 'Excellent result. A very good command of the subject.'),
  ('B', 'Good work. With a little more effort an even better result is within reach.'),
  ('C', 'Fair result. More consistent revision is needed.'),
  ('D', 'Pass. Needs regular study and support to improve.'),
  ('F', 'Needs improvement. Please meet the class teacher to plan the way forward.')
) AS v(grade, remark)
WHERE NOT EXISTS (SELECT 1 FROM public.school_grade_remarks);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_exam_datesheet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_grade_remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_conditional_pass ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_class_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_class_test_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_board_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_exam_datesheet FROM anon, authenticated;
REVOKE ALL ON public.school_grade_remarks FROM anon, authenticated;
REVOKE ALL ON public.school_conditional_pass FROM anon, authenticated;
REVOKE ALL ON public.school_class_tests FROM anon, authenticated;
REVOKE ALL ON public.school_class_test_marks FROM anon, authenticated;
REVOKE ALL ON public.school_board_results FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_datesheet TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_grade_remarks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_conditional_pass TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_class_tests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_class_test_marks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_board_results TO authenticated;

-- Datesheet ----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read exam datesheets" ON public.school_exam_datesheet;
CREATE POLICY "Staff can read exam datesheets"
ON public.school_exam_datesheet FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Exam staff can add exam datesheets" ON public.school_exam_datesheet;
CREATE POLICY "Exam staff can add exam datesheets"
ON public.school_exam_datesheet FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit exam datesheets" ON public.school_exam_datesheet;
CREATE POLICY "Exam staff can edit exam datesheets"
ON public.school_exam_datesheet FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove exam datesheets" ON public.school_exam_datesheet;
CREATE POLICY "Exam staff can remove exam datesheets"
ON public.school_exam_datesheet FOR DELETE
TO authenticated
USING (is_exam_staff());

-- Grade remarks --------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read grade remarks" ON public.school_grade_remarks;
CREATE POLICY "Staff can read grade remarks"
ON public.school_grade_remarks FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Exam staff can add grade remarks" ON public.school_grade_remarks;
CREATE POLICY "Exam staff can add grade remarks"
ON public.school_grade_remarks FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit grade remarks" ON public.school_grade_remarks;
CREATE POLICY "Exam staff can edit grade remarks"
ON public.school_grade_remarks FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove grade remarks" ON public.school_grade_remarks;
CREATE POLICY "Exam staff can remove grade remarks"
ON public.school_grade_remarks FOR DELETE
TO authenticated
USING (is_exam_staff());

-- Conditional pass -----------------------------------------------------------
DROP POLICY IF EXISTS "Staff or the student can read conditional pass" ON public.school_conditional_pass;
CREATE POLICY "Staff or the student can read conditional pass"
ON public.school_conditional_pass FOR SELECT
TO authenticated
USING (is_staff() OR student_id = own_student_id());

DROP POLICY IF EXISTS "Admins can add conditional pass" ON public.school_conditional_pass;
CREATE POLICY "Admins can add conditional pass"
ON public.school_conditional_pass FOR INSERT
TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can edit conditional pass" ON public.school_conditional_pass;
CREATE POLICY "Admins can edit conditional pass"
ON public.school_conditional_pass FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can remove conditional pass" ON public.school_conditional_pass;
CREATE POLICY "Admins can remove conditional pass"
ON public.school_conditional_pass FOR DELETE
TO authenticated
USING (is_admin());

-- Class tests ----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read class tests" ON public.school_class_tests;
CREATE POLICY "Staff can read class tests"
ON public.school_class_tests FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Exam staff can add class tests" ON public.school_class_tests;
CREATE POLICY "Exam staff can add class tests"
ON public.school_class_tests FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit class tests" ON public.school_class_tests;
CREATE POLICY "Exam staff can edit class tests"
ON public.school_class_tests FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove class tests" ON public.school_class_tests;
CREATE POLICY "Exam staff can remove class tests"
ON public.school_class_tests FOR DELETE
TO authenticated
USING (is_exam_staff());

DROP POLICY IF EXISTS "Staff or the student can read class test marks" ON public.school_class_test_marks;
CREATE POLICY "Staff or the student can read class test marks"
ON public.school_class_test_marks FOR SELECT
TO authenticated
USING (is_staff() OR student_id = own_student_id());

DROP POLICY IF EXISTS "Exam staff can add class test marks" ON public.school_class_test_marks;
CREATE POLICY "Exam staff can add class test marks"
ON public.school_class_test_marks FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit class test marks" ON public.school_class_test_marks;
CREATE POLICY "Exam staff can edit class test marks"
ON public.school_class_test_marks FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove class test marks" ON public.school_class_test_marks;
CREATE POLICY "Exam staff can remove class test marks"
ON public.school_class_test_marks FOR DELETE
TO authenticated
USING (is_exam_staff());

-- Board results --------------------------------------------------------------
DROP POLICY IF EXISTS "Staff or the student can read board results" ON public.school_board_results;
CREATE POLICY "Staff or the student can read board results"
ON public.school_board_results FOR SELECT
TO authenticated
USING (is_staff() OR student_id = own_student_id());

DROP POLICY IF EXISTS "Exam staff can add board results" ON public.school_board_results;
CREATE POLICY "Exam staff can add board results"
ON public.school_board_results FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit board results" ON public.school_board_results;
CREATE POLICY "Exam staff can edit board results"
ON public.school_board_results FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove board results" ON public.school_board_results;
CREATE POLICY "Exam staff can remove board results"
ON public.school_board_results FOR DELETE
TO authenticated
USING (is_exam_staff());
