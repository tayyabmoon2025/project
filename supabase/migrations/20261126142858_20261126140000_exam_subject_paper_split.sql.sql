/*
# Paper A & Paper B split for exam subjects and marks

1. Plain-English explanation
- Some schools sit two papers for one subject (for example English Paper A of 50 marks
  and Paper B of 50 marks, totalling 100). Until now a subject had only one paper
  total, so the two papers had to be merged by hand. This migration lets a subject be
  flagged as a two-paper subject and records each paper's marks alongside the combined
  total, so the report card can show the breakdown (A: 42 + B: 45) while totals,
  percentages and grades keep working exactly as before.

2. Modified tables
- `school_exam_subjects`
  - `paper_split` (boolean, NOT NULL, default false) — true when the subject is sat as
    Paper A + Paper B.
  - `paper_a_max` (numeric(6,2), NOT NULL, default 50) — the Paper A total. Only used
    when `paper_split` is true.
  - `paper_b_max` (numeric(6,2), NOT NULL, default 50) — the Paper B total. Only used
    when `paper_split` is true.
- `school_exam_marks`
  - `paper_a_marks` (numeric(6,2), nullable) — the marks obtained on Paper A.
  - `paper_b_marks` (numeric(6,2), nullable) — the marks obtained on Paper B.
  - `obtained_marks` keeps holding the combined total (A + B), so every existing
    result, ranking and report-card calculation reads the same value as before.

3. Security changes
- No new tables and no policy changes. RLS stays as it was on both tables, and the
  table-level grants already cover the new columns.
- The server-side validation trigger `school_exam_marks_validate` is replaced so it
  also rejects a Paper A or Paper B mark higher than that paper's total. The existing
  rule that the combined marks cannot exceed the subject total still applies.

4. Important notes
- Paper maxima must be positive, and for a split subject their sum should equal the
  subject's total; this is checked in the app when the toggle is set, not locked in
  the database, so a school can still record unequal papers.
- The migration is idempotent: columns are added only when missing, and the trigger
  is recreated in place.
*/

ALTER TABLE public.school_exam_subjects
  ADD COLUMN IF NOT EXISTS paper_split boolean NOT NULL DEFAULT false;
ALTER TABLE public.school_exam_subjects
  ADD COLUMN IF NOT EXISTS paper_a_max numeric(6,2) NOT NULL DEFAULT 50;
ALTER TABLE public.school_exam_subjects
  ADD COLUMN IF NOT EXISTS paper_b_max numeric(6,2) NOT NULL DEFAULT 50;

ALTER TABLE public.school_exam_marks
  ADD COLUMN IF NOT EXISTS paper_a_marks numeric(6,2);
ALTER TABLE public.school_exam_marks
  ADD COLUMN IF NOT EXISTS paper_b_marks numeric(6,2);

ALTER TABLE public.school_exam_subjects DROP CONSTRAINT IF EXISTS school_exam_subjects_paper_max_check;
ALTER TABLE public.school_exam_subjects
  ADD CONSTRAINT school_exam_subjects_paper_max_check
    CHECK (paper_a_max > 0 AND paper_b_max > 0);

CREATE OR REPLACE FUNCTION public.school_exam_marks_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max numeric;
  v_split boolean;
  v_a_max numeric;
  v_b_max numeric;
BEGIN
  SELECT max_marks, paper_split, paper_a_max, paper_b_max
    INTO v_max, v_split, v_a_max, v_b_max
  FROM public.school_exam_subjects
  WHERE id = NEW.subject_id;

  IF v_max IS NULL THEN
    RAISE EXCEPTION 'That subject does not exist for this exam';
  END IF;

  IF NEW.obtained_marks IS NOT NULL AND NEW.obtained_marks > v_max THEN
    RAISE EXCEPTION 'Marks cannot be more than the subject total of %', v_max;
  END IF;

  IF v_split THEN
    IF NEW.paper_a_marks IS NOT NULL AND NEW.paper_a_marks > v_a_max THEN
      RAISE EXCEPTION 'Paper A marks cannot be more than the Paper A total of %', v_a_max;
    END IF;
    IF NEW.paper_b_marks IS NOT NULL AND NEW.paper_b_marks > v_b_max THEN
      RAISE EXCEPTION 'Paper B marks cannot be more than the Paper B total of %', v_b_max;
    END IF;
  END IF;

  IF NEW.obtained_marks IS NULL AND NEW.is_absent IS NOT TRUE THEN
    RAISE EXCEPTION 'Enter the marks or mark the student absent';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.school_exam_marks_validate() FROM PUBLIC, anon, authenticated;
