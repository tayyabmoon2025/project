/*
# Add receiver photo to half-day gate passes

1. Changes
- `school_half_day_leaves`: add `receiver_photo_url` (text, nullable) — stores a
  signed URL to a photo of the receiver or their ID card, captured by the staff
  member issuing the gate pass.

2. Function changes
- `create_half_day_leave`: add optional `p_receiver_photo_url` parameter (text,
  nullable). The photo URL is stored alongside the rest of the gate pass record
  and returned in the JSON result.

3. Security
- No new RLS policies needed — the column is covered by the existing
  SELECT/INSERT policies on `school_half_day_leaves`.
- The photo is uploaded to the existing `whatsapp-attachments` storage bucket,
  which already enforces owner-scoped access via `auth.uid()` folder policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_half_day_leaves' AND column_name = 'receiver_photo_url'
  ) THEN
    ALTER TABLE school_half_day_leaves ADD COLUMN receiver_photo_url text;
  END IF;
END $$;

DROP FUNCTION IF EXISTS create_half_day_leave(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION create_half_day_leave(
  p_student_id uuid,
  p_request_mode text,
  p_receiver_name text,
  p_receiver_cnic text,
  p_reason text,
  p_approved_by text,
  p_receiver_photo_url text DEFAULT NULL
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
  IF p_request_mode NOT IN ('In-Person', 'Phone Call') THEN
    RAISE EXCEPTION 'Invalid request_mode: must be In-Person or Phone Call';
  END IF;

  IF NULLIF(TRIM(p_receiver_name), '') IS NULL
     OR NULLIF(TRIM(p_receiver_cnic), '') IS NULL
     OR NULLIF(TRIM(p_reason), '') IS NULL
     OR NULLIF(TRIM(p_approved_by), '') IS NULL THEN
    RAISE EXCEPTION 'All fields (receiver_name, receiver_cnic, reason, approved_by) are required';
  END IF;

  v_gate_pass_id := 'GP-' || lpad(nextval('school_half_day_leaves_seq')::text, 4, '0');

  SELECT full_name, class_name, section_name
  INTO v_student_name, v_class_name, v_section_name
  FROM school_students
  WHERE id = p_student_id;

  IF v_student_name IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  INSERT INTO school_half_day_leaves (student_id, leave_date, exit_time, request_mode, receiver_name, receiver_cnic, reason, approved_by, gate_pass_id, receiver_photo_url)
  VALUES (p_student_id, v_today, now(), p_request_mode, p_receiver_name, p_receiver_cnic, p_reason, p_approved_by, v_gate_pass_id, p_receiver_photo_url)
  RETURNING id INTO v_leave_id;

  INSERT INTO school_attendance (student_id, attendance_date, status, note)
  VALUES (p_student_id, v_today, 'half_day', 'Half-day gate pass issued')
  ON CONFLICT (student_id, attendance_date)
  DO UPDATE SET status = 'half_day', note = 'Half-day gate pass issued';

  v_day_name := btrim(to_char(v_today, 'Day'));
  v_date_text := to_char(v_today, 'DD Month YYYY');
  v_time_text := to_char(now(), 'HH12:MI AM');
  v_notification_body := 'Half-Day Alert: ' || v_student_name || ' (Class ' || COALESCE(NULLIF(TRIM(v_class_name), ''), '') ||
    ') has been released from school on ' || v_day_name || ', ' || v_date_text || ' at exactly ' || v_time_text ||
    '. Handed over to: ' || p_receiver_name || ' (CNIC: ' || p_receiver_cnic || ').';

  INSERT INTO school_portal_notifications (student_id, notification_type, title, body, attendance_date, created_by)
  VALUES (p_student_id, 'half_day_alert', 'Half-Day Gate Pass', v_notification_body, v_today, auth.uid())
  ON CONFLICT (student_id, notification_type, attendance_date)
  DO UPDATE SET title = 'Half-Day Gate Pass', body = v_notification_body;

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
    'receiver_photo_url', h.receiver_photo_url,
    'created_at', h.created_at
  )
  INTO v_leave_record
  FROM school_half_day_leaves h
  WHERE h.id = v_leave_id;

  RETURN v_leave_record;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_half_day_leave(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_half_day_leave(uuid, text, text, text, text, text, text) TO authenticated;
