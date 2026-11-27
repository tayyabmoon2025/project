/*
# Half-Day Gate Pass module

1. New Tables
- `school_half_day_leaves`
  - `id` (uuid, primary key, auto-generated)
  - `student_id` (uuid, not null — references school_students)
  - `leave_date` (date, not null, default CURRENT_DATE — the day the student left early)
  - `exit_time` (timestamptz, not null, default now() — exact checkout time)
  - `request_mode` (text, not null — 'In-Person' or 'Phone Call')
  - `receiver_name` (text, not null — person who picked up the student or parent who called)
  - `receiver_cnic` (text, not null — CNIC / ID card number of the receiver)
  - `reason` (text, not null — reason for early departure)
  - `approved_by` (text, not null — full name of the admin/staff user who issued the pass)
  - `gate_pass_id` (text, unique — human-readable sequential ID like "GP-0001")
  - `created_at` (timestamptz, not null, default now())

2. New Functions
- `create_half_day_leave(p_student_id, p_request_mode, p_receiver_name, p_receiver_cnic, p_reason, p_approved_by)`
  - SECURITY DEFINER, search_path = 'public'
  - Atomically: (a) inserts a half-day leave record with an auto-generated gate_pass_id,
    (b) upserts today's attendance row to status 'half_day' (preserving the existing record),
    (c) inserts a portal notification into school_portal_notifications
  - Returns the new leave record as a JSON object
  - Only callable by authenticated staff (is_admin() or is_staff())

3. Security
- Enable RLS on `school_half_day_leaves`.
- Grant SELECT, INSERT to `authenticated` (app has sign-in; staff manage gate passes).
- No UPDATE/DELETE — a issued gate pass is immutable.
- 4 separate policies: SELECT, INSERT for authenticated staff. No UPDATE or DELETE.
- Revoke EXECUTE on the RPC from PUBLIC/anon; grant to authenticated.
- The gate_pass_id sequence is granted to authenticated for INSERT.

4. Important Notes
- The attendance upsert uses ON CONFLICT (student_id, attendance_date) DO UPDATE
  so the existing 'present' record is preserved — only its status changes to 'half_day'.
- The portal notification uses notification_type = 'half_day_alert' and follows the
  same dedup pattern as other notifications (ON CONFLICT on student_id, notification_type, attendance_date).
- A separate sequence `school_half_day_leaves_seq` generates the numeric portion of gate_pass_id.
*/

CREATE TABLE IF NOT EXISTS school_half_day_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  leave_date date NOT NULL DEFAULT CURRENT_DATE,
  exit_time timestamptz NOT NULL DEFAULT now(),
  request_mode text NOT NULL CHECK (request_mode IN ('In-Person', 'Phone Call')),
  receiver_name text NOT NULL,
  receiver_cnic text NOT NULL,
  reason text NOT NULL,
  approved_by text NOT NULL,
  gate_pass_id text UNIQUE NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_half_day_leaves_student_idx ON school_half_day_leaves (student_id);
CREATE INDEX IF NOT EXISTS school_half_day_leaves_date_idx ON school_half_day_leaves (leave_date);

ALTER TABLE school_half_day_leaves ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON school_half_day_leaves TO authenticated;

-- Sequence for gate_pass_id generation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_name = 'school_half_day_leaves_seq') THEN
    CREATE SEQUENCE school_half_day_leaves_seq START 1;
  END IF;
END $$;

GRANT USAGE ON SEQUENCE school_half_day_leaves_seq TO authenticated;

DROP POLICY IF EXISTS "staff_select_half_day_leaves" ON school_half_day_leaves;
CREATE POLICY "staff_select_half_day_leaves"
ON school_half_day_leaves FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "staff_insert_half_day_leaves" ON school_half_day_leaves;
CREATE POLICY "staff_insert_half_day_leaves"
ON school_half_day_leaves FOR INSERT
TO authenticated
WITH CHECK (true);

