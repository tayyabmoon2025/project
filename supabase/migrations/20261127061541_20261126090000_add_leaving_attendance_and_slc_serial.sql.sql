/*
# Add Attendance Summary and SLC Serial No. to the student Leaving Info

## Summary

This migration adds the last two details the "Withdraw Students" module records when a
student leaves the school, so the whole leaving record lives on the student's own row and
the Withdraw Students screen and the Student Admission Form's "Leaving Info" tab can read
and write exactly the same fields.

## 1. Modified table: `public.school_students`

Two new nullable text columns:

- `attendance_summary` (text) — the attendance picture for the student at the moment they
  left, written in plain words, for example
  "Present 92 of 100 school days (92.0%) · Absent 8 · Late 0 · Leave 0".
  It is a snapshot: it records what the register said on the leaving date, so the leaving
  certificate and the student's record keep the same figure even if the register is edited
  later. The live figures are still derived from the attendance register everywhere else in
  the app; this column only preserves the leaving-time figure.

- `slc_serial_number` (text) — the serial number of the School Leaving Certificate handed to
  the family. It sits alongside the existing `leaving_certificate_number` (which the app
  generates automatically from the admission number). One is the school's own reference, the
  other is the serial printed on the certificate, so both are kept.

Both columns are nullable and added with `IF NOT EXISTS`, so re-running this migration is
safe and existing student rows are untouched. No data is changed or removed.

## 2. Security

- Row level security on `school_students` is already enabled and is not changed here.
- The existing row policies already govern who may reach a student row
  (`Staff can update students` — `is_staff()`), so no policy is added or altered.
- The two new columns are added to the set of columns `authenticated` may update, so the
  signed-in office staff can save the leaving record from the app. The `anon` role is not
  granted anything, matching every other column on this table: the roster is only reachable
  after sign-in.

## Important notes

1. Nothing is dropped, renamed or retyped, so no existing student data can be lost.
2. The app keeps both screens in step by writing these columns through one shared helper,
   so the Withdraw Students screen and the Admission Form can never disagree.
3. `attendance_summary` is deliberately free text. The exact wording is produced by the app
   from the attendance register at the moment of withdrawal, which keeps the database simple
   and lets the wording improve without another migration.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'school_students' AND column_name = 'attendance_summary'
  ) THEN
    ALTER TABLE public.school_students ADD COLUMN attendance_summary text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'school_students' AND column_name = 'slc_serial_number'
  ) THEN
    ALTER TABLE public.school_students ADD COLUMN slc_serial_number text;
  END IF;
END $$;

GRANT UPDATE (attendance_summary, slc_serial_number) ON public.school_students TO authenticated;
