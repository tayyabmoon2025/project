/*
# Lock the fee adjustment audit table to reads only

## 1. Why
Supabase grants `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on every new
table in `public` to `anon` and `authenticated` by default. RLS already blocks those verbs
here, because `school_fee_adjustment_history` has a single SELECT policy and no write
policy. So nothing was reachable — but an audit log is exactly the table that should not
rely on a policy being right, and the previous migration claimed writes were not granted.

This migration makes the grant match the claim.

## 2. The change
- Revoke every write privilege on `public.school_fee_adjustment_history` from `anon` and
  `authenticated`.
- Leave `SELECT` for `authenticated` in place. The fee-staff policy decides which rows.

Only the two `SECURITY DEFINER` functions (`update_fee_adjustment`, `delete_fee_adjustment`)
write history rows, and they run as the function owner, so they are unaffected.

## 3. Notes
1. Idempotent and safe to re-run.
2. No rows are deleted and no column is dropped.
*/

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.school_fee_adjustment_history FROM anon, authenticated;

GRANT SELECT ON public.school_fee_adjustment_history TO authenticated;