-- Drop and recreate the RPC function
DROP FUNCTION IF EXISTS create_half_day_leave(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION create_half_day_leave(
  p_student_id uuid,
  p_request_mode text,
  p_receiver_name text,
  p_receiver_cnic text,
  p_reason text,
  p_approved_by text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_gate_pass_id text;
  v_leave_id uuid;
  v_leave_record json;
  v_student_name text;
  v_class_name text;
  v_section_name text;
  v_day_name text;
  v_date_text text;
  v_time_text text;
  v_notification_body text;
  v_today date := CURRENT_DATE;
BEGIN
  -- Validate request_mode
  IF p_request_mode NOT IN ('In-Person', 'Phone Call') THEN
    RAISE EXCEPTION 'Invalid request_mode: must be In-Person or Phone Call';
  END IF;

  -- Validate required fields
  IF COALESTRIM(p_receiver_name) = '' OR COALESCTIM(p_receiver_cnic) = '' OR COALESCTIM(p_reason) = '' OR COALESCTIM(p_approved_by) = '' THEN
    RAISE EXCEPTION 'All fields (receiver_name, receiver_cnic, reason, approved_by) are required';
  END IF;

  -- Generate gate_pass_id
  v_gate_pass_id := 'GP-' || lpad(nextval('school_half_day_leaves_seq')::text, 4, '0');

  -- Fetch student info for notification
  SELECT full_name, class_name, section_name
  INTO v_student_name, v_class_name, v_section_name
  FROM school_students
  WHERE id = p_student_id;

  IF v_student_name IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  -- Insert the half-day leave record
  INSERT INTO school_half_day_leaves (student_id, leave_date, exit_time, request_mode, receiver_name, receiver_cnic, reason, approved_by, gate_pass_id)
  VALUES (p_student_id, v_today, now(), p_request_mode, p_receiver_name, p_receiver_cnic, p_reason, p_approved_by, v_gate_pass_id)
  RETURNING id INTO v_leave_id;

  -- Update today's attendance to 'half_day' (upsert preserves existing record)
  INSERT INTO school_attendance (student_id, attendance_date, status, note)
  VALUES (p_student_id, v_today, 'half_day', 'Half-day gate pass issued')
  ON CONFLICT (student_id, attendance_date)
  DO UPDATE SET status = 'half_day', note = 'Half-day gate pass issued';

  -- Build notification message
  v_day_name := to_char(v_today, 'Day');
  v_day_name := btrim(v_day_name);
  v_date_text := to_char(v_today, 'DD Month YYYY');
  v_time_text := to_char(now(), 'HH12:MI AM');
  v_notification_body := 'Half-Day Alert: ' || v_student_name || ' (Class ' || COALESCTIM(v_class_name, '') ||
    ') has been released from school on ' || v_day_name || ', ' || v_date_text || ' at exactly ' || v_time_text ||
    '. Handed over to: ' || p_receiver_name || ' (CNIC: ' || p_receiver_cnic || ').';

  -- Insert portal notification (dedup by student_id + notification_type + attendance_date)
  INSERT INTO school_portal_notifications (student_id, notification_type, title, body, attendance_date, created_by)
  VALUES (p_student_id, 'half_day_alert', 'Half-Day Gate Pass', v_notification_body, v_today, auth.uid())
  ON CONFLICT (student_id, notification_type, attendance_date)
  DO UPDATE SET title = 'Half-Day Gate Pass', body = v_notification_body;

  -- Return the full leave record as JSON
  SELECT json_build_object(
    'id', h.id,
    'gate_pass_id', h.gate_pass_id,
    'student_id', h.student_id,
    'student_name', v_student_name,
    'class_name', v_class_name,
    'section_name', v_section_name,
    'leave_date', h.leave_date,
    'exit_time', h.exit_time,
    'request_mode', h.request_mode,
    'receiver_name', h.receiver_name,
    'receiver_cnic', h.receiver_cnic,
    'reason', h.reason,
    'approved_by', h.approved_by,
    'created_at', h.created_at
  )
  INTO v_leave_record
  FROM school_half_day_leaves h
  WHERE h.id = v_leave_id;

  RETURN v_leave_record;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_half_day_leave(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_half_day_leave(uuid, text, text, text, text, text) TO authenticated;
