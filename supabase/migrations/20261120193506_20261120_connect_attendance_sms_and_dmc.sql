/*
# Connect Daily Attendance with parent SMS alerts and DMC certificates

## Summary
This migration adds the storage that links three things the school already
handles by hand: the daily attendance register, the absentee SMS alerts sent to
guardians, and the Detailed Marks Certificate (DMC) issued for a student.

Attendance itself is unchanged — `school_attendance` already stores one row per
student per day with a status of `present`, `absent` or `late`, which is exactly
the shape the DMC calculation needs.

## 1. New table: school_sms_log
One row per SMS alert the school sends to a guardian.

| column | meaning |
| --- | --- |
| id | unique row id |
| student_id | the student the alert is about (removed automatically with the student) |
| student_name | the student's name at the time the alert was logged |
| class_name / section_name | the class the student was in at the time |
| parent_phone | the guardian number the alert was addressed to |
| message_type | what kind of alert this is (`absentee_alert` by default) |
| message_body | the exact wording of the alert |
| status | `sent`, `failed` or `pending` |
| provider_response | any message returned by the SMS provider |
| attendance_date | the school day the alert refers to |
| sent_at | when the alert was dispatched |
| created_by | the staff account that triggered it |
| created_at | when the log row was created |

## 2. New table: school_dmc_records
One row per generated Detailed Marks Certificate.

| column | meaning |
| --- | --- |
| id | unique row id |
| student_id | the student the certificate is for (removed with the student) |
| term / session | the term or academic session the certificate covers |
| period_start / period_end | the date range the attendance summary was calculated over |
| attendance_total | school days counted in the period |
| attendance_present | days the student was present (late days count as present) |
| attendance_absent | days the student was absent |
| attendance_percentage | present days as a percentage of total days, 1 decimal place |
| attendance_manual | true when a staff member overrode the calculated figures |
| remarks | free-text result or remarks printed on the certificate |
| issued_date | the date printed on the certificate |
| created_by / created_at / updated_at | audit columns |

## 3. Security
Both tables are staff-only. Row level security is enabled and all four policies
per table are scoped to the existing `is_staff()` helper, matching every other
school table. Parents and non-staff accounts cannot read or write them.

## 4. Notes
- No existing table or column is modified, so no data is touched.
- Both tables cascade on student deletion, so the roster and its history stay in
  step.
*/

CREATE TABLE IF NOT EXISTS school_sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  class_name text,
  section_name text,
  parent_phone text,
  message_type text NOT NULL DEFAULT 'absentee_alert',
  message_body text,
  status text NOT NULL DEFAULT 'pending',
  provider_response text,
  attendance_date date,
  sent_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_sms_log_status_check CHECK (status IN ('sent', 'failed', 'pending'))
);

CREATE INDEX IF NOT EXISTS school_sms_log_date_idx ON school_sms_log (attendance_date);
CREATE INDEX IF NOT EXISTS school_sms_log_student_idx ON school_sms_log (student_id);
CREATE INDEX IF NOT EXISTS school_sms_log_status_idx ON school_sms_log (status);

ALTER TABLE school_sms_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_sms_log TO authenticated;

DROP POLICY IF EXISTS "Staff can read sms log" ON school_sms_log;
CREATE POLICY "Staff can read sms log" ON school_sms_log FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "Staff can add sms log" ON school_sms_log;
CREATE POLICY "Staff can add sms log" ON school_sms_log FOR INSERT
TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update sms log" ON school_sms_log;
CREATE POLICY "Staff can update sms log" ON school_sms_log FOR UPDATE
TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove sms log" ON school_sms_log;
CREATE POLICY "Staff can remove sms log" ON school_sms_log FOR DELETE
TO authenticated USING (is_staff());

CREATE TABLE IF NOT EXISTS school_dmc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  term text,
  session text,
  period_start date,
  period_end date,
  attendance_total integer NOT NULL DEFAULT 0,
  attendance_present integer NOT NULL DEFAULT 0,
  attendance_absent integer NOT NULL DEFAULT 0,
  attendance_percentage numeric(5, 1) NOT NULL DEFAULT 0,
  attendance_manual boolean NOT NULL DEFAULT false,
  remarks text,
  issued_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_dmc_records_student_idx ON school_dmc_records (student_id);
CREATE INDEX IF NOT EXISTS school_dmc_records_period_idx ON school_dmc_records (period_start, period_end);

ALTER TABLE school_dmc_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_dmc_records TO authenticated;

DROP POLICY IF EXISTS "Staff can read dmc records" ON school_dmc_records;
CREATE POLICY "Staff can read dmc records" ON school_dmc_records FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "Staff can add dmc records" ON school_dmc_records;
CREATE POLICY "Staff can add dmc records" ON school_dmc_records FOR INSERT
TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update dmc records" ON school_dmc_records;
CREATE POLICY "Staff can update dmc records" ON school_dmc_records FOR UPDATE
TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can remove dmc records" ON school_dmc_records;
CREATE POLICY "Staff can remove dmc records" ON school_dmc_records FOR DELETE
TO authenticated USING (is_staff());
