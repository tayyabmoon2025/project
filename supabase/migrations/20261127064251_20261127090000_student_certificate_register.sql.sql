/*
# Student certificate register — sequential numbering, administrator release, portal lock

## 1. What this migration does

Adds the record-keeping behind the new "Issue Certificate" module for students. A
certificate is written into its own register with a permanent number, and it stays
invisible to families until an administrator releases it.

## 2. New table — `public.school_student_certificates`

One row per certificate ever issued to a student. Nothing here is derived at print time:
the wording is stored exactly as it was issued, so a certificate can be reprinted years
later and read the same.

- `id` (uuid, primary key)
- `student_id` (uuid, not null) — the student the certificate belongs to. Deleting a
  student removes their certificates, matching how the rest of their history is treated.
- `certificate_type` (text, not null) — which of the fourteen certificate kinds this is.
  A check constraint lists the allowed values.
- `certificate_number` (text) — the printed number, e.g. `TUS-SLC-2026-001`. Unique, so
  two certificates can never carry the same number. Rows saved without a number are
  allowed (Postgres permits several nulls in a unique index).
- `slc_serial_number` (text) — the serial number written in the body of a School Leaving
  Certificate, kept separately from the printed register number.
- `title` (text, not null) — the heading printed across the middle of the certificate.
- `body` (text, not null) — the full wording as printed.
- `issued_on` (date, not null, defaults to today)
- `approval_status` (text, not null, default `pending`) — either `pending` or `approved`.
  Everything starts pending unless an administrator explicitly releases it.
- `approved_by` (uuid), `approved_at` (timestamptz) — who released it and when.
- `issued_by` (uuid, defaults to the signed-in user), `created_at` (timestamptz)

Indexes are added on `student_id` and `issued_on`, plus the unique index on
`certificate_number`.

## 3. New function — `public.next_student_certificate_number(p_certificate_type, p_year)`

Returns the next unused number for the given kind of certificate and year, so the office
can see the number on the form before saving. The prefix follows the kind:

- School Leaving / Transfer Certificate → `TUS-SLC-<year>-<nnn>`
- Birth / Date of Birth Certificate → `TUS-DOB-<year>-<nnn>`
- every other certificate → `TUS-CERT-<year>-<nnn>`

## 4. New function — `public.admin_issue_student_certificate(...)`

Writes one certificate into the register and returns it with the student's name,
admission number, class and section attached, so the screen can print without a second
lookup.

- Only an administrator may call it.
- The certificate kind is validated and the wording may not be blank.
- The approval status is decided here, not on the screen: a request to release is honoured
  only when the caller is an administrator, otherwise the certificate is stored as
  `pending`. A certificate can therefore never be born approved by a non-administrator.
- When no number is supplied the function allocates the next one itself under an advisory
  lock, so two certificates issued at the same moment are numbered one after the other
  instead of both taking the same number.
- When a School Leaving Certificate is issued with a serial number and the student has
  none recorded yet, the student's `slc_serial_number` is filled in from it, so the
  student's own profile and the printed certificate agree.

## 5. New function — `public.admin_decide_student_certificate(p_id, p_decision)`

The Approve / Hold control. `approve` sets the certificate to `approved` and records who
released it and when; `hold` puts it back to `pending` and clears the approval. Only an
administrator may call it.

## 6. New function — `public.admin_delete_student_certificate(p_id)`

Removes one certificate from the register. Administrator only. This is a deliberate,
single-row removal performed from the register screen — no other data is touched.

## 7. Security

- Row level security is enabled on the new table.
- `authenticated` is granted SELECT only. There is no INSERT, UPDATE or DELETE privilege
  for any browser role: every write goes through one of the administrator-checked
  functions above, which run as the table owner. This is the strictest arrangement and
  means a mistake in a policy cannot open a write path.
- The read policy is the portal lock. An administrator sees every certificate. Everyone
  else sees only certificates whose status is `approved`, and:
  - school staff see the released register,
  - a parent sees the released certificates of the children linked to their account,
  - a student sees their own released certificates.
  A certificate awaiting approval is therefore invisible to parents, students, teachers
  and the accountant, and no download or print link can reach it.
- All four functions are `SECURITY DEFINER` with a fixed `search_path`. Postgres grants
  EXECUTE on a new function to PUBLIC, so EXECUTE is revoked from PUBLIC and anon and
  granted to authenticated only; each function then checks the caller's role itself.

## 8. Notes

- Safe to re-run: every statement is guarded with `IF NOT EXISTS`, `DROP ... IF EXISTS` or
  `CREATE OR REPLACE`.
- No existing table, column or row is dropped or rewritten.
- No row is inserted by this migration.
*/

