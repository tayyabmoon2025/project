/*
# Staff profile, documents and account management

## Purpose
Upgrades the staff record from a login row into a full personnel record. The office can now
keep a staff member's personal details, job details, documents and portal login in one place,
and every staff member gets a short, permanent Staff ID (`STF-001`) that can be quoted on
paperwork.

## 1. New columns on `public.user_profiles`
- `staff_code` (text) — short permanent Staff ID, e.g. `STF-001`. Unique where present.
- `full_name_urdu` (text) — the name written in Urdu.
- `marital_status` (text) — `unmarried` or `married`.
- `relation_type` (text) — `son`, `daughter` or `wife`.
- `father_name` (text) — father's or husband's name, matching `relation_type`.
- `gender` (text) — `male` or `female`.
- `qualification` (text) — highest qualification.
- `previous_experience` (text) — previous work experience.
- `joining_date` (date) — the day they joined the school.
- `home_address` (text) — home address.
- `leaving_date` (date) — required when the record is not Active.
- `leaving_reason` (text) — required when the record is not Active.

Existing staff rows are given a Staff ID in the migration, numbered in the order they were
created, so nobody is left without one. Parents and students are not given a Staff ID.

## 2. New table `public.school_staff_documents`
One row per uploaded file. A staff member can hold several files of the same kind (for
example three degree certificates), so each upload is its own row.
- `id` (uuid, primary key)
- `staff_user_id` (uuid, references `user_profiles`, deleted with the staff record)
- `doc_type` (text) — `agreement`, `cnic_front`, `cnic_back`, `degree`, `experience`, `other`
- `file_name` (text) — the name the office sees
- `file_path` (text) — where the file sits in private storage
- `file_url` (text) — a long-lived signed link used for view and download
- `file_size` (bigint), `mime_type` (text)
- `uploaded_by` (uuid, references `user_profiles`), `created_at` (timestamptz)

## 3. New role: Support Staff
`support_staff` is added to the allowed staff roles on `user_profiles`, to
`admin_provision_account` and to `is_staff()`, so drivers, guards and helpers can be kept on
the same register as teachers and office staff. They receive the same staff workspace as an
office assistant.

## 4. New functions
- `admin_save_staff_member(p_payload jsonb)` — creates or updates one staff record in a
  single call: account, login, profile fields and status. A new record is created through the
  existing `admin_provision_account`, so account creation rules are not duplicated.
- `admin_save_staff_document(...)` — records one uploaded document.
- `admin_delete_staff_document(p_id uuid)` — removes a document row and returns its storage
  path so the client can tidy up the file.

## 5. Security
- RLS stays on. `school_staff_documents` is readable only by administrators
  (`can_manage_users()`), and has no direct write policy: every write goes through a
  SECURITY DEFINER function.
- The new `user_profiles` columns are granted for SELECT only, so the browser can read them
  but never write them directly.
- Every new function is revoked from `PUBLIC` and `anon`, and granted to `authenticated`
  only. Each one re-checks `can_manage_users()` itself.
- Self-protection rules are enforced in the save function as well as in the status dialog:
  an administrator cannot change their own role or deactivate their own account, and the last
  active administrator cannot be demoted.
- Uploaded files reuse the existing private `whatsapp-attachments` bucket, which already
  restricts reads and writes to the uploader's own folder.

## 6. Notes
- The Staff ID is generated from a sequence (`staff_code_seq`), so numbers are never reused
  and never change once assigned.
- `leaving_date` and `leaving_reason` are cleared automatically when a record is set back to
  Active, so a reactivated staff member does not keep a stale leaving note.
*/

-- ---------------------------------------------------------------- new columns
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS staff_code text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS full_name_urdu text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS marital_status text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS relation_type text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS father_name text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS qualification text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS previous_experience text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS joining_date date;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS home_address text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS leaving_date date;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS leaving_reason text;

