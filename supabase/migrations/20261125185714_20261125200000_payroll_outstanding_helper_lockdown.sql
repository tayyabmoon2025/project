/*
# Lock down the payroll outstanding-balance helper

## 1. Purpose
`staff_advance_outstanding(uuid)` is an internal helper used only by the payroll
functions inside the database. It was granted to the `authenticated` role, which made
it callable directly from a browser through `/rest/v1/rpc/staff_advance_outstanding`.
The application never calls it from the browser — the Pay Salary screen calculates the
outstanding balance in the app from the advance and payment rows it already reads.

## 2. What changed
- Revoked `EXECUTE` on `staff_advance_outstanding(uuid)` from `authenticated`.
- The function keeps its `SECURITY DEFINER` rights and its internal
  `can_manage_users()` guard, so the payroll functions that call it keep working
  unchanged for administrators.

## 3. Security
- After this migration only the database owner and `service_role` can call the helper
  directly. Signed-in users lose a read path to payroll figures they were never meant
  to query in isolation.
- No table, column or row is touched, and no data is deleted.

## 4. Notes
- Safe to re-run: `REVOKE` is idempotent.
- No other payroll function was changed; all administrator-facing functions
  (`admin_save_staff_pay_package`, `admin_save_staff_advance`,
  `admin_close_staff_advance`, `admin_delete_staff_advance`,
  `admin_delete_staff_salary_payment`, `admin_pay_staff_salary`) keep their
  `authenticated` grant and their internal `can_manage_users()` check.
*/

REVOKE EXECUTE ON FUNCTION public.staff_advance_outstanding(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_advance_outstanding(uuid) TO service_role;
