/*
# School calendar: support multi-day ranges (vacations, holidays, overrides)

1. Summary
- Until now every entry in `school_calendar_days` covered exactly one date, so a
  two-week vacation had to be entered day by day. This migration gives each entry
  an optional end date, so one record can describe a whole span (for example a
  winter break from 20 December to 5 January) while still being a single,
  permanent, searchable history record.
- A one-day entry keeps working exactly as before: its start and end date are the
  same.

2. Modified Tables
- `school_calendar_days`
  - `end_date` (date, NOT NULL): the last date the entry covers. Existing rows are
    backfilled from `day_date`, so no entry changes meaning and nothing is lost.
  - New constraint `school_calendar_days_range_check`: `end_date >= day_date`, so a
    span can never run backwards.

3. Safety
- `ADD COLUMN IF NOT EXISTS` plus a backfill that only touches rows where
  `end_date IS NULL`, so re-running this migration is a no-op.
- No table, column or row is dropped, renamed or deleted. Existing titles, notes,
  types and dates are untouched.

4. Security
- No policy changes. Signed-in users may read the calendar; staff may add, update
  and delete entries, exactly as before.
- The existing table-level INSERT and UPDATE grants already cover the new column,
  so no extra grant is required.

5. Notes
- `day_date` remains unique, so one entry still starts on any given date. Two
  entries whose spans overlap are allowed; a day marked closed takes precedence
  over a special working day when attendance is counted.
*/

ALTER TABLE public.school_calendar_days
  ADD COLUMN IF NOT EXISTS end_date date;

UPDATE public.school_calendar_days
SET end_date = day_date
WHERE end_date IS NULL;

ALTER TABLE public.school_calendar_days
  ALTER COLUMN end_date SET NOT NULL;

ALTER TABLE public.school_calendar_days
  DROP CONSTRAINT IF EXISTS school_calendar_days_range_check;

ALTER TABLE public.school_calendar_days
  ADD CONSTRAINT school_calendar_days_range_check CHECK (end_date >= day_date);
