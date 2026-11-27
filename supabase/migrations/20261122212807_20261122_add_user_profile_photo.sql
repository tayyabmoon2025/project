/*
# Add profile photo to user accounts

1. Purpose
Allow Admin, Accountant, Teacher (and other signed-in users) to attach a small
profile photo. The photo is stored as a short base64 data URL directly on the
user's profile row, matching the existing pattern used for student photos.

2. Modified table: public.user_profiles
- `photo_url` (text, nullable) — optional profile photo data URL.

3. Security
- RLS is already enabled; the existing "Users can update own full_name" policy
  already allows a signed-in user to update their own row.
- Grants UPDATE on the new `photo_url` column only to `authenticated`, so users
  can change their own photo but cannot touch role, status, username, or
  student_id (those remain administrator-only).
- No new policies or table-level grants are required.
*/

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS photo_url text;

GRANT UPDATE (photo_url) ON public.user_profiles TO authenticated;
