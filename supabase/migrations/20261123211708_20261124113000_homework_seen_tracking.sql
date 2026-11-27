/*
# Homework seen tracking and the staff directory

## 1. Summary
Adds two things the Homework module needs so staff can see who has read an
assignment, and so the app can list the school's staff by name.

1. A new table records which staff member has opened which assignment. Each staff
   member marks their own reading; nobody can mark it on someone else's behalf.
2. A read-only function returns the school's staff list (name and role only) so a
   teacher can see who has read an assignment and who has not. Until now a teacher
   could not read another account's record, so no staff list was available at all.

Nothing existing is changed, and no existing row is touched.

## 2. New table

### school_homework_views
One row per staff member per assignment they have opened.
- `id` uuid primary key.
- `homework_id` uuid, required, references `school_homework` (cascade delete) —
  removing an assignment removes only its own reading records.
- `user_id` uuid, required, defaults to the signed-in account — the staff member
  who read it.
- `seen_at` timestamptz, required, defaults to now — when they read it.

A unique constraint on `(homework_id, user_id)` means opening the same assignment
twice updates the timestamp instead of adding a second row, so the seen list can
never show one person twice.

## 3. New function

### staff_directory()
Returns the name and role of every active staff account — administrators,
teachers, office assistants and accountants — so the Homework module can show who
has seen an assignment and who has not.
- Only names and roles are returned. No username, no contact details, no account
  status beyond the fact that the account is active.
- A staff member calling it gets the list. Anyone who is not active staff gets an
  empty list, because the check runs inside the function.
- It is a `SECURITY DEFINER` function so it can read the account table, and it is
  revoked from the public and anonymous roles, then granted only to signed-in
  users.

## 4. Security
- RLS is enabled on `school_homework_views`. No access is possible until a policy
  allows it.
- `anon` is revoked; only signed-in users reach the table at all.
- Reading the reading records is limited to active staff.
- A staff member may only add a row for themselves (`user_id` must equal their own
  account), and may only update or remove their own row. A reading record cannot be
  forged for another person.
- Every grant is explicit, and only the four verbs the app uses are granted.

## 5. Notes
- No existing table, column or row is modified.
- The reading record is a log, not a permission: it grants no access to anything.
*/

-- ---------------------------------------------------------------------------
-- Who has read which assignment
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_homework_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id uuid NOT NULL REFERENCES public.school_homework(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_homework_views_key UNIQUE (homework_id, user_id)
);

CREATE INDEX IF NOT EXISTS school_homework_views_user_idx
  ON public.school_homework_views (user_id);

-- ---------------------------------------------------------------------------
-- The staff list, names and roles only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_directory()
RETURNS TABLE(id uuid, full_name text, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.role
  FROM public.user_profiles p
  WHERE public.is_staff()
    AND p.status = 'active'
    AND p.role IN ('admin', 'teacher', 'office_assistant', 'accountant')
  ORDER BY p.full_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_directory() TO authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_homework_views ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_homework_views FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_homework_views TO authenticated;

DROP POLICY IF EXISTS "Staff can read homework views" ON public.school_homework_views;
CREATE POLICY "Staff can read homework views"
ON public.school_homework_views FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Staff can record their own homework view" ON public.school_homework_views;
CREATE POLICY "Staff can record their own homework view"
ON public.school_homework_views FOR INSERT
TO authenticated
WITH CHECK (is_staff() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can update their own homework view" ON public.school_homework_views;
CREATE POLICY "Staff can update their own homework view"
ON public.school_homework_views FOR UPDATE
TO authenticated
USING (is_staff() AND user_id = auth.uid())
WITH CHECK (is_staff() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can remove their own homework view" ON public.school_homework_views;
CREATE POLICY "Staff can remove their own homework view"
ON public.school_homework_views FOR DELETE
TO authenticated
USING (is_staff() AND user_id = auth.uid());
