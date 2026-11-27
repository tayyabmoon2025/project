/*
# Stop the fee challan numbering function being callable from the API

## 1. What this changes
`public.assign_fee_challan_number()` is a trigger function: it only ever runs when a row
is inserted into `school_fee_challans`. The previous change made it SECURITY DEFINER so it
could call the internal number generator, which also made it reachable through the data
API by the anonymous role.

This migration revokes EXECUTE from PUBLIC, anon and authenticated. The function keeps
working exactly as before when the insert trigger fires — Postgres does not check EXECUTE
privilege when it invokes a trigger function — it simply can no longer be called directly.

## 2. Security
- EXECUTE revoked from PUBLIC, anon and authenticated on
  `public.assign_fee_challan_number()`. No other privilege, policy, table or row changes.
- The insert trigger `school_fee_challans_assign_number` is left in place and unchanged.

## 3. Notes
- Re-running this migration is safe: REVOKE is idempotent.
*/

REVOKE EXECUTE ON FUNCTION public.assign_fee_challan_number() FROM PUBLIC, anon, authenticated;
