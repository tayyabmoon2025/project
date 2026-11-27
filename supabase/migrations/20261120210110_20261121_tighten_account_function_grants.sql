/*
# Tighten execute rights on account-management functions

## 1. Purpose
The security advisor flagged account-management functions that a signed-out visitor could
reach. Two of them must stay public because the login page uses them before anyone has
signed in:

- `bootstrap_check()` — tells the login page whether an administrator exists yet.
- `set_initial_admin(...)` — creates the very first administrator. It refuses to run once
  an administrator already exists, which is what keeps it safe.

The rest have no reason to be reachable before sign-in, so this migration revokes the
anonymous role's execute right on them. Signed-in users keep their access; the functions
themselves still refuse to act unless the caller is an administrator.

## 2. Changed
- `admin_register_profile(...)` (both versions) — execute revoked from `anon`.
- `sync_student_account_status()` — a trigger helper, never meant to be called directly;
  execute revoked from `anon`.

## 3. Notes
No table, column, row, or policy is changed. Only who may call these functions.
*/

REVOKE EXECUTE ON FUNCTION public.admin_register_profile(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_register_profile(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_student_account_status() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_register_profile(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_register_profile(uuid, text, text, text) TO authenticated;
