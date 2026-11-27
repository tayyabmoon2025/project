/*
# Tighten grants on the finance tables

## 1. Purpose
When a table is created in the public schema, Postgres hands every role a full set of
privileges on it, including TRUNCATE. Row level security already stops an unauthenticated
visitor from reading or changing a single finance row, but TRUNCATE is not a row level
operation — it is decided by the privilege alone. This migration takes the unused
privileges away so the finance tables are reachable only by signed-in staff, through the
data API, using the four verbs the app actually needs.

## 2. Changes
- `anon` loses every privilege on `school_ledger_accounts`, `school_expenses` and
  `school_other_income`. An unauthenticated visitor can no longer reach them at all.
- `authenticated` keeps SELECT, INSERT, UPDATE and DELETE — the four verbs the app uses —
  and loses TRUNCATE, REFERENCES and TRIGGER, which it never needs.
- No table, column, row or policy is changed, and no data is deleted.

## 3. Notes
- Re-running this migration is safe: revoking a privilege that is already absent does
  nothing.
*/

REVOKE ALL ON public.school_ledger_accounts FROM anon;
REVOKE ALL ON public.school_expenses FROM anon;
REVOKE ALL ON public.school_other_income FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.school_ledger_accounts FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.school_expenses FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.school_other_income FROM authenticated;
