/*
# Live class raise-hand queue

1. Plain-English summary
- Students (or their parents) in a live online class can now raise a virtual hand to
  tell the teacher they have a question. The raised hand is stored in the database so
  the teacher's live attendance feed picks it up on its next refresh, and the teacher
  can mark the question as answered (which lowers the hand).

2. New Tables
- `school_live_class_hands` — one row per student per live class session:
  - `id` (uuid, primary key)
  - `class_id` (uuid, required, references `school_live_classes`, cascade delete) —
    deleting a session removes its hand raises with it.
  - `student_id` (uuid, required, references `school_students`, cascade delete) — a
    withdrawn or deleted student never leaves an orphan row behind.
  - `student_name` (text, required) — the student's name when the hand went up.
  - `raised_at` (timestamptz, required, defaults to now()) — when the hand was raised.
  - `lowered_at` (timestamptz, optional) — when the hand went down; NULL means the
    hand is still up.
  - `created_at` / `updated_at` (timestamptz).

3. Uniqueness and indexes
- A student has at most one hand row per class: re-raising updates the existing row
  (clears `lowered_at` and stamps a new `raised_at`) instead of creating duplicates.
- Index on `class_id` for the teacher's live feed poll.

4. Security
- RLS is enabled; `anon` is fully revoked — only signed-in users reach the table.
- SELECT: staff, the student themself, and that student's linked parents — the same
  visibility rule as the live class attendance table.
- Writes happen ONLY through two SECURITY DEFINER functions, `raise_hand` and
  `lower_hand`, which re-check that the class is open, the student is active and in
  the class, and that the caller is staff, the student themself, or a linked parent.
  No direct INSERT/UPDATE/DELETE privilege is granted on the table, so a hand cannot
  be forged for somebody else's child.
- Both functions are revoked from PUBLIC and anon, granted to authenticated only.

5. Important notes
- Lowering a hand does not delete the row; it stamps `lowered_at` so the class
  history keeps a record of who asked questions.
- Raising a hand for an already-raised hand simply refreshes `raised_at`.
*/

CREATE TABLE IF NOT EXISTS public.school_live_class_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.school_live_classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  lowered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_live_class_hands_key
  ON public.school_live_class_hands (class_id, student_id);

CREATE INDEX IF NOT EXISTS school_live_class_hands_class_idx
  ON public.school_live_class_hands (class_id, raised_at DESC);

ALTER TABLE public.school_live_class_hands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_live_class_hands FROM anon;

GRANT SELECT ON public.school_live_class_hands TO authenticated;

DROP POLICY IF EXISTS "Staff and families can read live class hands" ON public.school_live_class_hands;
CREATE POLICY "Staff and families can read live class hands"
ON public.school_live_class_hands FOR SELECT
TO authenticated
USING (
  public.is_staff()
  OR student_id = public.own_student_id()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid()
      AND psl.student_id = school_live_class_hands.student_id
  )
);

-- ---------------------------------------------------------------------------
-- Raise / lower a hand (all writes go through these two functions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.raise_hand(
  p_class_id uuid,
  p_student_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_class public.school_live_classes;
  v_student public.school_students;
  v_row public.school_live_class_hands;
BEGIN
  SELECT * INTO v_class FROM public.school_live_classes WHERE id = p_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That live class no longer exists.';
  END IF;

  IF v_class.status NOT IN ('approved', 'live') THEN
    RAISE EXCEPTION 'This live class is not open yet.';
  END IF;

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student record no longer exists.';
  END IF;

  IF v_student.status <> 'active' THEN
    RAISE EXCEPTION 'This student is not an active learner.';
  END IF;

  IF lower(btrim(v_student.class_name)) <> lower(btrim(v_class.class_name))
     OR lower(btrim(v_student.section_name)) <> lower(btrim(v_class.section_name)) THEN
    RAISE EXCEPTION 'This live class is not for %''s class.', v_student.full_name;
  END IF;

  IF NOT (
    public.is_staff()
    OR v_student.id = public.own_student_id()
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid() AND psl.student_id = v_student.id
    )
  ) THEN
    RAISE EXCEPTION 'You cannot raise a hand for this student.';
  END IF;

  INSERT INTO public.school_live_class_hands
    (class_id, student_id, student_name, raised_at, lowered_at)
  VALUES
    (p_class_id, p_student_id, v_student.full_name, now(), NULL)
  ON CONFLICT (class_id, student_id) DO UPDATE
    SET raised_at = now(),
        lowered_at = NULL,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', v_row.student_id,
    'student_name', v_row.student_name,
    'raised_at', v_row.raised_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.lower_hand(
  p_class_id uuid,
  p_student_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.school_live_class_hands;
BEGIN
  SELECT * INTO v_row
  FROM public.school_live_class_hands
  WHERE class_id = p_class_id AND student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This student has not raised a hand.';
  END IF;

  IF NOT (
    public.is_staff()
    OR v_row.student_id = public.own_student_id()
    OR EXISTS (
      SELECT 1 FROM public.parent_student_links psl
      WHERE psl.parent_user_id = auth.uid() AND psl.student_id = v_row.student_id
    )
  ) THEN
    RAISE EXCEPTION 'You cannot lower a hand for this student.';
  END IF;

  UPDATE public.school_live_class_hands
     SET lowered_at = now(),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', v_row.student_id,
    'student_name', v_row.student_name,
    'lowered_at', v_row.lowered_at
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.raise_hand(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lower_hand(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raise_hand(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lower_hand(uuid, uuid) TO authenticated;
