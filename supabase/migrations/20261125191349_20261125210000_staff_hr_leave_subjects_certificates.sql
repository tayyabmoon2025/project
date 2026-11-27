/*
# Staff HR: leave management, subject assignments and issued certificates

## 1. Purpose
The Staff Management screen is gaining three new sections next to the existing
staff directory, attendance register and payroll tabs:

- **Leave Management** — a staff member's leave request, from applied to approved
  or rejected, with the deciding administrator and their note kept on the record.
- **Class & Subjects** — which subjects each staff member teaches, in which class
  and section, and how many periods a week. This is the staffing counterpart of the
  class/section setup that already lives in System Setup.
- **Issue Certificate** — an experience, salary, employment or character certificate
  issued to a staff member, with a reference number, date and purpose so the same
  certificate can be reprinted later.

Nothing in this migration changes, moves or deletes existing data. The staff
directory, daily attendance register and all four payroll tables are untouched.

## 2. New tables

### `school_staff_leave_requests`
One row per leave request.
- `id` uuid primary key
- `staff_user_id` uuid not null, references `user_profiles(id)` — cascades if the
  account is ever removed
- `leave_type` text not null default `casual` — one of `casual`, `sick`, `annual`,
  `unpaid`, `maternity`, `other`
- `start_date`, `end_date` date not null, with a check that the end is not before
  the start
- `reason` text (optional)
- `status` text not null default `pending` — one of `pending`, `approved`,
  `rejected`, `cancelled`
- `applied_at` timestamptz default now()
- `decided_by` uuid, `decided_at` timestamptz, `decision_note` text — filled in
  when an administrator approves or rejects
- `created_at` timestamptz default now()

Indexes on `staff_user_id`, `status` and `start_date` for the list screens.

### `school_staff_subject_assignments`
One row per subject a staff member teaches.
- `id` uuid primary key
- `staff_user_id` uuid not null, references `user_profiles(id)`
- `class_name` text not null, `section_name` text (optional)
- `subject_name` text not null
- `weekly_periods` integer not null default 0 — how many periods a week
- `created_at` timestamptz default now()

Index on `staff_user_id`.

### `school_staff_certificates`
One row per certificate issued to a staff member.
- `id` uuid primary key
- `staff_user_id` uuid not null, references `user_profiles(id)`
- `certificate_type` text not null default `experience` — one of `experience`,
  `salary`, `employment`, `no_objection`, `character`, `other`
- `purpose` text (optional) — e.g. "bank account opening"
- `reference_no` text (optional)
- `issued_on` date not null default CURRENT_DATE
- `remarks` text (optional)
- `issued_by` uuid — the administrator who issued it
- `created_at` timestamptz default now()

Index on `staff_user_id`.

## 3. Security

- Row level security is enabled on all three tables.
- Read access is deliberately narrow: an administrator (through the existing
  `can_manage_users()` helper) can read everything, and a staff member can read
  only their own rows through `staff_user_id = auth.uid()`. Nobody else — not
  parents, not students, not other staff — can read another person's leave,
  subjects or certificates.
- **No write grants are given to any role.** Every change goes through one of the
  SECURITY DEFINER functions below, each of which re-checks `can_manage_users()`
  before touching a row. This means a signed-in user cannot insert or edit these
  records directly through the API, whatever they send.
- All functions are revoked from `PUBLIC` and `anon` and granted only to
  `authenticated`, matching the pattern already used by the payroll functions.

## 4. New functions
- `admin_save_staff_leave(...)` — create or update a leave request
- `admin_set_staff_leave_status(uuid, text, text)` — approve or reject
- `admin_delete_staff_leave(uuid)` — remove a request
- `admin_save_staff_subject(...)` — create or update a subject assignment
- `admin_delete_staff_subject(uuid)` — remove an assignment
- `admin_issue_staff_certificate(...)` — record an issued certificate and return
  it together with the staff member's name, role and username so it can be printed
  or re-printed from the history list
- `admin_delete_staff_certificate(uuid)` — remove a certificate record

## 5. Notes
- Safe to re-run: tables use `IF NOT EXISTS`, policies are dropped before being
  created, and functions use `CREATE OR REPLACE`.
- No existing table, column, row or policy is modified by this migration.
*/

