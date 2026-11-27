# Project memory

## Product intent & audience

- School management application (domain: "schooldesk")
- Core modules: admissions, fees, student records, notices
- Three user roles: **Admin**, **Teacher**, **Parent**
- Admin has exclusive control over account lifecycle: create, suspend, reactivate, remove (Teacher & Parent accounts only; admin cannot remove own account)
- No self-registration — all accounts created by Admin

## Brand personality & voice

- TBD — no voice/brand signals yet from user interactions

## Visual design & UX direction

- Stack: Vite + React + Supabase + Tailwind CSS + lucide-react icons
- Login page: username + password fields only (no email shown to users)
- One-time "Create the first admin" bootstrap link on login page — disabled after first admin exists
- Admin panel includes User Accounts table with columns: Username, Full Name, Role, Actions (suspend/reactivate/remove)
- CreateUserModal fields: username, full name, password, role
- Refer to `.bolt/prompt` for global UI conventions (Tailwind, lucide-react, `@/` path alias)
- ParentDashboard and StudentDashboard both fetch and display portal notifications via shared `fetchPortalNotifications` helper
- StudentDashboard shows "Notices from the school" section (title, date, body)
- WhatsApp reminder links use `https://wa.me/` (universal, mobile+desktop, no about:blank)
- Window priming for WhatsApp opens is lazy (avoids blank tabs when no valid number)

## Decisions, constraints & rationale

- Supabase Auth requires an email, so usernames are mapped to internal pseudo-emails (`username@schooldesk.local`); users only see/enter usernames
- Account creation uses a SECURITY DEFINER RPC function server-side instead of `supabase.auth.signUp` — `signUp` would create a new session and log the admin out
- Account removal also uses an RPC function
- All existing accounts were cleared after the auth schema change; fresh start required
- Project files live at working-directory root (moved out of `project/` subdirectory)
- Fee reminder notifications use RPC `create_fee_reminder_notification` (SECURITY DEFINER) with idempotent upsert — relies on existing unique index `school_portal_notifications_student_day_key` on `(student_id, notification_type, attendance_date)`; re-sending same day updates existing row, no duplicates
- Portal notifications table: `school_portal_notifications`; notification_type `fee_reminder` includes student name, class, due amount, reminder date
- WhatsApp number lookup checks student + parent + guardian + other info contact fields; normalizes digits (e.g., `03xxxxxxxxx` → `923xxxxxxxxx`)
- `school_other_information` table has `information_type` and `notes` columns (not phone-specific); student contact fields remain primary source for phone lookup
- Fee reminder notifications inserted in two send paths: `feeReminders.ts` (AccountantDefaulters) and `FeeManagementPanel.tsx` (`sendReminders`)
- Verification loop: typecheck clean, lint 0 errors (5 pre-existing warnings), build succeeds

## Open questions & assumptions

- RPC function names and full Supabase schema details not fully documented here
- Supabase env var names and config location still unconfirmed
- Build target, Node version, and package manager unknown
- Whether app has existing production data beyond cleared accounts unknown
- Module-level role permissions (what Teachers vs Parents can access) not yet specified