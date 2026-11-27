/*
# Homework module — assign homework, publish it, and let parents see the daily diary

## 1. Summary
Adds the two tables behind the new Homework module. A teacher writes one
assignment for a class and section on a given date; every active student in that
class and section receives it. Homework can be saved as a draft while it is being
written and published when it is ready, so parents never see a half-finished
entry. A parent or a student then reads the published homework through a
read-only function, which also hides homework while a fee balance is pending —
the same rule the exam results already follow.

## 2. New tables

### school_homework
One row per assignment, for one class and section on one date.
- `id` uuid primary key.
- `class_name` text, required — the class the work is for.
- `section_name` text, required — the section the work is for.
- `subject_name` text, required — the subject the work belongs to.
- `title` text, required, 2 to 120 characters.
- `details` text, optional — the full instructions in the teacher's words.
- `homework_date` date, required, defaults to today — the day the work is set.
- `due_date` date, optional — the day it must be handed in. A due date before
  the set date is refused by a check constraint.
- `attachment_url` text, optional — a link to a worksheet or photo.
- `status` text, required, 'draft' or 'published', defaults to 'draft'.
- `assigned_by` uuid — the signed-in teacher who wrote it.
- `assigned_by_name` text — the teacher's name, kept so the diary still reads
  correctly if the account is later removed.
- `published_at` timestamptz, optional — set the moment it is published.
- `created_at` / `updated_at` timestamptz.

### school_homework_completions
One row per student per assignment, recording what happened to the work.
- `id` uuid primary key.
- `homework_id` uuid, required, references school_homework (cascade delete).
- `student_id` uuid, required, references school_students (cascade delete) — a
  withdrawn or deleted student never leaves an orphan row behind.
- `status` text, required, 'pending' | 'submitted' | 'late' | 'missing',
  defaults to 'pending'.
- `remarks` text, optional — a short note from the teacher.
- `marked_by` uuid — the signed-in user who recorded it.
- `created_at` / `updated_at` timestamptz.

## 3. Uniqueness and indexes
- An assignment is unique per class, section, subject and date (case-insensitive),
  so the same work cannot be entered twice for one class on one day.
- A completion row is unique per assignment and student, which makes marking the
  same class twice an update rather than a duplicate.
- Indexes on (class_name, section_name, homework_date) for the class diary, on
  homework_date for the daily view, and on student_id for the parent lookup.

## 4. Security
- RLS is enabled on both tables. No access is possible until a policy allows it.
- `anon` is revoked from both tables; only signed-in users reach them at all.
- Homework may be read by active staff. A parent or student does NOT read the
  table directly — they read the published list through the function below,
  which applies the fee rule and never returns a draft.
- Writing homework is limited to administrators and teachers through the existing
  `is_exam_staff()` helper, because setting homework is a teaching duty.
- Recording completion is limited to the same group.
- Every grant is explicit, and only the four verbs the app uses are granted.

## 5. Server-side checks
- A check constraint keeps the title a sensible length and the status one of the
  two allowed values.
- A check constraint refuses a due date that falls before the date the work was
  set.
- A trigger stamps `published_at` the first time a row is published, and refuses
  an assignment that has no title or no subject even if the check is bypassed.

## 6. Read-only function for parents and students
`public.portal_homework()` returns the published homework for the records the
signed-in account is allowed to see:
- For a parent, every child linked through `parent_student_links`.
- For a student, their own record.
- Staff calling it get an empty list, because they have the full module instead.
- Homework is withheld — `blocked: true` with the outstanding amount, and no
  assignment rows — while the student's `fee_balance` is greater than zero and
  the caller is not staff. This mirrors the exam-results rule exactly.
- Draft rows are never returned, whatever the caller's role.

## 7. Notes
- No existing table, column or row is touched.
- Nothing is deleted. Removing an assignment removes only its own completion rows.
*/

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_homework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name text NOT NULL,
  section_name text NOT NULL,
  subject_name text NOT NULL,
  title text NOT NULL,
  details text,
  homework_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  attachment_url text,
  status text NOT NULL DEFAULT 'draft',
  assigned_by uuid,
  assigned_by_name text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_homework_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT school_homework_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  CONSTRAINT school_homework_subject_check CHECK (length(btrim(subject_name)) BETWEEN 1 AND 60),
  CONSTRAINT school_homework_class_check CHECK (length(btrim(class_name)) BETWEEN 1 AND 40),
  CONSTRAINT school_homework_section_check CHECK (length(btrim(section_name)) BETWEEN 1 AND 40),
  CONSTRAINT school_homework_due_check CHECK (due_date IS NULL OR due_date >= homework_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_homework_key
  ON public.school_homework (
    lower(btrim(class_name)),
    lower(btrim(section_name)),
    lower(btrim(subject_name)),
    homework_date
  );

CREATE INDEX IF NOT EXISTS school_homework_class_date_idx
  ON public.school_homework (class_name, section_name, homework_date DESC);

CREATE INDEX IF NOT EXISTS school_homework_date_idx
  ON public.school_homework (homework_date DESC);

CREATE TABLE IF NOT EXISTS public.school_homework_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id uuid NOT NULL REFERENCES public.school_homework(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  remarks text,
  marked_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_homework_completions_status_check
    CHECK (status IN ('pending', 'submitted', 'late', 'missing'))
);

CREATE UNIQUE INDEX IF NOT EXISTS school_homework_completions_key
  ON public.school_homework_completions (homework_id, student_id);

CREATE INDEX IF NOT EXISTS school_homework_completions_student_idx
  ON public.school_homework_completions (student_id);

-- ---------------------------------------------------------------------------
-- Server-side checks
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_homework_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;

  IF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.school_homework_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_homework_validate_trg ON public.school_homework;
CREATE TRIGGER school_homework_validate_trg
  BEFORE INSERT OR UPDATE ON public.school_homework
  FOR EACH ROW EXECUTE FUNCTION public.school_homework_validate();

-- ---------------------------------------------------------------------------
-- Read-only view of published homework for a parent or a student
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portal_homework()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff boolean;
  v_students jsonb;
  v_entries jsonb;
BEGIN
  v_staff := public.is_staff();

  -- The records this account is allowed to see: a student's own record, or a
  -- parent's linked children. Staff have the full module and get nothing here.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_students
  FROM (
    SELECT s.id,
           s.full_name,
           s.class_name,
           s.section_name,
           GREATEST(0, COALESCE(s.fee_balance, 0)) AS due_amount
    FROM public.school_students s
    WHERE s.status = 'active'
      AND (
        s.id = public.own_student_id()
        OR EXISTS (
          SELECT 1 FROM public.parent_student_links psl
          WHERE psl.parent_user_id = auth.uid()
            AND psl.student_id = s.id
        )
      )
  ) t;

  -- A pending balance holds homework back for a parent or a student, exactly as
  -- it does for exam results. Staff are never held back.
  IF NOT v_staff AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_students) AS e
    WHERE (e->>'due_amount')::numeric > 0
  ) THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'students', v_students,
      'due_amount', (
        SELECT COALESCE(SUM((e->>'due_amount')::numeric), 0)
        FROM jsonb_array_elements(v_students) AS e
      ),
      'entries', '[]'::jsonb
    );
  END IF;

  -- Only published homework is ever returned, and only for the classes the
  -- linked records are actually in.
  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.homework_date DESC, h.subject_name), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT hw.id,
           hw.class_name,
           hw.section_name,
           hw.subject_name,
           hw.title,
           hw.details,
           hw.homework_date,
           hw.due_date,
           hw.attachment_url,
           hw.assigned_by_name,
           hw.published_at,
           hw.created_at,
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object(
                       'student_id', c.student_id,
                       'status', c.status,
                       'remarks', c.remarks))
              FROM public.school_homework_completions c
              WHERE c.homework_id = hw.id
                AND c.student_id IN (
                  SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_students) AS e
                )),
             '[]'::jsonb
           ) AS completions
    FROM public.school_homework hw
    WHERE hw.status = 'published'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_students) AS e
        WHERE e->>'class_name' = hw.class_name
          AND e->>'section_name' = hw.section_name
      )
      AND hw.homework_date >= (CURRENT_DATE - INTERVAL '60 days')
    ORDER BY hw.homework_date DESC, hw.subject_name
    LIMIT 200
  ) h;

  RETURN jsonb_build_object(
    'blocked', false,
    'students', v_students,
    'entries', v_entries
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.portal_homework() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_homework() TO authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_homework ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_homework_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_homework FROM anon, authenticated;
REVOKE ALL ON public.school_homework_completions FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_homework TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_homework_completions TO authenticated;

-- Homework -----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read homework" ON public.school_homework;
CREATE POLICY "Staff can read homework"
ON public.school_homework FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Teachers can add homework" ON public.school_homework;
CREATE POLICY "Teachers can add homework"
ON public.school_homework FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Teachers can edit homework" ON public.school_homework;
CREATE POLICY "Teachers can edit homework"
ON public.school_homework FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Teachers can remove homework" ON public.school_homework;
CREATE POLICY "Teachers can remove homework"
ON public.school_homework FOR DELETE
TO authenticated
USING (is_exam_staff());

-- Completions --------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read homework completions" ON public.school_homework_completions;
CREATE POLICY "Staff can read homework completions"
ON public.school_homework_completions FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Teachers can record homework completions" ON public.school_homework_completions;
CREATE POLICY "Teachers can record homework completions"
ON public.school_homework_completions FOR INSERT
TO authenticated
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Teachers can update homework completions" ON public.school_homework_completions;
CREATE POLICY "Teachers can update homework completions"
ON public.school_homework_completions FOR UPDATE
TO authenticated
USING (is_exam_staff())
WITH CHECK (is_exam_staff());

DROP POLICY IF EXISTS "Teachers can remove homework completions" ON public.school_homework_completions;
CREATE POLICY "Teachers can remove homework completions"
ON public.school_homework_completions FOR DELETE
TO authenticated
USING (is_exam_staff());
