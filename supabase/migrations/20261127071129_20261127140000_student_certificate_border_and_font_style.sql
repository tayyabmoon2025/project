/*
# Student certificates: border templates and font styles

1. Plain-English summary
   The school office can now choose how an issued student certificate looks. Two new
   choices are stored with each certificate: the printed border template and the printed
   font style. The choice is saved at the moment the certificate is issued, so a
   certificate reprinted months later comes out looking exactly as it did on the day it
   was released.

2. New columns on `public.school_student_certificates`
   - `border_style` (text, not null, default `classic_gold_navy`)
     One of `classic_gold_navy`, `official_slate`, `royal_emerald`,
     `modern_geometric`, `plain`. The decorative frame drawn around the certificate.
   - `font_style` (text, not null, default `classic_serif`)
     One of `classic_serif`, `elegant_playfair`, `modern_sans`, `formal_garamond`.
     The typography used for the wording on the certificate.
   Both columns carry a CHECK constraint listing the allowed values, so a bad value can
   never be written even by a direct call.

3. Changed function
   - `admin_issue_student_certificate` gained two trailing arguments:
     `p_border_style` and `p_font_style`. Both are optional and default to the two
     defaults above. The function validates them against the same allow-list and silently
     falls back to the default when an unknown value arrives, so a stale browser tab
     cannot store a border the printer does not know.
   The old 8-argument signature is dropped first, so there is only ever one version of
   the function and no ambiguous overload.

4. Security
   - No change to the access model. The table still grants SELECT only to
     `authenticated`; every write still goes through the SECURITY DEFINER function that
     checks `can_manage_users()`.
   - The single SELECT policy is unchanged, so a certificate that is still pending
     approval remains invisible to the parent, student, teacher and accountant portals.
   - The recreated function keeps `SET search_path TO 'public'`, has EXECUTE revoked from
     PUBLIC and anon, and granted to authenticated only.

5. Notes
   - Existing rows are untouched: both columns take their default, which reproduces the
     current appearance of every certificate already in the register.
*/

ALTER TABLE public.school_student_certificates
  ADD COLUMN IF NOT EXISTS border_style text NOT NULL DEFAULT 'classic_gold_navy';

ALTER TABLE public.school_student_certificates
  ADD COLUMN IF NOT EXISTS font_style text NOT NULL DEFAULT 'classic_serif';

ALTER TABLE public.school_student_certificates
  DROP CONSTRAINT IF EXISTS school_student_certificates_border_style_check;

ALTER TABLE public.school_student_certificates
  ADD CONSTRAINT school_student_certificates_border_style_check
  CHECK (border_style IN ('classic_gold_navy', 'official_slate', 'royal_emerald', 'modern_geometric', 'plain'));

ALTER TABLE public.school_student_certificates
  DROP CONSTRAINT IF EXISTS school_student_certificates_font_style_check;

ALTER TABLE public.school_student_certificates
  ADD CONSTRAINT school_student_certificates_font_style_check
  CHECK (font_style IN ('classic_serif', 'elegant_playfair', 'modern_sans', 'formal_garamond'));

DROP FUNCTION IF EXISTS public.admin_issue_student_certificate(uuid, text, text, text, text, text, date, text);

CREATE OR REPLACE FUNCTION public.admin_issue_student_certificate(
  p_student_id uuid,
  p_certificate_type text,
  p_title text,
  p_body text,
  p_slc_serial_number text DEFAULT NULL,
  p_certificate_number text DEFAULT NULL,
  p_issued_on date DEFAULT NULL,
  p_approval_status text DEFAULT 'pending',
  p_border_style text DEFAULT 'classic_gold_navy',
  p_font_style text DEFAULT 'classic_serif'
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
  v_border text := nullif(btrim(coalesce(p_border_style, '')), '');
  v_font text := nullif(btrim(coalesce(p_font_style, '')), '');
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

  -- An unknown border or font from a stale screen falls back to the default rather than
  -- failing the save: the wording is the important part, the frame is decoration.
  IF v_border IS NULL OR v_border NOT IN (
    'classic_gold_navy', 'official_slate', 'royal_emerald', 'modern_geometric', 'plain'
  ) THEN
    v_border := 'classic_gold_navy';
  END IF;

  IF v_font IS NULL OR v_font NOT IN (
    'classic_serif', 'elegant_playfair', 'modern_sans', 'formal_garamond'
  ) THEN
    v_font := 'classic_serif';
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
     issued_on, approval_status, approved_by, approved_at, issued_by,
     border_style, font_style)
  VALUES
    (p_student_id, v_type, v_number, v_serial, btrim(p_title), btrim(p_body),
     v_issued_on, v_status,
     CASE WHEN v_status = 'approved' THEN auth.uid() END,
     CASE WHEN v_status = 'approved' THEN now() END,
     auth.uid(),
     v_border, v_font)
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

REVOKE ALL ON FUNCTION public.admin_issue_student_certificate(uuid, text, text, text, text, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_student_certificate(uuid, text, text, text, text, text, date, text, text, text) TO authenticated;
