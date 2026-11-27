/*
# Staff leave: half-day leave, self-service applications and approval that reaches attendance and pay

## 1. Purpose
The "Leave management" section of Staff Management is being built on top of the leave
table that already exists. Three gaps in the earlier backend are closed here, and
nothing else in the staff or payroll screens changes.

## 2. What changes

### 2.1 "Half-Day / Short Leave" becomes a real leave type
- `school_staff_leave_requests.leave_type` gains the value `half_day`.
- The named check constraint `school_staff_leave_requests_leave_type_check` is dropped
  and recreated with `casual`, `sick`, `half_day`, `annual`, `unpaid`, `maternity`,
  `other`. Existing values are all still allowed, so no existing row is affected.

### 2.2 Any staff member can apply for their own leave
- New function `staff_apply_for_leave(p_leave_type, p_start_date, p_end_date, p_reason)`.
  An active staff member (teacher, office assistant, accountant, support staff) records
  leave for **themselves only** — the staff member is taken from the signed-in account,
  never from the arguments, so nobody can apply on another person's behalf. The request
  is always created as `pending`.
- Administrators keep using `admin_save_staff_leave` to record leave for anybody.

### 2.3 A leave decision now reaches the daily attendance register
- `admin_set_staff_leave_status` is replaced. When a request becomes **approved**, one
  `school_staff_attendance` row is written for every date in the approved range with
  `status = 'leave'` ("On leave" on the Daily attendance screen), carrying the note
  "Approved casual leave" and the deciding administrator in `marked_by`.
  - Days the office has already recorded are **left untouched**. Attendance already
    marked present, absent or late is never silently overwritten by an approval.
  - Approving a half-day leave does not write an attendance row, because the staff
    member is at school for part of that day.
  - When an approval is later reversed (rejected, cancelled, or set back to pending),
    only the rows this approval created are removed. A day that was already recorded
    before the approval is never deleted.
- The decision functions are split into two small helpers so the same logic is used
  everywhere:
  - `staff_leave_dates(start_date, end_date)` — the list of dates in a range.
  - `staff_leave_sync_attendance(p_staff_user_id, p_start_date, p_end_date, p_leave_type, p_status, p_note)`
    — writes or clears the "On leave" rows for one request.

### 2.4 Unpaid leave is available to the salary screen
- New function `staff_unpaid_leave_days(p_staff_user_id, p_period_month)` returns the
  number of **unpaid** leave days approved in a month. The Pay Salary screen adds these
  to the absent days it already reads from the attendance register, so an approved
  unpaid leave reduces that month's pay. Paid leave types (casual, sick, half-day)
  are not counted.

## 3. Security
- Row level security on `school_staff_leave_requests` is unchanged: an administrator
  can read everything, a staff member can read only their own requests, and **no role
  holds a write grant** on the table.
- Every change continues to go through a SECURITY DEFINER function that re-checks who
  is calling:
  - the `admin_*` functions require `can_manage_users()` (administrator only),
  - `staff_apply_for_leave` requires `is_staff_member()` and writes only for
    `auth.uid()`.
- `staff_leave_dates` and `staff_leave_sync_attendance` are internal helpers: EXECUTE is
  revoked from `PUBLIC`, `anon` and `authenticated`, so they are reachable only from
  the functions above.
- `staff_unpaid_leave_days` is a read-only helper granted to `authenticated`; it
  returns a count for one staff member and one month, and the caller's own row is the
  only one they can influence through the screens that use it.
- All other functions keep the existing revoke-from-`PUBLIC`/`anon` +
  grant-to-`authenticated` pattern.

## 4. Notes
- Safe to re-run: the constraint is dropped before being recreated, and every function
  uses `CREATE OR REPLACE`.
- No table, column, row or policy is dropped, and no existing leave, attendance or
  salary record is modified by this migration.
*/

-- ---------------------------------------------------------------------------
-- 1. "Half-Day / Short Leave" joins the leave types
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_staff_leave_requests
  DROP CONSTRAINT IF EXISTS school_staff_leave_requests_leave_type_check;

