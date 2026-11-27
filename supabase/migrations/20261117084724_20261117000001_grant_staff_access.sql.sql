/*
# Grant Office Assistant and Accountant staff access

1. Purpose
- The new "office_assistant" and "accountant" roles need to see and manage the
  same school workspace as teachers do, otherwise they sign in to an empty app.
- This migration wires them into the school_students and school_attendance
  policies as staff members.

2. New helper
- `is_staff()` returns true when the signed-in user is an active admin, teacher,
  office assistant, or accountant. It mirrors the existing `is_admin()` helper.

3. Changes
- school_students SELECT/INSERT/UPDATE/DELETE policies now allow any staff role
  (admin, teacher, office assistant, accountant), plus parent-scoped reads.
- school_attendance SELECT/INSERT/UPDATE/DELETE policies allow the same staff set.

4. Security
- is_staff() is SECURITY DEFINER with a fixed search_path and REVOKEd from
  PUBLIC/anonymous, matching is_admin().
- Parent read scoping is unchanged; parents still only see linked students.
*/

-- 1. Staff helper function
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'teacher', 'office_assistant', 'accountant')
      AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

-- 2. school_students policies
DROP POLICY IF EXISTS "Staff and parents can read students" ON public.school_students;
CREATE POLICY "Staff and parents can read students"
ON public.school_students FOR SELECT
TO authenticated
USING (
  public.is_staff()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_students.id
  )
);

DROP POLICY IF EXISTS "Staff can add students" ON public.school_students;
CREATE POLICY "Staff can add students"
ON public.school_students FOR INSERT
TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update students" ON public.school_students;
CREATE POLICY "Staff can update students"
ON public.school_students FOR UPDATE
TO authenticated
USING (public.is_staff())
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can remove students" ON public.school_students;
CREATE POLICY "Staff can remove students"
ON public.school_students FOR DELETE
TO authenticated
USING (public.is_staff());

-- 3. school_attendance policies
DROP POLICY IF EXISTS "Staff and parents can read attendance" ON public.school_attendance;
CREATE POLICY "Staff and parents can read attendance"
ON public.school_attendance FOR SELECT
TO authenticated
USING (
  public.is_staff()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_attendance.student_id
  )
);

DROP POLICY IF EXISTS "Staff can add attendance" ON public.school_attendance;
CREATE POLICY "Staff can add attendance"
ON public.school_attendance FOR INSERT
TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update attendance" ON public.school_attendance;
CREATE POLICY "Staff can update attendance"
ON public.school_attendance FOR UPDATE
TO authenticated
USING (public.is_staff())
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can remove attendance" ON public.school_attendance;
CREATE POLICY "Staff can remove attendance"
ON public.school_attendance FOR DELETE
TO authenticated
USING (public.is_staff());
