/*
# Live classes — close the trigger function to direct calls

## 1. Summary
`touch_live_class()` is a trigger function: it runs automatically before a live
class row is written. It was left callable as an RPC by any signed-in account,
which serves no purpose. This migration revokes that.

A trigger function is invoked by the database itself, so revoking EXECUTE does
not affect the trigger — the live class trigger keeps working exactly as before.

## 2. Security changes
- `EXECUTE` on `public.touch_live_class()` is revoked from `PUBLIC`, `anon` and
  `authenticated`.

## 3. Notes
- No table, column, row or policy is touched.
- Safe to re-run.
*/

REVOKE EXECUTE ON FUNCTION public.touch_live_class() FROM PUBLIC, anon, authenticated;
