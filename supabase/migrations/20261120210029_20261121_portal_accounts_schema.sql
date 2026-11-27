/*
# Portal accounts — link logins to students, add the Student role, and sync account status

## 1. Purpose
The school portal now needs logins for students and teachers that are created automatically
when the student or teacher is added, and that switch off automatically when the person
leaves. This migration adds the storage and access rules that make that possible.

## 2. Modified table: `public.user_profiles`
- `mobile_number` (text, nullable) — the mobile number a teacher signs in with.
- `student_id` (uuid, nullable) — links a login to the student record it belongs to.
  Deleting the student removes the login (ON DELETE CASCADE).
- The allowed `role` values now include `student`, so the check constraint is replaced.
- A partial unique index guarantees one login per student record.

## 3. New table: `public.school_password_requests`
Someone who has forgotten their password cannot sign in, so they cannot write an
authenticated row. This table lets the login screen record a "please reset my password"
request for the office to action.
- `id`, `username` (the username they typed), `note` (optional message),
  `status` ('pending' | 'resolved'), `created_at`, `resolved_at`, `resolved_by`.

## 4. Security changes
The most important fix here: the previous rule let ANY signed-in user update their own
profile row, and the table-level grant allowed every column. A signed-in student or parent
could therefore have promoted themselves to administrator, or un-suspended their own
account. This migration:
- Revokes all access to `user_profiles` from the anonymous role.
- Replaces the table-wide UPDATE grant with a grant on the `full_name` column ONLY, so a
  user can still rename themselves but cannot touch `role`, `status`, `username`, or
  `student_id`. Those columns are changed only by administrator-only functions.
- Revokes INSERT and DELETE from signed-in users; account creation and removal already go
  through administrator-only functions.
- Adds the `student` role to the staff/student read rules on `school_students`,
  `school_attendance` and `school_dmc_records` so a student can see their own record,
  their own attendance, and their own marks certificate — and nothing else.
- Adds a trigger on `school_students`: when a student is marked Inactive or Passed Out the
  linked login is suspended, and when the student returns to Active the login is restored.
  Suspension is enforced by the existing `is_admin()` / `is_staff()` helpers, which both
  require `status = 'active'`.

## 5. Notes
- No existing column is dropped, renamed, or retyped, and no rows are deleted.
- Existing accounts are unaffected: the new columns simply start empty.
*/

-- ---------------------------------------------------------------------------
-- 1. New columns on user_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS mobile_number text,
  ADD COLUMN IF NOT EXISTS student_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_student_id_fkey'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES public.school_students(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_student_id_key
  ON public.user_profiles (student_id)
  WHERE student_id IS NOT NULL;

-- Replace any existing role check so the new 'student' role is accepted.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%office_assistant%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant', 'student'));

-- ---------------------------------------------------------------------------
-- 2. Lock down user_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_profiles FROM anon;

REVOKE INSERT, UPDATE, DELETE ON public.user_profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.user_profiles TO authenticated;

DROP POLICY IF EXISTS "Admins can insert profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.user_profiles;

DROP POLICY IF EXISTS "Users can update own full_name" ON public.user_profiles;
CREATE POLICY "Users can update own full_name"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can read own or all profiles as admin" ON public.user_profiles;
CREATE POLICY "Users can read own or all profiles as admin"
ON public.user_profiles FOR SELECT
TO authenticated
USING ((auth.uid() = id) OR is_admin());

-- ---------------------------------------------------------------------------
-- 3. Let a student read their own record, attendance and marks certificate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.own_student_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT student_id FROM public.user_profiles
  WHERE id = auth.uid() AND role = 'student' AND status = 'active'
$$;

REVOKE EXECUTE ON FUNCTION public.own_student_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.own_student_id() TO authenticated;

DROP POLICY IF EXISTS "Staff and parents can read students" ON public.school_students;
CREATE POLICY "Staff, parents and the student themselves can read students"
ON public.school_students FOR SELECT
TO authenticated
USING (
  is_staff()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_students.id
  )
  OR school_students.id = public.own_student_id()
);

DROP POLICY IF EXISTS "Staff and parents can read attendance" ON public.school_attendance;
CREATE POLICY "Staff, parents and the student themselves can read attendance"
ON public.school_attendance FOR SELECT
TO authenticated
USING (
  is_staff()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid() AND psl.student_id = school_attendance.student_id
  )
  OR school_attendance.student_id = public.own_student_id()
);

DROP POLICY IF EXISTS "Staff can read dmc records" ON public.school_dmc_records;
CREATE POLICY "Staff and the student themselves can read dmc records"
ON public.school_dmc_records FOR SELECT
TO authenticated
USING (is_staff() OR school_dmc_records.student_id = public.own_student_id());

-- ---------------------------------------------------------------------------
-- 4. Keep the login status in step with the student's status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_student_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      UPDATE public.user_profiles
         SET status = 'active'
       WHERE student_id = NEW.id
         AND role = 'student'
         AND status <> 'active';
    ELSE
      UPDATE public.user_profiles
         SET status = 'suspended'
       WHERE student_id = NEW.id
         AND role = 'student'
         AND status <> 'suspended';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS school_students_account_status ON public.school_students;
CREATE TRIGGER school_students_account_status
AFTER UPDATE OF status ON public.school_students
FOR EACH ROW EXECUTE FUNCTION public.sync_student_account_status();

-- ---------------------------------------------------------------------------
-- 5. Password reset requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_password_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  CONSTRAINT school_password_requests_status_check CHECK (status IN ('pending', 'resolved'))
);

ALTER TABLE public.school_password_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_password_requests FROM anon, authenticated;
GRANT INSERT ON public.school_password_requests TO anon, authenticated;
GRANT SELECT ON public.school_password_requests TO authenticated;
GRANT UPDATE (status, resolved_at, resolved_by) ON public.school_password_requests TO authenticated;

DROP POLICY IF EXISTS "Anyone can ask for a password reset" ON public.school_password_requests;
CREATE POLICY "Anyone can ask for a password reset"
ON public.school_password_requests FOR INSERT
TO anon, authenticated
WITH CHECK (
  status = 'pending'
  AND resolved_at IS NULL
  AND resolved_by IS NULL
  AND length(btrim(username)) BETWEEN 1 AND 80
);

DROP POLICY IF EXISTS "Staff can read password requests" ON public.school_password_requests;
CREATE POLICY "Staff can read password requests"
ON public.school_password_requests FOR SELECT
TO authenticated
USING (is_staff());

DROP POLICY IF EXISTS "Admins can resolve password requests" ON public.school_password_requests;
CREATE POLICY "Admins can resolve password requests"
ON public.school_password_requests FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());
