/*
# Student certificate register — remove the leftover anon read privilege

## 1. What this migration does

When the `school_student_certificates` table was created, Supabase's default privileges
handed the `anon` role SELECT on it along with `authenticated`. The table's only read
policy is scoped `TO authenticated`, so `anon` was already returning zero rows — but the
privilege should not be there at all, and neither should it appear on any table created
later. This migration removes it and stops it coming back.

## 2. Changes

- `REVOKE SELECT ON public.school_student_certificates FROM anon` — an unauthenticated
  visitor can no longer reach the certificate register through the Data API at all.
- `ALTER DEFAULT PRIVILEGES ... REVOKE SELECT ON TABLES FROM anon` — the same privilege is
  not granted automatically to `anon` on tables created in future migrations. This is
  scoped to the `public` schema and does not touch any existing grant on any other table.

## 3. What is deliberately left alone

`authenticated` keeps SELECT. The table's read policy still decides which rows each signed
-in role sees: an administrator sees every certificate, and a parent, student or staff
member sees only a certificate whose status is `approved`. No write privilege exists for
any browser role — issuing, releasing and removing all run through the
administrator-checked functions.

## 4. Notes

- Safe to re-run: both statements are idempotent.
- No data is read, written or deleted, and no policy or other table is changed.
*/

REVOKE SELECT ON public.school_student_certificates FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;
