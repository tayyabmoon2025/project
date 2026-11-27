/*
# Add Role-Based Authentication System

## Purpose
Introduces role-based authentication with three dashboards: Admin, Teacher, and Parent.
Admins can create, suspend, or remove Admin, Teacher, and Parent accounts.
Parents are linked to their children (students) via a join table.

## 1. New Tables

### `user_profiles`
- `id` (uuid, primary key, references auth.users on delete cascade)
- `full_name` (text, not null) — display name shown in the UI
- `role` (text, not null) — one of 'admin', 'teacher', 'parent'
- `status` (text, not null, default 'active') — 'active' or 'suspended'
- `created_at` (timestamptz, default now())

### `parent_student_links`
- `id` (uuid, primary key)
- `parent_user_id` (uuid, references user_profiles.id, on delete cascade)
- `student_id` (uuid, references school_students.id, on delete cascade)
- `created_at` (timestamptz, default now())
- Unique constraint on (parent_user_id, student_id) to prevent duplicate links

## 2. Security

### RLS on user_profiles
- Enabled.
- A user can SELECT their own profile row.
- A user can UPDATE only their own full_name (not role or status — those are admin-controlled).
- Admins can SELECT, INSERT, UPDATE, DELETE all profiles.
- Grants: SELECT, INSERT, UPDATE, DELETE to authenticated only (app now requires sign-in).

### RLS on parent_student_links
- Enabled.
- Parents can SELECT their own links (to see their children).
- Parents can INSERT/DELETE their own links.
- Admins and teachers can SELECT all links.
- Grants: SELECT, INSERT, UPDATE, DELETE to authenticated only.

### Helper function: is_admin()
- SECURITY DEFINER function that returns true if the current auth.uid() has role='admin'.
- Used in RLS policies to grant admin access across tables.

## 3. Existing Tables — Policy Updates

### school_students
- Old anon+authenticated open policies are dropped.
- New policies: authenticated users (admin, teacher, parent) can SELECT students.
- Only admins and teachers can INSERT/UPDATE/DELETE students.
- Parents can only SELECT students linked to them via parent_student_links.
- Grants updated: anon removed (app requires sign-in), authenticated retains CRUD.

### school_attendance
- Same pattern: authenticated can SELECT; admin+teacher can INSERT/UPDATE/DELETE.
- Parents can SELECT attendance for their linked children only.

## 4. Important Notes
1. The app now requires sign-in. All policies target `authenticated` only.
2. `is_admin()` is a SECURITY DEFINER function so it can read user_profiles regardless of RLS.
3. REVOKE EXECUTE on is_admin from PUBLIC and anon; grant to authenticated.
4. No user accounts are created in the migration — the first admin is created via Supabase dashboard or the app's bootstrap flow.
*/
