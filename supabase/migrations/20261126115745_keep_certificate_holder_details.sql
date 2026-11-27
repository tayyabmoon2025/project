/*
# Staff certificate register — keep the holder's details with the certificate

## 1. What this migration does

An issued certificate must be reprintable years later, and must survive the staff member's
account being removed. This migration copies the holder's details onto the certificate row
and stops a removed account from deleting its certificates.

## 2. Modified table — `school_staff_certificates`

Four NEW COLUMNS, all nullable, filled in automatically by the issuing function:

- `staff_name` (text) — the staff member's full name at the moment of issue.
- `staff_code` (text) — their Staff ID, as printed on the certificate.
- `staff_role` (text) — their role, which becomes the designation on the certificate.
- `staff_photo_url` (text) — their photo, so the letterhead can show a face on a reprint.

Nothing is deleted, renamed or retyped. Rows saved before this migration simply have no
values in the new columns.

## 3. Changed foreign key — `staff_user_id`

- The column becomes nullable and its foreign key changes from `ON DELETE CASCADE` to
  `ON DELETE SET NULL`.

Why: with `ON DELETE CASCADE`, removing a staff account silently deleted every certificate
that had ever been issued to them — a record the school is obliged to keep. With
`ON DELETE SET NULL` the certificate stays, and its own copy of the name, Staff ID, role
and photo keeps it readable and reprintable.

This only relaxes the constraint. Every existing row keeps its value, and every row that
was valid before is still valid.

## 4. Replaced function — `public.admin_issue_staff_certificate(...)`

The parameter list is unchanged. The function now also writes `staff_name`, `staff_code`,
`staff_role` and `staff_photo_url`, read from the staff member's own record at the moment
of issue. It still checks the caller is an administrator, validates the certificate type,
refuses a blank wording, and allocates the next reference number itself under an advisory
lock when none is supplied.

## 5. Security

- Row level security and the existing policies are untouched.
- The function stays `SECURITY DEFINER` with a fixed `search_path`, checks
  `public.can_manage_users()` for itself, and has EXECUTE revoked from PUBLIC and anon and
  granted to authenticated only.

## 6. Notes

- Safe to re-run: columns use `ADD COLUMN IF NOT EXISTS`, the constraint is dropped before
  being re-added, and the function is `CREATE OR REPLACE`.
- No data is removed and no existing value is rewritten.
*/

ALTER TABLE public.school_staff_certificates
  ADD COLUMN IF NOT EXISTS staff_name text;
ALTER TABLE public.school_staff_certificates
  ADD COLUMN IF NOT EXISTS staff_code text;
ALTER TABLE public.school_staff_certificates
  ADD COLUMN IF NOT EXISTS staff_role text;
ALTER TABLE public.school_staff_certificates
  ADD COLUMN IF NOT EXISTS staff_photo_url text;

ALTER TABLE public.school_staff_certificates
  ALTER COLUMN staff_user_id DROP NOT NULL;

ALTER TABLE public.school_staff_certificates
  DROP CONSTRAINT IF EXISTS school_staff_certificates_staff_user_id_fkey;

ALTER TABLE public.school_staff_certificates
  ADD CONSTRAINT school_staff_certificates_staff_user_id_fkey
  FOREIGN KEY (staff_user_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.admin_issue_staff_certificate(
  p_staff_user_id uuid,
  p_certificate_type text,
  p_purpose text,
  p_reference_no text,
  p_issued_on date,
  p_remarks text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.school_staff_certificates;
  v_type text := coalesce(nullif(btrim(p_certificate_type), ''), 'experience');
  v_person public.user_profiles;
  v_issued_on date := coalesce(p_issued_on, CURRENT_DATE);
  v_reference text := nullif(btrim(coalesce(p_reference_no, '')), '');
  v_next int;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can issue staff certificates';
  END IF;

  SELECT * INTO v_person FROM public.user_profiles WHERE id = p_staff_user_id;
  IF v_person.id IS NULL THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;
  IF v_type NOT IN ('experience', 'salary', 'employment', 'character', 'no_objection', 'appreciation', 'other') THEN
    RAISE EXCEPTION 'Choose a valid certificate type';
  END IF;
  IF p_remarks IS NULL OR btrim(p_remarks) = '' THEN
    RAISE EXCEPTION 'The certificate wording cannot be empty';
  END IF;

  -- The reference number is taken here rather than on the screen, so two certificates
  -- issued at the same moment are numbered one after the other. The lock is held until
  -- the transaction ends.
  IF v_reference IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('school_staff_certificate_reference'));
    SELECT COALESCE(MAX((regexp_match(reference_no, '([0-9]+)$'))[1]::int), 0) + 1
      INTO v_next
    FROM public.school_staff_certificates
    WHERE reference_no ~ ('^TUS-CERT-' || EXTRACT(YEAR FROM v_issued_on)::int::text || '-[0-9]+$');
    v_reference := 'TUS-CERT-' || EXTRACT(YEAR FROM v_issued_on)::int::text || '-' || lpad(v_next::text, 3, '0');
  END IF;

  INSERT INTO public.school_staff_certificates
    (staff_user_id, certificate_type, purpose, reference_no, issued_on, body, issued_by,
     staff_name, staff_code, staff_role, staff_photo_url)
  VALUES
    (p_staff_user_id, v_type, nullif(btrim(coalesce(p_purpose, '')), ''),
     v_reference, v_issued_on, btrim(p_remarks), auth.uid(),
     v_person.full_name, v_person.staff_code, v_person.role, v_person.photo_url)
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row)
  || jsonb_build_object(
    'staff_name', v_person.full_name,
    'staff_role', v_person.role,
    'staff_username', v_person.username,
    'mobile_number', v_person.mobile_number
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_issue_staff_certificate(uuid, text, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_staff_certificate(uuid, text, text, text, date, text) TO authenticated;
