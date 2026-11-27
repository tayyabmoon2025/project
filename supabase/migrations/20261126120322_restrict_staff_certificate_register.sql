/*
# Staff certificate register — administrators only, least privilege

## 1. What this migration does

Tightens who can reach the staff certificate register, so a certificate (which carries a
staff member's salary, CNIC and service history) is readable and removable only by an
administrator.

## 2. Policies changed on `school_staff_certificates`

- The existing SELECT policy allowed an administrator OR the staff member themselves. It is
  replaced with an administrator-only SELECT policy. Nothing in the app shows a staff
  member their own certificates, so no screen loses access — the certificate is handed over
  as a printed or WhatsApp copy instead.

- A DELETE policy limited to administrators is added, matching the admin-only delete the
  issuing screen performs.

- INSERT and UPDATE policies are left exactly as they are (administrator only). In practice
  inserts happen through the administrator-checked `admin_issue_staff_certificate`
  function, not through the Data API.

## 3. Privileges tightened

`authenticated` had every table privilege (INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER)
as well as SELECT and DELETE. Only SELECT and DELETE are used by the app, so the rest are
revoked. The issuing function runs as the table owner and is unaffected.

This is defence in depth: a missing policy already blocks those verbs, and this removes the
privilege as well, so a future policy mistake cannot open a write path that was never
intended.

## 4. Notes

- Safe to re-run: policies are dropped before being recreated, and the revoke is a no-op if
  the privilege has already been removed.
- No data is read, written or deleted by this migration.
*/

DROP POLICY IF EXISTS "Admins and owners can read staff certificates" ON public.school_staff_certificates;
DROP POLICY IF EXISTS "Administrators can read staff certificates" ON public.school_staff_certificates;
CREATE POLICY "Administrators can read staff certificates"
ON public.school_staff_certificates FOR SELECT
TO authenticated
USING (public.can_manage_users());

DROP POLICY IF EXISTS "Administrators can remove staff certificates" ON public.school_staff_certificates;
CREATE POLICY "Administrators can remove staff certificates"
ON public.school_staff_certificates FOR DELETE
TO authenticated
USING (public.can_manage_users());

REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.school_staff_certificates FROM authenticated;
GRANT SELECT, DELETE ON public.school_staff_certificates TO authenticated;
