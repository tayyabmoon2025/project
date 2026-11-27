/*
# Exam marks — store a letter grade for grade-only subjects

## 1. Summary
Adds a `grade` column to school_exam_marks so a grade-only subject (Drawing,
Nazra, Ethics) can be recorded as a letter (A+ to F) instead of numeric marks.
The mark-validation trigger is updated to accept a row that carries a grade but
no number, while still refusing a row that is neither a mark, a grade, nor an
absence.

## 2. Modified tables
### school_exam_marks
- `grade` text, optional — the letter grade for a grade-only subject. Null for
  ordinary numeric subjects.

## 3. Server-side checks
- A check constraint keeps `grade` to one of A+, A, B, C, D, F when present.
- The validate trigger now passes when `grade` is set, even if `obtained_marks`
  is null.

## 4. Security
No change to RLS, policies or grants.
*/

ALTER TABLE public.school_exam_marks
  ADD COLUMN IF NOT EXISTS grade text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_exam_marks_grade_check') THEN
    ALTER TABLE public.school_exam_marks
      ADD CONSTRAINT school_exam_marks_grade_check
      CHECK (grade IS NULL OR grade IN ('A+', 'A', 'B', 'C', 'D', 'F'));
  END IF;
END $$;

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
  IF NEW.obtained_marks IS NULL AND NEW.grade IS NULL AND NEW.is_absent IS NOT TRUE THEN
    RAISE EXCEPTION 'Enter the marks or the grade, or mark the student absent';
  END IF;
  RETURN NEW;
END;
$function$;