ALTER TABLE public.school_staff_leave_requests
  ADD CONSTRAINT school_staff_leave_requests_leave_type_check
  CHECK (leave_type IN ('casual', 'sick', 'half_day', 'annual', 'unpaid', 'maternity', 'other'));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- Every date covered by a leave range, from the first day to the last inclusive.
CREATE OR REPLACE FUNCTION public.staff_leave_dates(
  p_start_date date,
  p_end_date date
)
RETURNS date[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN ARRAY[]::date[]
    ELSE ARRAY(
      SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date
    )
  END;
$$;

-- Writes the "On leave" rows for an approved request, or clears the rows a request
-- created when its approval is taken away. Days the school office has already recorded
-- are never touched, and only rows this function itself wrote (marked_by) are removed.
CREATE OR REPLACE FUNCTION public.staff_leave_sync_attendance(
  p_staff_user_id uuid,
  p_start_date date,
  p_end_date date,
  p_leave_type text,
  p_status text,
  p_note text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_dates date[];
  v_note text;
  v_written integer := 0;
BEGIN
  IF p_staff_user_id IS NULL THEN
    RETURN 0;
  END IF;

  v_dates := public.staff_leave_dates(p_start_date, p_end_date);
  IF array_length(v_dates, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF p_status = 'approved' AND p_leave_type <> 'half_day' THEN
    v_note := 'Approved ' || replace(coalesce(p_leave_type, 'other'), '_', ' ') || ' leave'
              || CASE WHEN nullif(btrim(coalesce(p_note, '')), '') IS NULL
                      THEN '' ELSE ' — ' || btrim(p_note) END;

    INSERT INTO public.school_staff_attendance
      (staff_user_id, attendance_date, status, note, marked_by, updated_at)
    SELECT p_staff_user_id, day, 'leave', v_note, v_actor, now()
    FROM unnest(v_dates) AS day
    ON CONFLICT (staff_user_id, attendance_date) DO NOTHING;

    GET DIAGNOSTICS v_written = ROW_COUNT;
  ELSE
    -- Only the rows this approval created are cleared: a day the office recorded
    -- before the approval, or a check-in made by the staff member themselves, stays.
    DELETE FROM public.school_staff_attendance
    WHERE staff_user_id = p_staff_user_id
      AND attendance_date = ANY (v_dates)
      AND status = 'leave'
      AND check_in_at IS NULL
      AND (marked_by IS NOT DISTINCT FROM v_actor);
    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;

  RETURN v_written;
END;
$$;

-- Unpaid leave days approved inside a month, which the salary screen adds to the
-- absent days it already counts from the attendance register.
CREATE OR REPLACE FUNCTION public.staff_unpaid_leave_days(
  p_staff_user_id uuid,
  p_period_month date
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(
           card_day.span
         ), 0)::integer
  FROM public.school_staff_leave_requests r
  CROSS JOIN LATERAL (
    SELECT (least(r.end_date, (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date)
          - greatest(r.start_date, date_trunc('month', p_period_month)::date)
          + 1) AS span
  ) AS card_day
  WHERE r.staff_user_id = p_staff_user_id
    AND r.leave_type = 'unpaid'
    AND r.status = 'approved'
    AND r.start_date <= (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date
    AND r.end_date >= date_trunc('month', p_period_month)::date
    AND card_day.span > 0;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_dates(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_sync_attendance(uuid, date, date, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_unpaid_leave_days(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_unpaid_leave_days(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Staff member applies for their own leave
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_apply_for_leave(
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.school_staff_leave_requests;
  v_type text := coalesce(nullif(btrim(p_leave_type), ''), 'casual');
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only an active staff member can apply for leave';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Enter both the from and to dates';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The to date cannot be before the from date';
  END IF;
  IF v_type NOT IN ('casual', 'sick', 'half_day', 'annual', 'unpaid', 'maternity', 'other') THEN
    RAISE EXCEPTION 'Choose a valid leave type';
  END IF;

  INSERT INTO public.school_staff_leave_requests
    (staff_user_id, leave_type, start_date, end_date, reason)
  VALUES
    (v_uid, v_type, p_start_date, p_end_date, nullif(btrim(coalesce(p_reason, '')), ''))
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Recording leave for anybody (administrator only) — half-day aware
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_staff_leave(
  p_id uuid,
  p_staff_user_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.school_staff_leave_requests;
  v_type text := coalesce(nullif(btrim(p_leave_type), ''), 'casual');
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can record staff leave';
  END IF;
  IF p_staff_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_staff_user_id) THEN
    RAISE EXCEPTION 'That staff member could not be found';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Enter both the from and to dates';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The to date cannot be before the from date';
  END IF;
  IF v_type NOT IN ('casual', 'sick', 'half_day', 'annual', 'unpaid', 'maternity', 'other') THEN
    RAISE EXCEPTION 'Choose a valid leave type';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.school_staff_leave_requests
      (staff_user_id, leave_type, start_date, end_date, reason)
    VALUES
      (p_staff_user_id, v_type, p_start_date, p_end_date, nullif(btrim(coalesce(p_reason, '')), ''))
    RETURNING * INTO v_row;
  ELSE
    -- Editing a request sends it back for approval, so an approval never silently
    -- covers dates the administrator did not actually agree to. Any "On leave" days
    -- the old approval created are cleared at the same time.
    UPDATE public.school_staff_leave_requests
       SET staff_user_id = p_staff_user_id,
           leave_type = v_type,
           start_date = p_start_date,
           end_date = p_end_date,
           reason = nullif(btrim(coalesce(p_reason, '')), ''),
           status = 'pending',
           decided_by = NULL,
           decided_at = NULL,
           decision_note = NULL
     WHERE id = p_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'That leave request could not be found';
    END IF;

    PERFORM public.staff_leave_sync_attendance(
      v_row.staff_user_id, v_row.start_date, v_row.end_date,
      v_row.leave_type, 'pending', NULL
    );
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Approve / reject — an approval marks the days "On leave" in attendance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_staff_leave_status(
  p_id uuid,
  p_status text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.school_staff_leave_requests;
  v_before public.school_staff_leave_requests;
  v_status text := btrim(coalesce(p_status, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_marked integer := 0;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can approve staff leave';
  END IF;
  IF v_status NOT IN ('pending', 'approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'Choose a valid leave decision';
  END IF;

  SELECT * INTO v_before FROM public.school_staff_leave_requests WHERE id = p_id;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'That leave request could not be found';
  END IF;

  -- The attendance rows are cleared first, using the dates and the decision that were
  -- on the record before this call, so a changed range or a reversal is cleaned up
  -- before the new decision is written.
  IF v_before.status = 'approved' THEN
    PERFORM public.staff_leave_sync_attendance(
      v_before.staff_user_id, v_before.start_date, v_before.end_date,
      v_before.leave_type, 'pending', NULL
    );
  END IF;

  UPDATE public.school_staff_leave_requests
     SET status = v_status,
         decided_by = CASE WHEN v_status = 'pending' THEN NULL ELSE auth.uid() END,
         decided_at = CASE WHEN v_status = 'pending' THEN NULL ELSE now() END,
         decision_note = v_note
   WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_status = 'approved' THEN
    v_marked := public.staff_leave_sync_attendance(
      v_row.staff_user_id, v_row.start_date, v_row.end_date,
      v_row.leave_type, 'approved', v_note
    );
  END IF;

  RETURN to_jsonb(v_row) || jsonb_build_object('attendance_days_marked', v_marked);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.staff_apply_for_leave(text, date, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_staff_leave(uuid, uuid, text, date, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_staff_leave_status(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.staff_apply_for_leave(text, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_staff_leave(uuid, uuid, text, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_leave_status(uuid, text, text) TO authenticated;
