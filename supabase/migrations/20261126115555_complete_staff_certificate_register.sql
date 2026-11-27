/*
# Staff certificates — wording, Appreciation type and automatic reference numbers

## 1. What this migration does

The certificate register table `school_staff_certificates` already exists. This migration
completes it so the "Issue certificate" screen can print and reprint a certificate exactly
as it was issued.

## 2. Modified table — `school_staff_certificates`

- NEW COLUMN `body` (text, nullable) — the full certificate wording as printed. Stored on
  the record so a certificate can be reprinted years later without rebuilding the text.
  Nothing is deleted and no existing column is changed.

- WIDENED CHECK CONSTRAINT on `certificate_type` — the allowed list now includes
  `appreciation`, so all six kinds of certificate the school issues are accepted:
  `experience`, `employment`, `salary`, `character`, `no_objection`, `appreciation`
  (plus the pre-existing `other`). Widening a CHECK accepts every value that was already
  stored, so no existing row is affected.

- NEW UNIQUE INDEX on `reference_no` — two certificates can never carry the same printed
  number. Postgres allows several rows with no reference number, so rows saved before this
  migration are unaffected.

## 3. New function — `public.next_staff_certificate_reference(p_year int default null)`

Returns the next unused reference number for a year, in the form
`TUS-CERT-<year>-<nnn>` (for example `TUS-CERT-2026-001`). The screen calls this to show
the number before the certificate is saved.

## 4. Replaced function — `public.admin_issue_staff_certificate(...)`

The parameter list is unchanged, so nothing else has to change. Two differences inside:

- The wording passed in the last parameter is written to the new `body` column.
- If no reference number is supplied, the function allocates the next one itself, under an
  advisory lock, so two certificates issued at the same moment are numbered one after the
  other instead of both taking the same number.

The function still checks the caller is an administrator, validates the certificate type
and refuses a blank wording.

## 5. Security

- Row level security stays enabled on `school_staff_certificates`. The existing policies
  are left exactly as they were: an administrator can read, add, change and remove
  certificates, and a staff member can read their own.
- Both functions are `SECURITY DEFINER` with a fixed `search_path` and check
  `public.can_manage_users()` for themselves. Postgres grants EXECUTE on a new function to
  PUBLIC, so EXECUTE is revoked from PUBLIC and anon and granted to authenticated only.

## 6. Notes

- Safe to re-run: every statement is guarded with `IF NOT EXISTS`, `DROP ... IF EXISTS`
  or `CREATE OR REPLACE`.
- No table, column or row is dropped, and no existing data is rewritten.
*/

ALTER TABLE public.school_staff_certificates
  ADD COLUMN IF NOT EXISTS body text;

ALTER TABLE public.school_staff_certificates
  DROP CONSTRAINT IF EXISTS school_staff_certificates_certificate_type_check;

ALTER TABLE public.school_staff_certificates
  ADD CONSTRAINT school_staff_certificates_certificate_type_check
  CHECK (certificate_type = ANY (ARRAY[
    'experience', 'salary', 'employment', 'character', 'no_objection', 'appreciation', 'other'
  ]));

CREATE UNIQUE INDEX IF NOT EXISTS school_staff_certificates_reference_no_key
  ON public.school_staff_certificates (reference_no);

CREATE OR REPLACE FUNCTION public.next_staff_certificate_reference(p_year int DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_year int := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);
  v_prefix text := 'TUS-CERT-' || v_year::text || '-';
  v_next int;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can issue staff certificates';
  END IF;

  SELECT COALESCE(MAX((regexp_match(reference_no, '([0-9]+)$'))[1]::int), 0) + 1
    INTO v_next
  FROM public.school_staff_certificates
  WHERE reference_no ~ ('^' || v_prefix || '[0-9]+$');

  RETURN v_prefix || lpad(v_next::text, 3, '0');
END;
$function$;

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
    (staff_user_id, certificate_type, purpose, reference_no, issued_on, body, issued_by)
  VALUES
    (p_staff_user_id, v_type, nullif(btrim(coalesce(p_purpose, '')), ''),
     v_reference, v_issued_on, btrim(p_remarks), auth.uid())
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

REVOKE EXECUTE ON FUNCTION public.next_staff_certificate_reference(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_staff_certificate_reference(int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_issue_staff_certificate(uuid, text, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_staff_certificate(uuid, text, text, text, date, text) TO authenticated;