CREATE TABLE IF NOT EXISTS public.school_student_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.school_students(id) ON DELETE CASCADE,
  certificate_type text NOT NULL,
  certificate_number text,
  slc_serial_number text,
  title text NOT NULL,
  body text NOT NULL,
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  approval_status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  issued_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_student_certificates
  DROP CONSTRAINT IF EXISTS school_student_certificates_certificate_type_check;

ALTER TABLE public.school_student_certificates
  ADD CONSTRAINT school_student_certificates_certificate_type_check
  CHECK (certificate_type = ANY (ARRAY[
    'school_leaving', 'transfer', 'birth_dob', 'character', 'bonafide',
    'fee_clearance', 'attempt', 'hope', 'provisional',
    'position_holder', 'merit', 'achievement', 'sports', 'cocurricular',
    'full_attendance'
  ]));

ALTER TABLE public.school_student_certificates
  DROP CONSTRAINT IF EXISTS school_student_certificates_approval_status_check;

ALTER TABLE public.school_student_certificates
  ADD CONSTRAINT school_student_certificates_approval_status_check
  CHECK (approval_status IN ('pending', 'approved'));

CREATE INDEX IF NOT EXISTS school_student_certificates_student_idx
  ON public.school_student_certificates (student_id);

CREATE INDEX IF NOT EXISTS school_student_certificates_issued_idx
  ON public.school_student_certificates (issued_on DESC);

CREATE UNIQUE INDEX IF NOT EXISTS school_student_certificates_number_key
  ON public.school_student_certificates (certificate_number);

ALTER TABLE public.school_student_certificates ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.school_student_certificates FROM authenticated, anon;
GRANT SELECT ON public.school_student_certificates TO authenticated;

