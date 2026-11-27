/*
# Examination core tables (recreate if missing) + subject settings & exam passing policy

## 1. Summary
Ensures the three core Examination tables exist, then adds the new subject
settings (Compulsory, Grade-Only, Optional, Sort Order) and the exam Passing
Policy (minimum aggregate percentage + rule). Safe to re-run: tables are created
only if missing and columns are added only if absent.

## 2. Tables (created if missing)
### school_exam_types — one row per examination.
Includes new columns:
- min_pass_percentage numeric(5,2) not null default 40
- passing_rule text not null default 'both' (aggregate | compulsory | both)

### school_exam_subjects — one row per subject per class per exam.
Includes new columns:
- is_compulsory boolean not null default true
- is_grade_only boolean not null default false
- is_optional boolean not null default false
- sort_order integer not null default 0

### school_exam_marks — one row per student per subject.

## 3. Security
RLS enabled; anon revoked; staff read; exam staff write marks; admins write setup.
Every grant explicit. is_exam_staff() helper (re)created.

## 4. Notes
Results are calculated from marks, never stored.
*/

CREATE OR REPLACE FUNCTION public.is_exam_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.user_profiles
  WHERE id = auth.uid() AND role IN ('admin', 'teacher') AND status = 'active'
);
$function$;

REVOKE EXECUTE ON FUNCTION public.is_exam_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_exam_staff() TO authenticated;

CREATE TABLE IF NOT EXISTS public.school_exam_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  period_start date,
  period_end date,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  min_pass_percentage numeric(5,2) NOT NULL DEFAULT 40,
  passing_rule text NOT NULL DEFAULT 'both',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_types_name_check CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT school_exam_types_period_check CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start)
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
  paper_split boolean NOT NULL DEFAULT false,
  paper_a_max numeric(6,2) NOT NULL DEFAULT 50,
  paper_b_max numeric(6,2) NOT NULL DEFAULT 50,
  is_compulsory boolean NOT NULL DEFAULT true,
  is_grade_only boolean NOT NULL DEFAULT false,
  is_optional boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_subjects_name_check CHECK (length(btrim(subject_name)) BETWEEN 1 AND 60),
  CONSTRAINT school_exam_subjects_class_check CHECK (length(btrim(class_name)) BETWEEN 1 AND 40),
  CONSTRAINT school_exam_subjects_marks_check CHECK (max_marks > 0 AND pass_marks >= 0 AND pass_marks <= max_marks)
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
  paper_a_marks numeric(6,2),
  paper_b_marks numeric(6,2),
  entered_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_exam_marks_obtained_check CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= 1000))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_exam_marks_key
  ON public.school_exam_marks (student_id, subject_id);

CREATE INDEX IF NOT EXISTS school_exam_marks_exam_idx
  ON public.school_exam_marks (exam_type_id, class_name);

CREATE INDEX IF NOT EXISTS school_exam_marks_student_idx
  ON public.school_exam_marks (student_id);

-- Add the new columns on an install where the tables already existed ---------
ALTER TABLE public.school_exam_types
  ADD COLUMN IF NOT EXISTS min_pass_percentage numeric(5,2) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS passing_rule text NOT NULL DEFAULT 'both';

ALTER TABLE public.school_exam_subjects
  ADD COLUMN IF NOT EXISTS is_compulsory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_grade_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_exam_types_min_pass_check') THEN
    ALTER TABLE public.school_exam_types
      ADD CONSTRAINT school_exam_types_min_pass_check CHECK (min_pass_percentage >= 0 AND min_pass_percentage <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_exam_types_passing_rule_check') THEN
    ALTER TABLE public.school_exam_types
      ADD CONSTRAINT school_exam_types_passing_rule_check CHECK (passing_rule IN ('aggregate', 'compulsory', 'both'));
  END IF;
END $$;

-- Validate a single mark server-side -----------------------------------------
CREATE OR REPLACE FUNCTION public.school_exam_marks_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max numeric;
BEGIN
  SELECT max_marks INTO v_max FROM public.school_exam_subjects WHERE id = NEW.subject_id;
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

INSERT INTO public.school_exam_types (name, sort_order)
SELECT v.name, v.sort_order
FROM (VALUES ('First Term', 1), ('Mid Term', 2), ('Annual Exam', 3)) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.school_exam_types);

-- Row level security ----------------------------------------------------------
ALTER TABLE public.school_exam_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_exam_marks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_exam_types FROM anon, authenticated;
REVOKE ALL ON public.school_exam_subjects FROM anon, authenticated;
REVOKE ALL ON public.school_exam_marks FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_exam_marks TO authenticated;

DROP POLICY IF EXISTS "Staff can read exams" ON public.school_exam_types;
CREATE POLICY "Staff can read exams" ON public.school_exam_types FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "Admins can add exams" ON public.school_exam_types;
CREATE POLICY "Admins can add exams" ON public.school_exam_types FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can edit exams" ON public.school_exam_types;
CREATE POLICY "Admins can edit exams" ON public.school_exam_types FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can remove exams" ON public.school_exam_types;
CREATE POLICY "Admins can remove exams" ON public.school_exam_types FOR DELETE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "Staff can read exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Staff can read exam subjects" ON public.school_exam_subjects FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "Admins can add exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Admins can add exam subjects" ON public.school_exam_subjects FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can edit exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Admins can edit exam subjects" ON public.school_exam_subjects FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can remove exam subjects" ON public.school_exam_subjects;
CREATE POLICY "Admins can remove exam subjects" ON public.school_exam_subjects FOR DELETE TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "Staff and the student themselves can read exam marks" ON public.school_exam_marks;
CREATE POLICY "Staff and the student themselves can read exam marks" ON public.school_exam_marks FOR SELECT TO authenticated USING (is_staff() OR student_id = own_student_id());
DROP POLICY IF EXISTS "Exam staff can add exam marks" ON public.school_exam_marks;
CREATE POLICY "Exam staff can add exam marks" ON public.school_exam_marks FOR INSERT TO authenticated WITH CHECK (is_exam_staff());
DROP POLICY IF EXISTS "Exam staff can edit exam marks" ON public.school_exam_marks;
CREATE POLICY "Exam staff can edit exam marks" ON public.school_exam_marks FOR UPDATE TO authenticated USING (is_exam_staff()) WITH CHECK (is_exam_staff());
DROP POLICY IF EXISTS "Exam staff can remove exam marks" ON public.school_exam_marks;
CREATE POLICY "Exam staff can remove exam marks" ON public.school_exam_marks FOR DELETE TO authenticated USING (is_exam_staff());
