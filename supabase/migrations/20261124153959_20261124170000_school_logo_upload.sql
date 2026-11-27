/*
# School logo upload for quiz papers

## 1. Purpose

Teachers and admins need to put the school logo at the top of the quiz papers they
generate. The generated paper is exported two ways — a Word (.docx) download and a
printed sheet — and both read the logo from the school's institution profile, so the
logo only has to be uploaded once and every paper picks it up.

## 2. What changes

### New function: `public.set_institution_logo(p_data_url text)`

The institution profile row (`school_institution_profile`, keyed `id = 'default'`) is
writable only by admins, because it holds school-wide details such as the registration
number. Teachers could therefore never save a logo. Rather than widening that table's
policy for everyone, this function performs the one narrow change a teacher is allowed
to make: it writes the `logo_url` column and nothing else.

It is `SECURITY DEFINER` with `SET search_path = public` (required so a caller cannot
shadow the objects it references), and it authorizes the caller itself by calling
`public.is_staff()` — which accepts admin, teacher, office_assistant and accountant, and
requires the account to be active. Parents and students are rejected.

Validation, all server-side because the browser is untrusted:
- The value must be an empty string, or a base64 data URL of type PNG, JPEG or WebP.
  A value that is not an image is refused, so the column cannot be filled with arbitrary
  text or a link to a third-party image.
- The value is capped at 900,000 characters (roughly 675 KB of image data). The browser
  shrinks the picture before upload; this is the backstop for a hand-made request.
- The row is inserted if it is somehow missing, so the function never fails for a fresh
  database.

It returns the stored value so the caller can render the new logo immediately.

## 3. Security

- `REVOKE EXECUTE ... FROM PUBLIC, anon` then `GRANT EXECUTE ... TO authenticated`, so
  only signed-in accounts can call it, and only staff among them pass the check inside.
- The existing SELECT/INSERT/UPDATE policies on `school_institution_profile` are left
  untouched. Admins can still edit every field through the normal institution profile
  screen; this function adds a path for staff without loosening anything.
- No table, column or policy is dropped or altered, so no existing data is affected.
- The function is idempotent (`CREATE OR REPLACE`) and safe to re-run.

## 4. Notes

1. Nothing else in the profile row can be changed through this function — a caller
   cannot alter the school name, contact details or registration number with it.
2. The stored value is a data URL, so the logo renders in the print sheet with no
   network request and no signed link that could expire.
*/

CREATE OR REPLACE FUNCTION public.set_institution_logo(p_data_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_url := coalesce(btrim(p_data_url), '');

  IF v_url <> '' THEN
    IF v_url !~ '^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$' THEN
      RAISE EXCEPTION 'Upload a PNG, JPEG or WebP image.';
    END IF;

    IF length(v_url) > 900000 THEN
      RAISE EXCEPTION 'That image is too large.';
    END IF;
  END IF;

  UPDATE public.school_institution_profile
  SET logo_url = v_url, updated_at = now()
  WHERE id = 'default';

  IF NOT FOUND THEN
    INSERT INTO public.school_institution_profile (id, logo_url)
    VALUES ('default', v_url);
  END IF;

  RETURN v_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_institution_logo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_institution_logo(text) TO authenticated;
