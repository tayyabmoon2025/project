/*
# System Setup module — configuration tables

1. Overview
Adds the persistence layer for a new administrator-facing "System Setup" screen with
seven sub-tabs. Classes & Sections reuses the existing `school_sections` table (already
managed elsewhere); the other six tabs need their own tables, created here.

2. New tables
- `school_academic_sessions` — one row per academic year/term ("New Session" tab).
  Columns: id, session_name (unique), start_date, end_date, is_current, created_at.
- `school_institution_profile` — a single school-wide profile row keyed `id = 'default'`
  ("Institution Profile" tab). Columns: school_name, school_name_urdu, address, city,
  phone, email, website, affiliation_no, registration_no, logo_url, principal_name,
  established_year, updated_at.
- `school_system_settings` — generic key/value defaults ("Default Values" tab).
  Columns: id (text, key), category, value, updated_at.
- `school_grading_scales` — grade bands ("Grading System" tab).
  Columns: id, grade, min_percent, max_percent, gpa, remarks, sort_order, created_at.

3. Security
- RLS enabled on every new table.
- SELECT: staff (`is_staff()`) so teachers can read grading/session/sections data.
- INSERT/UPDATE/DELETE: admin only (`is_admin()`), since System Setup is an
  administrator-only configuration surface.
- `REVOKE ALL FROM anon` and `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM authenticated`
  on each new table to close the Postgres default-grant hole.
- Seed data is inserted only when the table is empty, so re-running the migration is safe.

4. Notes
- No SECURITY DEFINER functions created; the frontend reads/writes directly under RLS.
- `school_sessions` and `school_grading_scales` are written via the same Supabase Data
  API pattern used by the Finance and Utility & Tools modules.
*/

-- ============================================================================
-- school_academic_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_name text NOT NULL UNIQUE,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE school_academic_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_academic_sessions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_academic_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_academic_sessions TO authenticated;

DROP POLICY IF EXISTS "setup_sessions_select_staff" ON school_academic_sessions;
CREATE POLICY "setup_sessions_select_staff" ON school_academic_sessions FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "setup_sessions_insert_admin" ON school_academic_sessions;
CREATE POLICY "setup_sessions_insert_admin" ON school_academic_sessions FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_sessions_update_admin" ON school_academic_sessions;
CREATE POLICY "setup_sessions_update_admin" ON school_academic_sessions FOR UPDATE
TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_sessions_delete_admin" ON school_academic_sessions;
CREATE POLICY "setup_sessions_delete_admin" ON school_academic_sessions FOR DELETE
TO authenticated USING (is_admin());

-- ============================================================================
-- school_institution_profile
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_institution_profile (
  id text PRIMARY KEY DEFAULT 'default',
  school_name text NOT NULL DEFAULT '',
  school_name_urdu text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  affiliation_no text NOT NULL DEFAULT '',
  registration_no text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  principal_name text NOT NULL DEFAULT '',
  established_year text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE school_institution_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_institution_profile FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_institution_profile FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON school_institution_profile TO authenticated;

DROP POLICY IF EXISTS "setup_profile_select_staff" ON school_institution_profile;
CREATE POLICY "setup_profile_select_staff" ON school_institution_profile FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "setup_profile_insert_admin" ON school_institution_profile;
CREATE POLICY "setup_profile_insert_admin" ON school_institution_profile FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_profile_update_admin" ON school_institution_profile;
CREATE POLICY "setup_profile_update_admin" ON school_institution_profile FOR UPDATE
TO authenticated USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO school_institution_profile (id, school_name, school_name_urdu)
VALUES ('default', 'Ujala Public School', 'اجالا پبلک اسکول')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- school_system_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_system_settings (
  id text PRIMARY KEY,
  category text NOT NULL DEFAULT 'General',
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE school_system_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_system_settings FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_system_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_system_settings TO authenticated;

DROP POLICY IF EXISTS "setup_settings_select_staff" ON school_system_settings;
CREATE POLICY "setup_settings_select_staff" ON school_system_settings FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "setup_settings_insert_admin" ON school_system_settings;
CREATE POLICY "setup_settings_insert_admin" ON school_system_settings FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_settings_update_admin" ON school_system_settings;
CREATE POLICY "setup_settings_update_admin" ON school_system_settings FOR UPDATE
TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_settings_delete_admin" ON school_system_settings;
CREATE POLICY "setup_settings_delete_admin" ON school_system_settings FOR DELETE
TO authenticated USING (is_admin());

INSERT INTO school_system_settings (id, category, value)
SELECT seed.id, seed.category, seed.value
FROM (VALUES
  ('default_session', 'Academic', '2026-2027'),
  ('school_opening_time', 'Timings', '08:00'),
  ('school_closing_time', 'Timings', '14:00'),
  ('default_fee_due_days', 'Fees', '10'),
  ('absentee_reminder_language', 'Communication', 'English')
) AS seed(id, category, value)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- school_grading_scales
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_grading_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade text NOT NULL,
  min_percent numeric NOT NULL DEFAULT 0 CHECK (min_percent >= 0 AND min_percent <= 100),
  max_percent numeric NOT NULL DEFAULT 100 CHECK (max_percent >= 0 AND max_percent <= 100),
  gpa numeric NOT NULL DEFAULT 0,
  remarks text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_percent <= max_percent)
);

ALTER TABLE school_grading_scales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_grading_scales FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_grading_scales FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_grading_scales TO authenticated;

DROP POLICY IF EXISTS "setup_grading_select_staff" ON school_grading_scales;
CREATE POLICY "setup_grading_select_staff" ON school_grading_scales FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "setup_grading_insert_admin" ON school_grading_scales;
CREATE POLICY "setup_grading_insert_admin" ON school_grading_scales FOR INSERT
TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_grading_update_admin" ON school_grading_scales;
CREATE POLICY "setup_grading_update_admin" ON school_grading_scales FOR UPDATE
TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "setup_grading_delete_admin" ON school_grading_scales;
CREATE POLICY "setup_grading_delete_admin" ON school_grading_scales FOR DELETE
TO authenticated USING (is_admin());

INSERT INTO school_grading_scales (grade, min_percent, max_percent, gpa, remarks, sort_order)
SELECT seed.grade, seed.min_percent, seed.max_percent, seed.gpa, seed.remarks, seed.sort_order
FROM (VALUES
  ('A+', 80, 100, 4.00, 'Outstanding', 1),
  ('A', 70, 79.99, 3.50, 'Excellent', 2),
  ('B', 60, 69.99, 3.00, 'Very good', 3),
  ('C', 50, 59.99, 2.50, 'Good', 4),
  ('D', 40, 49.99, 2.00, 'Satisfactory', 5),
  ('F', 0, 39.99, 0.00, 'Needs improvement', 6)
) AS seed(grade, min_percent, max_percent, gpa, remarks, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM school_grading_scales);
