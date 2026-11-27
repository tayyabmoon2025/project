/*
# Examination module — exams setup, marks entry and results

## 1. Summary
Adds the three tables behind the new Examination module in the left sidebar.
An exam is created once, the subjects it examines are listed per class, and the
marks every student scored in each subject are recorded against them. Results,
grades and report cards are worked out from those marks, so there is only ever
one copy of a mark in the system.

## 2. New tables

### school_exam_types
One row per examination (for example "First Term" or "Annual Exam").
- `id` uuid primary key.
- `name` text, required, 2 to 80 characters.
- `period_start` / `period_end` date, optional — the dates the exam covers.
  Used to work out the attendance summary printed on the report card.
- `sort_order` integer, controls the order exams are listed in.
- `is_active` boolean, defaults to true. An inactive exam stays on record but is
  hidden from the marks and results pickers.
- `created_at` / `updated_at` timestamptz.

### school_exam_subjects
One row per subject examined in one class for one exam.
- `id` uuid primary key.
- `exam_type_id` uuid, required, references school_exam_types (cascade delete).
- `class_name` text, required.
- `subject_name` text, required.
- `max_marks` numeric, required, default 100 — the paper total.
- `pass_marks` numeric, required, default 40 — the pass mark for that subject.
- `created_at` / `updated_at` timestamptz.

### school_exam_marks
One row per student per subject. This is the single source of truth for results.
- `id` uuid primary key.
- `exam_type_id` uuid, required, references school_exam_types (cascade delete).
- `student_id` uuid, required, references school_students (cascade delete) — a
  withdrawn or deleted student never leaves an orphan mark behind.
- `subject_id` uuid, required, references school_exam_subjects (cascade delete).
- `class_name` text, required — the class the student sat the paper in.
- `obtained_marks` numeric, optional — null means the paper was not sat.
- `is_absent` boolean, default false.
- `entered_by` uuid, defaults to the signed-in user.
- `created_at` / `updated_at` timestamptz.

## 3. Uniqueness and indexes
- An exam name is unique (case-insensitive), so "First Term" cannot be created twice.
- A subject is unique per exam and class (case-insensitive).
- A mark is unique per student and subject, which is what makes the marks-entry
  save idempotent — saving the same grid twice updates rows instead of adding
  duplicates.
- Indexes on (exam_type_id, class_name) for the subject and mark lookups.

## 4. Security
- RLS is enabled on all three tables. No access is possible until a policy allows it.
- `anon` is revoked from every table; only signed-in users reach them at all.
- Reading exam setup and subjects is limited to active staff (`is_staff()`).
- Marks may be read by active staff, and by the student the mark belongs to
  (mirroring the existing DMC records policy).
- Writing marks is limited to administrators and teachers through the new
  `is_exam_staff()` helper, because entering marks is a teaching duty.
- Changing the exam setup (exams and subjects) is limited to administrators.
- Every grant is explicit, and only the four verbs the app uses are granted.

## 5. Server-side checks
- A check constraint keeps `max_marks` positive and `pass_marks` between 0 and
  `max_marks`.
- A trigger refuses a mark higher than the subject total, and refuses a row that
  is neither a mark nor an absence, so a crafted request cannot store a score the
  paper never had.
- A check constraint keeps the exam period in order when both dates are given.

## 6. Notes
- Three common exams are seeded only when the table is empty, so a fresh school
  has something to choose from immediately and an existing one is never touched.
- Results are never stored. They are recalculated from the marks every time they
  are shown, so a corrected mark is reflected everywhere at once.
*/

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Entering marks is a teaching duty, so teachers are included alongside
-- administrators. This mirrors the existing is_admin() / is_staff() helpers.
CREATE OR REPLACE FUNCTION public.is_exam_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.user_profiles
  WHERE id = auth.uid()
    AND role IN ('admin', 'teacher')
    AND status = 'active'
);
$function$;