-- ---------------------------------------------------------------------------
-- Leave management
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_staff_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  leave_type text NOT NULL DEFAULT 'casual'
    CHECK (leave_type IN ('casual', 'sick', 'annual', 'unpaid', 'maternity', 'other')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_staff_leave_range_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS school_staff_leave_requests_staff_idx
  ON public.school_staff_leave_requests (staff_user_id);
CREATE INDEX IF NOT EXISTS school_staff_leave_requests_status_idx
  ON public.school_staff_leave_requests (status);
CREATE INDEX IF NOT EXISTS school_staff_leave_requests_start_idx
  ON public.school_staff_leave_requests (start_date DESC);

ALTER TABLE public.school_staff_leave_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_staff_leave_requests TO authenticated;

DROP POLICY IF EXISTS "Admins and owners can read leave requests" ON public.school_staff_leave_requests;
CREATE POLICY "Admins and owners can read leave requests"
ON public.school_staff_leave_requests FOR SELECT
TO authenticated
USING (public.can_manage_users() OR staff_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Class & subject assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_staff_subject_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  section_name text,
  subject_name text NOT NULL,
  weekly_periods integer NOT NULL DEFAULT 0 CHECK (weekly_periods >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_staff_subject_assignments_staff_idx
  ON public.school_staff_subject_assignments (staff_user_id);
CREATE INDEX IF NOT EXISTS school_staff_subject_assignments_class_idx
  ON public.school_staff_subject_assignments (class_name, section_name);

ALTER TABLE public.school_staff_subject_assignments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_staff_subject_assignments TO authenticated;

DROP POLICY IF EXISTS "Admins and owners can read subject assignments" ON public.school_staff_subject_assignments;
CREATE POLICY "Admins and owners can read subject assignments"
ON public.school_staff_subject_assignments FOR SELECT
TO authenticated
USING (public.can_manage_users() OR staff_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Issued certificates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_staff_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  certificate_type text NOT NULL DEFAULT 'experience'
    CHECK (certificate_type IN ('experience', 'salary', 'employment', 'no_objection', 'character', 'other')),
  purpose text,
  reference_no text,
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  remarks text,
  issued_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_staff_certificates_staff_idx
  ON public.school_staff_certificates (staff_user_id);
CREATE INDEX IF NOT EXISTS school_staff_certificates_issued_idx
  ON public.school_staff_certificates (issued_on DESC);

ALTER TABLE public.school_staff_certificates ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_staff_certificates TO authenticated;

DROP POLICY IF EXISTS "Admins and owners can read staff certificates" ON public.school_staff_certificates;
CREATE POLICY "Admins and owners can read staff certificates"
ON public.school_staff_certificates FOR SELECT
TO authenticated
USING (public.can_manage_users() OR staff_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Leave functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_staff_leave(
  p_id uuid,
  p_staff_user_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.school_staff_leave_requests;
  v_type text := coalesce(nullif(btrim(p_leave_type), ''), 'casual');
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can record staff leave';
  END IF;
  IF p_staff_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_staff_user_id) THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Enter both the from and to dates';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The to date cannot be before the from date';
  END IF;
  IF v_type NOT IN ('casual', 'sick', 'annual', 'unpaid', 'maternity', 'other') THEN
    RAISE EXCEPTION 'Choose a valid leave type';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.school_staff_leave_requests
      (staff_user_id, leave_type, start_date, end_date, reason)
    VALUES
      (p_staff_user_id, v_type, p_start_date, p_end_date, nullif(btrim(coalesce(p_reason, '')), ''))
    RETURNING * INTO v_row;
  ELSE
    -- Editing a request sends it back for approval, so an approval never silently
    -- covers dates the administrator did not actually agree to.
    UPDATE public.school_staff_leave_requests
       SET staff_user_id = p_staff_user_id,
           leave_type = v_type,
           start_date = p_start_date,
           end_date = p_end_date,
           reason = nullif(btrim(coalesce(p_reason, '')), ''),
           status = 'pending',
           decided_by = NULL,
           decided_at = NULL,
           decision_note = NULL
     WHERE id = p_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'That leave request could not be found';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_leave_status(
  p_id uuid,
  p_status text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.school_staff_leave_requests;
  v_status text := btrim(coalesce(p_status, ''));
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can approve staff leave';
  END IF;
  IF v_status NOT IN ('pending', 'approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Choose a valid leave decision';
  END IF;

  UPDATE public.school_staff_leave_requests
     SET status = v_status,
         decided_by = CASE WHEN v_status = 'pending' THEN NULL ELSE auth.uid() END,
         decided_at = CASE WHEN v_status = 'pending' THEN NULL ELSE now() END,
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'That leave request could not be found';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_staff_leave(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove staff leave';
  END IF;

  DELETE FROM public.school_staff_leave_requests WHERE id = p_id RETURNING id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'That leave request could not be found';
  END IF;

  RETURN jsonb_build_object('id', v_deleted);
END;
$$;

-- ---------------------------------------------------------------------------
-- Subject assignment functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_staff_subject(
  p_id uuid,
  p_staff_user_id uuid,
  p_class_name text,
  p_section_name text,
  p_subject_name text,
  p_weekly_periods integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.school_staff_subject_assignments;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change subject assignments';
  END IF;
  IF p_staff_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_staff_user_id) THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;
  IF btrim(coalesce(p_class_name, '')) = '' THEN
    RAISE EXCEPTION 'Choose the class';
  END IF;
  IF btrim(coalesce(p_subject_name, '')) = '' THEN
    RAISE EXCEPTION 'Enter the subject';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.school_staff_subject_assignments
      (staff_user_id, class_name, section_name, subject_name, weekly_periods)
    VALUES
      (p_staff_user_id, btrim(p_class_name), nullif(btrim(coalesce(p_section_name, '')), ''),
       btrim(p_subject_name), greatest(coalesce(p_weekly_periods, 0), 0))
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.school_staff_subject_assignments
       SET staff_user_id = p_staff_user_id,
           class_name = btrim(p_class_name),
           section_name = nullif(btrim(coalesce(p_section_name, '')), ''),
           subject_name = btrim(p_subject_name),
           weekly_periods = greatest(coalesce(p_weekly_periods, 0), 0)
     WHERE id = p_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'That subject assignment could not be found';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_staff_subject(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove subject assignments';
  END IF;

  DELETE FROM public.school_staff_subject_assignments WHERE id = p_id RETURNING id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'That subject assignment could not be found';
  END IF;

  RETURN jsonb_build_object('id', v_deleted);
END;
$$;

-- ---------------------------------------------------------------------------
-- Certificate functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_issue_staff_certificate(
  p_staff_user_id uuid,
  p_certificate_type text,
  p_purpose text,
  p_reference_no text,
  p_issued_on date,
  p_remarks text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.school_staff_certificates;
  v_type text := coalesce(nullif(btrim(p_certificate_type), ''), 'experience');
  v_person public.user_profiles;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can issue staff certificates';
  END IF;

  SELECT * INTO v_person FROM public.user_profiles WHERE id = p_staff_user_id;
  IF v_person.id IS NULL THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;
  IF v_type NOT IN ('experience', 'salary', 'employment', 'no_objection', 'character', 'other') THEN
    RAISE EXCEPTION 'Choose a valid certificate type';
  END IF;

  INSERT INTO public.school_staff_certificates
    (staff_user_id, certificate_type, purpose, reference_no, issued_on, remarks, issued_by)
  VALUES
    (p_staff_user_id, v_type, nullif(btrim(coalesce(p_purpose, '')), ''),
     nullif(btrim(coalesce(p_reference_no, '')), ''), coalesce(p_issued_on, CURRENT_DATE),
     nullif(btrim(coalesce(p_remarks, '')), ''), auth.uid())
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row)
    || jsonb_build_object(
         'staff_name', v_person.full_name,
         'staff_role', v_person.role,
         'staff_username', v_person.username,
         'mobile_number', v_person.mobile_number
       );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_staff_certificate(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove staff certificates';
  END IF;

  DELETE FROM public.school_staff_certificates WHERE id = p_id RETURNING id INTO v_deleted;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'That certificate could not be found';
  END IF;

  RETURN jsonb_build_object('id', v_deleted);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: functions are callable by signed-in users only, never anonymously.
-- The internal administrator check inside each function is what actually
-- authorises the change.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_save_staff_leave(uuid, uuid, text, date, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_staff_leave_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_staff_leave(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_staff_subject(uuid, uuid, text, text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_staff_subject(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_issue_staff_certificate(uuid, text, text, text, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_staff_certificate(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_save_staff_leave(uuid, uuid, text, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_leave_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_leave(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_staff_subject(uuid, uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_subject(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_issue_staff_certificate(uuid, text, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_certificate(uuid) TO authenticated;
