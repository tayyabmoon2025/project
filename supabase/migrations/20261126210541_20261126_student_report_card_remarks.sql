/*
# Student report card remarks (grade bank + per-student override)

## 1. Summary
Connects the Grade Remarks Bank to the Student Report Card / DMC print layout.

When a report card is opened, the remark for the student's overall grade is read from
the bank (school_grade_remarks). A teacher may still tweak the wording for one student
right before printing; that tweak is saved here as a per-student override and then wins
over the bank. Clearing the override returns the student to the bank wording, so an edit
to the bank immediately shows on every report card that has not been overridden.

## 2. New table: school_report_card_remarks
- `id` (uuid, primary key)
- `exam_type_id` (uuid, references school_exam_types, required) — the examination the
  report card belongs to. Overrides are per exam, so the same student can carry a
  different remark in a different term.
- `student_id` (uuid, references school_students, required) — whose report card.
- `grade` (text, required, 1–3 characters) — the overall grade the override was written
  for. Kept so the screen can tell that a stored override no longer matches the current
  grade and should be replaced by the bank wording.
- `remark` (text, required, 3–300 characters) — the wording that prints.
- `created_at` / `updated_at` (timestamptz)

One row per student per exam, enforced by a unique index on (exam_type_id, student_id),
so saving again updates the existing row instead of creating a duplicate.

## 3. Security
- RLS enabled.
- `anon` is revoked outright; the app always has a signed-in staff account.
- SELECT for staff (is_staff()) — the remarks are read when a report card is opened.
- INSERT / UPDATE / DELETE for exam staff (is_exam_staff()), matching how the Grade
  Remarks Bank itself is protected, so only the people who can edit the bank can
  override a single student's remark.
- Students are NOT given read access: an override is an internal teaching note and is
  only ever surfaced on the printed report card.
- Grants are explicit for the `authenticated` role only.

## 4. Notes
- No existing table or column is dropped, renamed or retyped, so no data is lost.
- The migration is safe to re-run: the table uses IF NOT EXISTS and every policy is
  dropped before being created.
- Nothing is seeded: an empty table simply means every report card uses the bank wording.
*/

CREATE TABLE IF NOT EXISTS public.school_report_card_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_type_id uuid NOT NULL REFERENCES public.school_exam_types(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  grade text NOT NULL,
  remark text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_report_card_remarks_grade_check CHECK (length(btrim(grade)) BETWEEN 1 AND 3),
  CONSTRAINT school_report_card_remarks_remark_check CHECK (length(btrim(remark)) BETWEEN 3 AND 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_report_card_remarks_key
  ON public.school_report_card_remarks (exam_type_id, student_id);

CREATE INDEX IF NOT EXISTS school_report_card_remarks_student_idx
  ON public.school_report_card_remarks (student_id);

ALTER TABLE public.school_report_card_remarks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_report_card_remarks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_report_card_remarks TO authenticated;

DROP POLICY IF EXISTS "Staff can read report card remarks" ON public.school_report_card_remarks;
CREATE POLICY "Staff can read report card remarks"
  ON public.school_report_card_remarks FOR SELECT
  TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "Exam staff can add report card remarks" ON public.school_report_card_remarks;
CREATE POLICY "Exam staff can add report card remarks"
  ON public.school_report_card_remarks FOR INSERT
  TO authenticated WITH CHECK (public.is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can edit report card remarks" ON public.school_report_card_remarks;
CREATE POLICY "Exam staff can edit report card remarks"
  ON public.school_report_card_remarks FOR UPDATE
  TO authenticated USING (public.is_exam_staff()) WITH CHECK (public.is_exam_staff());

DROP POLICY IF EXISTS "Exam staff can remove report card remarks" ON public.school_report_card_remarks;
CREATE POLICY "Exam staff can remove report card remarks"
  ON public.school_report_card_remarks FOR DELETE
  TO authenticated USING (public.is_exam_staff());