-- ------------------------------------------------------- value constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_marital_status_check') THEN
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_marital_status_check
      CHECK (marital_status IS NULL OR marital_status IN ('unmarried', 'married'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_relation_type_check') THEN
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_relation_type_check
      CHECK (relation_type IS NULL OR relation_type IN ('son', 'daughter', 'wife'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_gender_check') THEN
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;
END $$;

-- Support Staff joins the roles a staff account may hold.
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant', 'support_staff', 'student'));

-- ------------------------------------------------------- staff id numbering
CREATE SEQUENCE IF NOT EXISTS public.staff_code_seq;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_staff_code_key
  ON public.user_profiles (staff_code)
  WHERE staff_code IS NOT NULL;

-- Every staff member on record gets a number before the sequence is used, numbered in the
-- order the records were created so the longest-serving staff hold the lowest numbers.
DO $$
DECLARE
  r record;
  v_next bigint;
BEGIN
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(staff_code, '\D', '', 'g'), '')::bigint),
           0
         )
    INTO v_next
  FROM public.user_profiles
  WHERE staff_code IS NOT NULL;

  FOR r IN
    SELECT id
    FROM public.user_profiles
    WHERE staff_code IS NULL
      AND role IN ('admin', 'teacher', 'office_assistant', 'accountant', 'support_staff')
    ORDER BY created_at, full_name
  LOOP
    v_next := v_next + 1;
    UPDATE public.user_profiles
       SET staff_code = 'STF-' || lpad(v_next::text, 3, '0')
     WHERE id = r.id;
  END LOOP;

  PERFORM setval('public.staff_code_seq', GREATEST(v_next, 1), v_next > 0);
END $$;

-- ------------------------------------------------------------- read access
GRANT SELECT (
  staff_code, full_name_urdu, marital_status, relation_type, father_name, gender,
  qualification, previous_experience, joining_date, home_address, leaving_date, leaving_reason
) ON public.user_profiles TO authenticated;

-- -------------------------------------------------------- documents table
CREATE TABLE IF NOT EXISTS public.school_staff_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('agreement', 'cnic_front', 'cnic_back', 'degree', 'experience', 'other')),
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_staff_documents_staff_idx
  ON public.school_staff_documents (staff_user_id, doc_type);

ALTER TABLE public.school_staff_documents ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_staff_documents TO authenticated;

DROP POLICY IF EXISTS "Administrators can read staff documents" ON public.school_staff_documents;
CREATE POLICY "Administrators can read staff documents"
ON public.school_staff_documents FOR SELECT
TO authenticated
USING (public.can_manage_users());

-- --------------------------------------------- support staff is school staff
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM public.user_profiles
  WHERE id = auth.uid()
    AND role IN ('admin', 'teacher', 'office_assistant', 'accountant', 'support_staff')
    AND status = 'active'
);
$function$;

-- -------------------------------------- account creation accepts support staff
CREATE OR REPLACE FUNCTION public.admin_provision_account(
  p_username text,
  p_password text,
  p_full_name text,
  p_role text,
  p_student_id uuid DEFAULT NULL,
  p_mobile text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  new_id uuid := gen_random_uuid();
  clean_username text := lower(btrim(p_username));
  pseudo_email text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  IF p_role NOT IN ('admin', 'teacher', 'parent', 'office_assistant', 'accountant', 'support_staff', 'student') THEN
    RAISE EXCEPTION 'That account type is not allowed';
  END IF;

  IF length(clean_username) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'A full name is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE lower(username) = clean_username) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  IF p_role = 'student' THEN
    IF p_student_id IS NULL THEN
      RAISE EXCEPTION 'A student account must be linked to a student record';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.school_students WHERE id = p_student_id) THEN
      RAISE EXCEPTION 'That student record no longer exists';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE student_id = p_student_id) THEN
      RAISE EXCEPTION 'This student already has a portal login';
    END IF;
  END IF;

  pseudo_email := clean_username || '@schooldesk.local';

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = pseudo_email) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    email_change_confirm_status, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    pseudo_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', p_role),
    jsonb_build_object('sub', new_id::text, 'email', pseudo_email, 'email_verified', true),
    false,
    '', '', '', '', '', '', '', '',
    0, false, false
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    new_id, new_id,
    jsonb_build_object('sub', new_id::text, 'email', pseudo_email, 'email_verified', true),
    'email', new_id::text, now(), now(), now()
  );

  INSERT INTO public.user_profiles (id, username, full_name, role, status, student_id, mobile_number)
  VALUES (new_id, clean_username, btrim(p_full_name), p_role, 'active', p_student_id, nullif(btrim(coalesce(p_mobile, '')), ''));

  RETURN new_id;
END $function$;