REVOKE EXECUTE ON FUNCTION public.is_exam_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_exam_staff() TO authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_exam_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  period_start date,
  period_end date,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_types_name_check
    CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT school_exam_types_period_check
    CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_exam_types_name_key
  ON public.school_exam_types (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.school_exam_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_type_id uuid NOT NULL REFERENCES public.school_exam_types(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  subject_name text NOT NULL,
  max_marks numeric(6,2) NOT NULL DEFAULT 100,
  pass_marks numeric(6,2) NOT NULL DEFAULT 40,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_subjects_name_check
    CHECK (length(btrim(subject_name)) BETWEEN 1 AND 60),
  CONSTRAINT school_exam_subjects_class_check
    CHECK (length(btrim(class_name)) BETWEEN 1 AND 40),
  CONSTRAINT school_exam_subjects_marks_check
    CHECK (max_marks > 0 AND pass_marks >= 0 AND pass_marks <= max_marks)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_exam_subjects_key
  ON public.school_exam_subjects (exam_type_id, lower(btrim(class_name)), lower(btrim(subject_name)));

CREATE INDEX IF NOT EXISTS school_exam_subjects_class_idx
  ON public.school_exam_subjects (exam_type_id, class_name);

CREATE TABLE IF NOT EXISTS public.school_exam_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_type_id uuid NOT NULL REFERENCES public.school_exam_types(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.school_exam_subjects(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  obtained_marks numeric(6,2),
  is_absent boolean NOT NULL DEFAULT false,
  entered_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_marks_obtained_check
    CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= 1000))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_exam_marks_key
  ON public.school_exam_marks (student_id, subject_id);

CREATE INDEX IF NOT EXISTS school_exam_marks_exam_idx
  ON public.school_exam_marks (exam_type_id, class_name);

CREATE INDEX IF NOT EXISTS school_exam_marks_student_idx
  ON public.school_exam_marks (student_id);

-- ---------------------------------------------------------------------------
-- Server-side validation of a single mark
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_exam_marks_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max numeric;
BEGIN
  SELECT max_marks INTO v_max
  FROM public.school_exam_subjects
  WHERE id = NEW.subject_id;

  IF v_max IS NULL THEN
    RAISE EXCEPTION 'That subject does not exist for this exam';
  END IF;

  IF NEW.obtained_marks IS NOT NULL AND NEW.obtained_marks > v_max THEN
    RAISE EXCEPTION 'Marks cannot be more than the subject total of %', v_max;
  END IF;

  IF NEW.obtained_marks IS NULL AND NEW.is_absent IS NOT TRUE THEN
    RAISE EXCEPTION 'Enter the marks or mark the student absent';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.school_exam_marks_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_exam_marks_validate_trg ON public.school_exam_marks;
CREATE TRIGGER school_exam_marks_validate_trg
  BEFORE INSERT OR UPDATE ON public.school_exam_marks
  FOR EACH ROW EXECUTE FUNCTION public.school_exam_marks_validate();

-- ---------------------------------------------------------------------------
-- Seed three common exams on a brand new install only
-- ---------------------------------------------------------------------------

INSERT INTO public.school_exam_types (name, sort_order)
SELECT v.name, v.sort_order
FROM (VALUES ('First Term', 1), ('Mid Term', 2), ('Annual Exam', 3)) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.school_exam_types);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_exam_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_exam_marks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_exam_types FROM anon, authenticated;
REVOKE ALL ON public.school_exam_subjects FROM anon, authenticated;
REVOKE ALL ON public.school_exam_marks FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_marks TO authenticated;

-- Exams -------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read exams" ON public.school_exam_types;
CREATE POLICY "Staff can read exams"
ON public.school_exam_types FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Admins can add exams" ON public.school_exam_types;
CREATE POLICY "Admins can add exams"
ON public.school_exam_types FOR INSERT
TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can edit exams" ON public.school_exam_types;
CREATE POLICY "Admins can edit exams"
ON public.school_exam_types FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can remove exams" ON public.school_exam_types;
CREATE POLICY "Admins can remove exams"
ON public.school_exam_types FOR DELETE
TO authenticated
USING (is_admin());

-- Subjects ----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Staff can read exam subjects"
ON public.school_exam_subjects FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Admins can add exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Admins can add exam subjects"
ON public.school_exam_subjects FOR INSERT
TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can edit exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Admins can edit exam subjects"
ON public.school_exam_subjects FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can remove exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Admins can remove exam subjects"
ON public.school_exam_subjects FOR DELETE
TO authenticated
USING (is_admin());

-- Marks -------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and the student themselves can read exam marks" ON public.school_exam_marks;
CREATE POLICY "Staff and the student themselves can read exam marks"
ON public.school_exam_marks FOR SELECT
TO authenticated
USING (is_staff() OR student_id = own_student_id());

DROP POLICY IF EXISTS "Exam staff can add exam marks" ON public.school_exam_marks;
CREATE POLICY "Exam staff can add exam marks"
ON public.school_exam_marks FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit exam marks" ON public.school_exam_marks;
CREATE POLICY "Exam staff can edit exam marks"
ON public.school_exam_marks FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove exam marks" ON public.school_exam_marks;
CREATE POLICY "Exam staff can remove exam marks"
ON public.school_exam_marks FOR DELETE
TO authenticated
USING (is_exam_staff());
