/*
# Allow 'half_day' status in school_attendance check constraint

## Purpose
The Half-Day Gate Pass module's RPC (`create_half_day_leave`) upserts today's
attendance row to status `'half_day'`. The existing CHECK constraint
`school_attendance_status_check` only allowed `present`, `absent`, `late`, and
`leave`, causing the insert to fail with:
  `new row for relation "school_attendance" violates check constraint
   "school_attendance_status_check"`

## Changes
1. Drops the existing `school_attendance_status_check` constraint.
2. Recreates it with the same four values plus `'half_day'`.

## Security
- No RLS or policy changes.
- No new tables or columns.
- No grants modified.
*/

ALTER TABLE school_attendance
  DROP CONSTRAINT IF EXISTS school_attendance_status_check;

ALTER TABLE school_attendance
  ADD CONSTRAINT school_attendance_status_check
  CHECK (status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'leave'::text, 'half_day'::text]));
