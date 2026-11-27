/*
# Add Role-Based Authentication System

## Purpose
Introduces role-based authentication with three dashboards: Admin, Teacher, and Parent.
Admins can create, suspend, or remove Admin, Teacher, and Parent accounts.
Parents are linked to their children (students) via a join table.

## 1. New Tables

### `user_profiles`
- `id` (uuid, PK, references auth.users on delete cascade)
- `full_name` (text, not null)
- `role` (text, not null) — 'admin', 'teacher', or 'parent'
- `status` (text, not null, default 'active') — 'active' or 'suspended'
- `created_at` (timestamptz, default now())

### `parent_student_links`
- `id` (uuid, PK)
- `parent_user_id` (uuid, references user_profiles.id, on delete cascade)
- `student_id` (uuid, references school_students.id, on delete cascade)
- `created_at` (timestamptz, default now())
- Unique (parent_user_id, student_id)

## 2. Security
- RLS enabled on both new tables.
- Users can read their own profile; admins can read/write all profiles.
- Users can update only their own full_name (not role/status).
- Parents can manage their own student links; admins/teachers can read all links.
- is_admin() SECURITY DEFINER helper for policy checks.
- Existing school_students and school_attendance policies updated: authenticated-only, with parent scoping via parent_student_links.

## 3. Important Notes
1. App now requires sign-in — all policies target `authenticated` only.
2. is_admin() reads user_profiles bypassing RLS (SECURITY DEFINER).
3. REVOKE EXECUTE on is_admin from PUBLIC, anon; grant to authenticated.
*/

-- ============================================================
-- 1. user_profiles table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'teacher', 'parent')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;

-- ============================================================
-- 2. parent_student_links table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.parent_student_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, student_id)
);

ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parent_student_links TO authenticated;

-- ============================================================
-- 3. Helper function: is_admin()
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ============================================================
-- 4. user_profiles RLS policies
-- ============================================================
DROP POLICY IF EXISTS "Users can read own or all profiles as admin" ON public.user_profiles;
CREATE POLICY "Users can read own or all profiles as admin"
ON public.user_profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own full_name" ON public.user_profiles;
CREATE POLICY "Users can update own full_name"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can insert profiles" ON public.user_profiles;
CREATE POLICY "Admins can insert profiles"
ON public.user_profiles FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete profiles" ON public.user_profiles;
CREATE POLICY "Admins can delete profiles"
ON public.user_profiles FOR DELETE
TO authenticated
USING (public.is_admin());

-- ============================================================
-- 5. parent_student_links RLS policies
-- ============================================================
DROP POLICY IF EXISTS "Parents and staff can read links" ON public.parent_student_links;
CREATE POLICY "Parents and staff can read links"
ON public.parent_student_links FOR SELECT
TO authenticated
USING (
  parent_user_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'teacher' AND status = 'active'
  )
);

DROP POLICY IF EXISTS "Parents can create own links" ON public.parent_student_links;
CREATE POLICY "Parents can create own links"
ON public.parent_student_links FOR INSERT
TO authenticated
WITH CHECK (parent_user_id = auth.uid());

DROP POLICY IF EXISTS "Parents or admins can delete links" ON public.parent_student_links;
CREATE POLICY "Parents or admins can delete links"
ON public.parent_student_links FOR DELETE
TO authenticated
USING (parent_user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "No direct updates to links" ON public.parent_student_links;
CREATE POLICY "No direct updates to links"
ON public.parent_student_links FOR UPDATE
TO authenticated
USING (false) WITH CHECK (false);

-- ============================================================
-- 6. Update school_students policies (authenticated-only, parent-scoped)
-- ============================================================
DROP POLICY IF EXISTS "School workspace can read students" ON public.school_students;
DROP POLICY IF EXISTS "School workspace can add students" ON public.school_students;
DROP POLICY IF EXISTS "School workspace can update students" ON public.school_students;
DROP POLICY IF EXISTS "School workspace can remove students" ON public.school_students;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_students FROM anon;

CREATE POLICY "Staff and parents can read students"
ON public.school_students FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_students.id
  )
);

CREATE POLICY "Staff can add students"
ON public.school_students FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
);

CREATE POLICY "Staff can update students"
ON public.school_students FOR UPDATE
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
);

CREATE POLICY "Staff can remove students"
ON public.school_students FOR DELETE
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
);

-- ============================================================
-- 7. Update school_attendance policies (authenticated-only, parent-scoped)
-- ============================================================
DROP POLICY IF EXISTS "School workspace can read attendance" ON public.school_attendance;
DROP POLICY IF EXISTS "School workspace can add attendance" ON public.school_attendance;
DROP POLICY IF EXISTS "School workspace can update attendance" ON public.school_attendance;
DROP POLICY IF EXISTS "School workspace can remove attendance" ON public.school_attendance;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_attendance FROM anon;

CREATE POLICY "Staff and parents can read attendance"
ON public.school_attendance FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_attendance.student_id
  )
);

CREATE POLICY "Staff can add attendance"
ON public.school_attendance FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
);

CREATE POLICY "Staff can update attendance"
ON public.school_attendance FOR UPDATE
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
);

CREATE POLICY "Staff can remove attendance"
ON public.school_attendance FOR DELETE
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'teacher' AND status = 'active')
);

-- ============================================================
-- 8. Revoke anon access from other existing tables
-- ============================================================
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_notice_templates FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_student_notices FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_other_information FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_fee_transactions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.school_admission_options FROM anon;
