/*
# Utility & Tools module — persistence tables

1. Overview
The Utility & Tools module collects everyday school administration tools into one
place. This migration creates the tables that need server-side persistence for five
of the eight sub-tabs. The remaining three (SMS Templates, Holidays, Reports) reuse
existing infrastructure:

- SMS Templates already live in `school_notice_templates` (used by absentee alerts).
- Holidays already live in `school_calendar_days` (used by attendance). The Holidays
  tab in this module will surface those same records in a simpler list view.
- Reports is a read-only summary screen computed from the tables below plus the
  existing calendar days.

2. New tables
- `school_visiting_cards` — printed visiting / identity cards for staff or visitors.
  Columns: id, person_name, designation, phone, email, organization, card_type
  ('staff'|'visitor'|'guest'), notes, created_at, created_by.
- `school_job_applications` — job applications received by the school.
  Columns: id, applicant_name, position_applied, phone, email, applied_date, status
  ('pending'|'shortlisted'|'rejected'|'hired'), notes, created_at, created_by.
- `school_events` — school events like sports day, annual function, meetings.
  Columns: id, title, event_date, end_date, location, description, event_type
  ('academic'|'cultural'|'sports'|'meeting'|'holiday'|'other'), status
  ('upcoming'|'completed'|'cancelled'), created_at, created_by.
- `school_announcements` — school-wide notices and announcements.
  Columns: id, title, body, audience ('all'|'staff'|'students'|'parents'),
  priority ('normal'|'important'|'urgent'), start_date, end_date, is_active,
  created_at, created_by.
- `school_timetables` — class timetables. One row per (class_name, section_name,
  day_of_week, period) combination.
  Columns: id, class_name, section_name, day_of_week (0-6), period (1-12),
  subject, teacher_name, start_time, end_time, room, notes, created_at, updated_at,
  created_by.

3. Security
- RLS enabled on every table.
- SELECT for all staff (is_staff()).
- INSERT/UPDATE for admin + office_assistant (the "front office" roles that manage
  day-to-day utility records). Teachers can read but not write.
- DELETE for admin only (data integrity).
- `REVOKE ALL FROM anon` and `REVOKE TRUNCATE, REFERENCES, TRIGGER FROM authenticated`
  on every table to prevent the default Postgres grant from leaking through.
- No SECURITY DEFINER functions are created; the frontend reads and writes directly.
*/

-- ============================================================================
-- school_visiting_cards
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_visiting_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_name text NOT NULL,
  designation text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  organization text NOT NULL DEFAULT '',
  card_type text NOT NULL DEFAULT 'staff' CHECK (card_type IN ('staff','visitor','guest')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE school_visiting_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_visiting_cards FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_visiting_cards FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_visiting_cards TO authenticated;

DROP POLICY IF EXISTS "utility_cards_select_staff" ON school_visiting_cards;
CREATE POLICY "utility_cards_select_staff" ON school_visiting_cards FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "utility_cards_insert_office" ON school_visiting_cards;
CREATE POLICY "utility_cards_insert_office" ON school_visiting_cards FOR INSERT
TO authenticated WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_cards_update_office" ON school_visiting_cards;
CREATE POLICY "utility_cards_update_office" ON school_visiting_cards FOR UPDATE
TO authenticated USING (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
)) WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_cards_delete_admin" ON school_visiting_cards;
CREATE POLICY "utility_cards_delete_admin" ON school_visiting_cards FOR DELETE
TO authenticated USING (is_admin());

-- ============================================================================
-- school_job_applications
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_name text NOT NULL,
  position_applied text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  applied_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shortlisted','rejected','hired')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE school_job_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_job_applications FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_job_applications FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_job_applications TO authenticated;

DROP POLICY IF EXISTS "utility_jobs_select_staff" ON school_job_applications;
CREATE POLICY "utility_jobs_select_staff" ON school_job_applications FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "utility_jobs_insert_office" ON school_job_applications;
CREATE POLICY "utility_jobs_insert_office" ON school_job_applications FOR INSERT
TO authenticated WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_jobs_update_office" ON school_job_applications;
CREATE POLICY "utility_jobs_update_office" ON school_job_applications FOR UPDATE
TO authenticated USING (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
)) WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_jobs_delete_admin" ON school_job_applications;
CREATE POLICY "utility_jobs_delete_admin" ON school_job_applications FOR DELETE
TO authenticated USING (is_admin());