DROP POLICY IF EXISTS "Staff and families can read released certificates" ON public.school_student_certificates;
CREATE POLICY "Staff and families can read released certificates"
ON public.school_student_certificates FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR (
    approval_status = 'approved'
    AND (
      public.is_staff()
      OR EXISTS (
        SELECT 1 FROM public.parent_student_links psl
        WHERE psl.parent_user_id = auth.uid()
          AND psl.student_id = school_student_certificates.student_id
      )
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.student_id = school_student_certificates.student_id
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.next_student_certificate_number(
  p_certificate_type text,
  p_year int DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_year int := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_prefix text;
  v_next int;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can issue student certificates';
  END IF;

  v_prefix := CASE
    WHEN p_certificate_type IN ('school_leaving', 'transfer') THEN 'TUS-SLC-' || v_year::text || '-'
    WHEN p_certificate_type = 'birth_dob' THEN 'TUS-DOB-' || v_year::text || '-'
    ELSE 'TUS-CERT-' || v_year::text || '-'
  END;

  SELECT COALESCE(MAX((regexp_match(certificate_number, '([0-9]+)$'))[1]::int), 0) + 1
    INTO v_next
  FROM public.school_student_certificates
  WHERE certificate_number ~ ('^' || v_prefix || '[0-9]+$');

  RETURN v_prefix || lpad(v_next::text, 3, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_issue_student_certificate(
  p_student_id uuid,
  p_certificate_type text,
  p_title text,
  p_body text,
  p_slc_serial_number text DEFAULT NULL,
  p_certificate_number text DEFAULT NULL,
  p_issued_on date DEFAULT NULL,
  p_approval_status text DEFAULT 'pending'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.school_student_certificates;
  v_student public.school_students;
  v_type text := coalesce(nullif(btrim(p_certificate_type), ''), 'bonafide');
  v_issued_on date := coalesce(p_issued_on, CURRENT_DATE);
  v_number text := nullif(btrim(coalesce(p_certificate_number, '')), '');
  v_serial text := nullif(btrim(coalesce(p_slc_serial_number, '')), '');
  v_status text;
  v_prefix text;
  v_next int;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can issue student certificates';
  END IF;

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'That student could not be found';
  END IF;

  IF v_type NOT IN (
    'school_leaving', 'transfer', 'birth_dob', 'character', 'bonafide',
    'fee_clearance', 'attempt', 'hope', 'provisional',
    'position_holder', 'merit', 'achievement', 'sports', 'cocurricular',
    'full_attendance'
  ) THEN
    RAISE EXCEPTION 'Choose a valid certificate type';
  END IF;

  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'The certificate wording cannot be empty';
  END IF;

  -- A certificate is only ever released by an administrator, and this is where that is
  -- enforced: a release requested by anybody else is quietly stored as pending.
  v_status := CASE
    WHEN lower(btrim(coalesce(p_approval_status, 'pending'))) = 'approved'
      AND public.is_admin() THEN 'approved'
    ELSE 'pending'
  END;

  IF v_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('school_student_certificate_number'));
    v_prefix := CASE
      WHEN v_type IN ('school_leaving', 'transfer') THEN 'TUS-SLC-' || EXTRACT(YEAR FROM v_issued_on)::int::text || '-'
      WHEN v_type = 'birth_dob' THEN 'TUS-DOB-' || EXTRACT(YEAR FROM v_issued_on)::int::text || '-'
      ELSE 'TUS-CERT-' || EXTRACT(YEAR FROM v_issued_on)::int::text || '-'
    END;
    SELECT COALESCE(MAX((regexp_match(certificate_number, '([0-9]+)$'))[1]::int), 0) + 1
      INTO v_next
    FROM public.school_student_certificates
    WHERE certificate_number ~ ('^' || v_prefix || '[0-9]+$');
    v_number := v_prefix || lpad(v_next::text, 3, '0');
  END IF;

  INSERT INTO public.school_student_certificates
    (student_id, certificate_type, certificate_number, slc_serial_number, title, body,
     issued_on, approval_status, approved_by, approved_at, issued_by)
  VALUES
    (p_student_id, v_type, v_number, v_serial, btrim(p_title), btrim(p_body),
     v_issued_on, v_status,
     CASE WHEN v_status = 'approved' THEN auth.uid() END,
     CASE WHEN v_status = 'approved' THEN now() END,
     auth.uid())
  RETURNING * INTO v_row;

  -- The serial number written on a leaving certificate becomes the student's own serial
  -- number when they do not have one yet, so the profile and the certificate agree.
  IF v_serial IS NOT NULL
     AND v_type IN ('school_leaving', 'transfer')
     AND nullif(btrim(coalesce(v_student.slc_serial_number, '')), '') IS NULL THEN
    UPDATE public.school_students
      SET slc_serial_number = v_serial
      WHERE id = p_student_id;
  END IF;

  RETURN to_jsonb(v_row)
  || jsonb_build_object(
    'student_name', v_student.full_name,
    'admission_number', v_student.admission_number,
    'class_name', v_student.class_name,
    'section_name', v_student.section_name
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decide_student_certificate(
  p_id uuid,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.school_student_certificates;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can approve or hold a student certificate';
  END IF;

  IF v_decision NOT IN ('approve', 'hold') THEN
    RAISE EXCEPTION 'Choose either approve or hold';
  END IF;

  UPDATE public.school_student_certificates
    SET approval_status = CASE WHEN v_decision = 'approve' THEN 'approved' ELSE 'pending' END,
        approved_by = CASE WHEN v_decision = 'approve' THEN auth.uid() END,
        approved_at = CASE WHEN v_decision = 'approve' THEN now() END
    WHERE id = p_id
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'That certificate could not be found';
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_student_certificate(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted uuid;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can remove a student certificate';
  END IF;

  DELETE FROM public.school_student_certificates WHERE id = p_id RETURNING id INTO v_deleted;

  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'That certificate could not be found';
  END IF;

  RETURN jsonb_build_object('id', v_deleted);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.next_student_certificate_number(text, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_issue_student_certificate(uuid, text, text, text, text, text, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_decide_student_certificate(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_student_certificate(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.next_student_certificate_number(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_issue_student_certificate(uuid, text, text, text, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_student_certificate(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_student_certificate(uuid) TO authenticated;