-- ------------------------------------------------- create or update a staff member
CREATE OR REPLACE FUNCTION public.admin_save_staff_member(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_is_new boolean := nullif(btrim(coalesce(p_payload->>'user_id', '')), '') IS NULL;
  v_user_id uuid := nullif(btrim(coalesce(p_payload->>'user_id', '')), '')::uuid;
  v_username text := lower(btrim(coalesce(p_payload->>'username', '')));
  v_password text := nullif(p_payload->>'password', '');
  v_full_name text := btrim(coalesce(p_payload->>'full_name', ''));
  v_role text := coalesce(nullif(btrim(coalesce(p_payload->>'role', '')), ''), 'teacher');
  v_mobile text := nullif(btrim(coalesce(p_payload->>'mobile_number', '')), '');
  v_status text := coalesce(nullif(btrim(coalesce(p_payload->>'status', '')), ''), 'active');
  v_cnic text := nullif(regexp_replace(coalesce(p_payload->>'cnic', ''), '\D', '', 'g'), '');
  v_existing_role text;
  v_is_self boolean := false;
  v_staff_code text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can manage staff';
  END IF;

  IF v_role NOT IN ('teacher', 'office_assistant', 'accountant', 'admin', 'support_staff') THEN
    RAISE EXCEPTION 'That staff role is not allowed';
  END IF;

  IF v_status NOT IN ('active', 'suspended', 'inactive', 'left') THEN
    RAISE EXCEPTION 'That staff status is not allowed';
  END IF;

  IF v_full_name = '' THEN
    RAISE EXCEPTION 'A full name is required';
  END IF;

  IF v_cnic IS NOT NULL AND length(v_cnic) <> 13 THEN
    RAISE EXCEPTION 'A CNIC must be exactly 13 digits';
  END IF;

  IF v_mobile IS NOT NULL AND length(regexp_replace(v_mobile, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'A mobile number needs at least 10 digits';
  END IF;

  -- Someone who is not active has to say when they stopped and why, so the record is
  -- never left in an unexplained state.
  IF v_status <> 'active' THEN
    IF nullif(btrim(coalesce(p_payload->>'leaving_date', '')), '') IS NULL THEN
      RAISE EXCEPTION 'A leaving date is required when the staff member is not active';
    END IF;
    IF nullif(btrim(coalesce(p_payload->>'leaving_reason', '')), '') IS NULL THEN
      RAISE EXCEPTION 'A leaving reason is required when the staff member is not active';
    END IF;
  END IF;

  IF v_is_new THEN
    IF v_password IS NULL THEN
      RAISE EXCEPTION 'A password is required for a new staff member';
    END IF;
    IF v_username = '' THEN
      RAISE EXCEPTION 'A username is required';
    END IF;

    -- The account itself is created by the same function the rest of the app uses, so the
    -- rules about usernames, passwords and the pseudo-email are not written out twice.
    v_user_id := public.admin_provision_account(
      p_username => v_username,
      p_password => v_password,
      p_full_name => v_full_name,
      p_role => v_role,
      p_student_id => NULL,
      p_mobile => v_mobile
    );
  ELSE
    SELECT role, (id = auth.uid())
      INTO v_existing_role, v_is_self
      FROM public.user_profiles
     WHERE id = v_user_id;

    IF v_existing_role IS NULL THEN
      RAISE EXCEPTION 'That staff record no longer exists';
    END IF;

    IF v_existing_role IN ('parent', 'student') THEN
      RAISE EXCEPTION 'That account type is not allowed';
    END IF;

    IF v_is_self AND v_role <> v_existing_role THEN
      RAISE EXCEPTION 'You cannot change your own role';
    END IF;

    IF v_is_self AND v_status <> 'active' THEN
      RAISE EXCEPTION 'You cannot change your own account status';
    END IF;

    IF v_existing_role = 'admin' AND v_role <> 'admin'
       AND (SELECT count(*) FROM public.user_profiles WHERE role = 'admin' AND status = 'active') <= 1 THEN
      RAISE EXCEPTION 'The last administrator account cannot be demoted';
    END IF;

    IF v_username <> '' AND v_username <> (SELECT username FROM public.user_profiles WHERE id = v_user_id) THEN
      PERFORM public.admin_reset_username(v_user_id, v_username);
    END IF;

    -- A blank password on an edit leaves the existing one alone; the office sets a new one
    -- only when they mean to. The reset goes through the existing guarded function.
    IF v_password IS NOT NULL THEN
      PERFORM public.admin_set_password(v_user_id, v_password);
    END IF;
  END IF;

  SELECT staff_code INTO v_staff_code FROM public.user_profiles WHERE id = v_user_id;
  IF v_staff_code IS NULL THEN
    v_staff_code := 'STF-' || lpad(nextval('public.staff_code_seq')::text, 3, '0');
  END IF;

  UPDATE public.user_profiles SET
    staff_code = v_staff_code,
    username = CASE WHEN v_username = '' THEN username ELSE v_username END,
    full_name = v_full_name,
    full_name_urdu = nullif(btrim(coalesce(p_payload->>'full_name_urdu', '')), ''),
    role = v_role,
    status = v_status,
    marital_status = nullif(btrim(coalesce(p_payload->>'marital_status', '')), ''),
    relation_type = nullif(btrim(coalesce(p_payload->>'relation_type', '')), ''),
    father_name = nullif(btrim(coalesce(p_payload->>'father_name', '')), ''),
    gender = nullif(btrim(coalesce(p_payload->>'gender', '')), ''),
    date_of_birth = nullif(btrim(coalesce(p_payload->>'date_of_birth', '')), '')::date,
    cnic = v_cnic,
    qualification = nullif(btrim(coalesce(p_payload->>'qualification', '')), ''),
    previous_experience = nullif(btrim(coalesce(p_payload->>'previous_experience', '')), ''),
    joining_date = nullif(btrim(coalesce(p_payload->>'joining_date', '')), '')::date,
    mobile_number = v_mobile,
    home_address = nullif(btrim(coalesce(p_payload->>'home_address', '')), ''),
    photo_url = nullif(btrim(coalesce(p_payload->>'photo_url', '')), ''),
    -- A reactivated staff member does not keep a stale leaving note.
    leaving_date = CASE WHEN v_status = 'active' THEN NULL
                        ELSE nullif(btrim(coalesce(p_payload->>'leaving_date', '')), '')::date END,
    leaving_reason = CASE WHEN v_status = 'active' THEN NULL
                          ELSE nullif(btrim(coalesce(p_payload->>'leaving_reason', '')), '') END
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'staff_code', v_staff_code,
    'username', (SELECT username FROM public.user_profiles WHERE id = v_user_id),
    'full_name', v_full_name,
    'role', v_role,
    'status', v_status,
    'created', v_is_new
  );
END $function$;

-- ---------------------------------------------------------- staff documents
CREATE OR REPLACE FUNCTION public.admin_save_staff_document(
  p_staff_user_id uuid,
  p_doc_type text,
  p_file_name text,
  p_file_path text,
  p_file_url text,
  p_file_size bigint DEFAULT NULL,
  p_mime_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_id uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can add staff documents';
  END IF;

  SELECT role INTO v_role FROM public.user_profiles WHERE id = p_staff_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'That staff record no longer exists';
  END IF;
  IF v_role IN ('parent', 'student') THEN
    RAISE EXCEPTION 'That account type is not allowed';
  END IF;

  IF p_doc_type NOT IN ('agreement', 'cnic_front', 'cnic_back', 'degree', 'experience', 'other') THEN
    RAISE EXCEPTION 'That document type is not allowed';
  END IF;

  IF nullif(btrim(coalesce(p_file_name, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_file_path, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_file_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The uploaded file is missing its details';
  END IF;

  INSERT INTO public.school_staff_documents (
    staff_user_id, doc_type, file_name, file_path, file_url, file_size, mime_type, uploaded_by
  ) VALUES (
    p_staff_user_id, p_doc_type, btrim(p_file_name), btrim(p_file_path), btrim(p_file_url),
    p_file_size, p_mime_type, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'doc_type', p_doc_type, 'file_name', btrim(p_file_name));
END $function$;

CREATE OR REPLACE FUNCTION public.admin_delete_staff_document(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_path text;
  v_name text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove staff documents';
  END IF;

  DELETE FROM public.school_staff_documents
   WHERE id = p_id
  RETURNING file_path, file_name INTO v_path, v_name;

  IF v_path IS NULL THEN
    RAISE EXCEPTION 'That document no longer exists';
  END IF;

  RETURN jsonb_build_object('id', p_id, 'file_path', v_path, 'file_name', v_name);
END $function$;

-- ------------------------------------------------------------------- grants
REVOKE EXECUTE ON FUNCTION public.admin_save_staff_member(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_staff_document(uuid, text, text, text, text, bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_staff_document(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_save_staff_member(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_staff_document(uuid, text, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_document(uuid) TO authenticated;