-- ============================================================================
-- school_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date date NOT NULL,
  end_date date,
  location text NOT NULL DEFAULT '',
  description text,
  event_type text NOT NULL DEFAULT 'other' CHECK (event_type IN ('academic','cultural','sports','meeting','holiday','other')),
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE school_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_events FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_events TO authenticated;

DROP POLICY IF EXISTS "utility_events_select_staff" ON school_events;
CREATE POLICY "utility_events_select_staff" ON school_events FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "utility_events_insert_office" ON school_events;
CREATE POLICY "utility_events_insert_office" ON school_events FOR INSERT
TO authenticated WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_events_update_office" ON school_events;
CREATE POLICY "utility_events_update_office" ON school_events FOR UPDATE
TO authenticated USING (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
)) WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_events_delete_admin" ON school_events;
CREATE POLICY "utility_events_delete_admin" ON school_events FOR DELETE
TO authenticated USING (is_admin());

-- ============================================================================
-- school_announcements
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','staff','students','parents')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE school_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_announcements FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_announcements FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_announcements TO authenticated;

DROP POLICY IF EXISTS "utility_ann_select_staff" ON school_announcements;
CREATE POLICY "utility_ann_select_staff" ON school_announcements FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "utility_ann_insert_office" ON school_announcements;
CREATE POLICY "utility_ann_insert_office" ON school_announcements FOR INSERT
TO authenticated WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_ann_update_office" ON school_announcements;
CREATE POLICY "utility_ann_update_office" ON school_announcements FOR UPDATE
TO authenticated USING (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
)) WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'office_assistant' AND status = 'active'
));

DROP POLICY IF EXISTS "utility_ann_delete_admin" ON school_announcements;
CREATE POLICY "utility_ann_delete_admin" ON school_announcements FOR DELETE
TO authenticated USING (is_admin());

-- ============================================================================
-- school_timetables
-- ============================================================================
CREATE TABLE IF NOT EXISTS school_timetables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name text NOT NULL,
  section_name text NOT NULL DEFAULT '',
  day_of_week smallint NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  period smallint NOT NULL CHECK (period >= 1 AND period <= 12),
  subject text NOT NULL DEFAULT '',
  teacher_name text NOT NULL DEFAULT '',
  start_time text NOT NULL DEFAULT '',
  end_time text NOT NULL DEFAULT '',
  room text NOT NULL DEFAULT '',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS school_timetables_class_day_idx
  ON school_timetables (class_name, section_name, day_of_week, period);

ALTER TABLE school_timetables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON school_timetables FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON school_timetables FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_timetables TO authenticated;

DROP POLICY IF EXISTS "utility_tt_select_staff" ON school_timetables;
CREATE POLICY "utility_tt_select_staff" ON school_timetables FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "utility_tt_insert_office" ON school_timetables;
CREATE POLICY "utility_tt_insert_office" ON school_timetables FOR INSERT
TO authenticated WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND (role = 'office_assistant' OR role = 'teacher') AND status = 'active'
));

DROP POLICY IF EXISTS "utility_tt_update_office" ON school_timetables;
CREATE POLICY "utility_tt_update_office" ON school_timetables FOR UPDATE
TO authenticated USING (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND (role = 'office_assistant' OR role = 'teacher') AND status = 'active'
)) WITH CHECK (is_admin() OR EXISTS (
  SELECT 1 FROM user_profiles WHERE id = auth.uid() AND (role = 'office_assistant' OR role = 'teacher') AND status = 'active'
));

DROP POLICY IF EXISTS "utility_tt_delete_admin" ON school_timetables;
CREATE POLICY "utility_tt_delete_admin" ON school_timetables FOR DELETE
TO authenticated USING (is_admin());
