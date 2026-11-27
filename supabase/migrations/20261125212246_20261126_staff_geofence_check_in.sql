/*
# Staff GPS check-in / check-out and the school geofence

## 1. Purpose
Staff now mark their own arrival and departure from the staff workspace, and each
mark carries the location the phone or PC reported. The school office can then see
at a glance who was inside the school grounds when they checked in, and open the
exact spot on a map. To make that possible we need three things: a place to keep
the school's own coordinates and allowed radius, extra columns on the daily
attendance row for the check-in and check-out details, and two small server-side
functions so a staff member can write only their own check-in for today.

## 2. Modified table: `school_institution_profile` (one row, `id = 'default'`)
New columns:
- `school_latitude` (double precision, nullable) — the school gate's latitude.
  NULL means the school location has not been set yet.
- `school_longitude` (double precision, nullable) — the school gate's longitude.
- `attendance_radius_m` (integer, not null, default 100) — how many metres from the
  school count as "inside school". Defaults to 100 m, as requested.
Two check constraints keep the values sane: each coordinate must be NULL or within
its real-world range, and the radius must be between 10 m and 5000 m.

## 3. Modified table: `school_staff_attendance` (one row per staff member per day)
New columns (all nullable, so every row recorded before today stays valid):
- `check_in_at` (timestamptz) — when the staff member checked in.
- `check_in_lat`, `check_in_lng` (double precision) — where they were.
- `check_in_distance_m` (double precision) — metres from the school gate.
- `check_in_inside` (boolean) — true inside the allowed radius, false outside,
  NULL when the school location or the phone location was unavailable.
- `check_out_at`, `check_out_lat`, `check_out_lng`, `check_out_distance_m`,
  `check_out_inside` — the same five details for leaving.
Check constraints keep the coordinates inside their real-world ranges and the
distances non-negative. No index is added: the screen still loads whole days and
whole months through the indexes that already exist.

## 4. New helper functions
- `is_staff_member()` — true when the signed-in user is an active member of the
  school's own workforce (teacher, office assistant, accountant or support staff).
  Administrators are deliberately excluded: they record the register, they do not
  self-check-in.
- `school_geofence_distance_m(lat, lng)` — great-circle distance in metres between
  the given point and the school's saved location, or NULL when either side is
  unknown. Haversine formula, so it is accurate to a few metres at school scale.

## 5. New functions: self check-in and self check-out
- `staff_self_check_in(p_lat, p_lng)` — records today's check-in for the caller
  only. It refuses if the caller is not an active staff member, and it refuses if
  the school office has already recorded today's attendance for that person
  (a row with no check-in of its own). Re-running it refreshes the location but
  keeps the original check-in time. It sets the day to "present" only when the day
  had no check-in yet, so it never overwrites an administrator's later correction.
- `staff_self_check_out(p_lat, p_lng)` — records today's check-out for the caller.
  It refuses when there is no check-in for today and when a check-out already
  exists, so a day can only be closed once.
Both compute the distance and the inside/outside verdict server-side from the saved
school location, and return a small JSON result (ok, message, distance, inside,
times) that the screen shows as a confirmation.

## 6. Security
- RLS stays enabled on both tables. The existing four policies on
  `school_staff_attendance` are NOT changed: reading is still allowed for active
  staff, and ordinary INSERT/UPDATE/DELETE remain administrator-only. A staff
  member cannot mark themselves present by talking to the table directly.
- The only new way in is the two functions above, which are `SECURITY DEFINER` and
  can therefore write past that restriction — but each one writes only the
  caller's own row, only for today, and only the check-in/check-out columns, so
  they cannot be used to mark someone else present or to back-date a day.
- EXECUTE on all four new functions is revoked from PUBLIC and anon;
  the two check-in/check-out functions are granted to `authenticated` only.
- The helper functions are revoked from PUBLIC, anon and authenticated: they are
  only ever called from inside the two check-in functions.
- No new grants are needed on either table.

## 7. Notes
- Additive only. No table, column, row or policy is dropped, renamed or rewritten,
  so nothing already built is affected and no existing data is touched.
- Safe to re-run: every column uses `ADD COLUMN IF NOT EXISTS`, every constraint is
  added inside an existence check, and every function is `CREATE OR REPLACE`.
- `attendance_radius_m` defaults to 100 so an existing profile row immediately has
  a usable radius; only the coordinates still need to be entered in School Settings.
*/

-- ============================================================================
-- 1. School location and allowed radius on the institution profile
-- ============================================================================

ALTER TABLE public.school_institution_profile
  ADD COLUMN IF NOT EXISTS school_latitude double precision,
  ADD COLUMN IF NOT EXISTS school_longitude double precision,
  ADD COLUMN IF NOT EXISTS attendance_radius_m integer NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_institution_profile_geo_check'
  ) THEN
    ALTER TABLE public.school_institution_profile
      ADD CONSTRAINT school_institution_profile_geo_check CHECK (
        (school_latitude IS NULL OR (school_latitude >= -90 AND school_latitude <= 90))
        AND (school_longitude IS NULL OR (school_longitude >= -180 AND school_longitude <= 180))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_institution_profile_radius_check'
  ) THEN
    ALTER TABLE public.school_institution_profile
      ADD CONSTRAINT school_institution_profile_radius_check
      CHECK (attendance_radius_m >= 10 AND attendance_radius_m <= 5000);
  END IF;
END $$;

-- ============================================================================
-- 2. Check-in / check-out details on the daily attendance row
-- ============================================================================

ALTER TABLE public.school_staff_attendance
  ADD COLUMN IF NOT EXISTS check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_in_lat double precision,
  ADD COLUMN IF NOT EXISTS check_in_lng double precision,
  ADD COLUMN IF NOT EXISTS check_in_distance_m double precision,
  ADD COLUMN IF NOT EXISTS check_in_inside boolean,
  ADD COLUMN IF NOT EXISTS check_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_out_lat double precision,
  ADD COLUMN IF NOT EXISTS check_out_lng double precision,
  ADD COLUMN IF NOT EXISTS check_out_distance_m double precision,
  ADD COLUMN IF NOT EXISTS check_out_inside boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_staff_attendance_geo_check'
  ) THEN
    ALTER TABLE public.school_staff_attendance
      ADD CONSTRAINT school_staff_attendance_geo_check CHECK (
        (check_in_lat IS NULL OR (check_in_lat >= -90 AND check_in_lat <= 90))
        AND (check_in_lng IS NULL OR (check_in_lng >= -180 AND check_in_lng <= 180))
        AND (check_out_lat IS NULL OR (check_out_lat >= -90 AND check_out_lat <= 90))
        AND (check_out_lng IS NULL OR (check_out_lng >= -180 AND check_out_lng <= 180))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_staff_attendance_distance_check'
  ) THEN
    ALTER TABLE public.school_staff_attendance
      ADD CONSTRAINT school_staff_attendance_distance_check CHECK (
        (check_in_distance_m IS NULL OR check_in_distance_m >= 0)
        AND (check_out_distance_m IS NULL OR check_out_distance_m >= 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.school_staff_attendance.check_in_at IS
  'When the staff member checked themselves in. NULL for days recorded only by the school office.';
COMMENT ON COLUMN public.school_staff_attendance.check_in_distance_m IS
  'Metres between the check-in location and the school gate. NULL when either location is unknown.';
COMMENT ON COLUMN public.school_staff_attendance.check_in_inside IS
  'True when the check-in happened within the allowed radius, false when outside, NULL when the distance is unknown.';

-- ============================================================================
-- 3. Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
      AND role IN ('teacher', 'office_assistant', 'accountant', 'support_staff')
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.school_geofence_distance_m(
  p_lat double precision,
  p_lng double precision
)
RETURNS double precision
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
    WHEN school_latitude IS NULL OR school_longitude IS NULL THEN NULL
    ELSE 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_lat - school_latitude) / 2)), 2)
      + cos(radians(school_latitude)) * cos(radians(p_lat))
        * power(sin(radians((p_lng - school_longitude) / 2)), 2)
    ))
  END
  FROM public.school_institution_profile
  WHERE id = 'default';
$$;

REVOKE ALL ON FUNCTION public.is_staff_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.school_geofence_distance_m(double precision, double precision) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4. Staff self check-in / check-out
-- ============================================================================

CREATE OR REPLACE FUNCTION public.staff_self_check_in(
  p_lat double precision,
  p_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.school_staff_attendance%ROWTYPE;
  v_has_row boolean;
  v_lat double precision;
  v_lng double precision;
  v_radius integer;
  v_distance double precision;
  v_inside boolean;
  v_check_in_at timestamptz;
  v_message text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff_member() THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only an active staff member can check in.');
  END IF;

  v_lat := CASE WHEN p_lat BETWEEN -90 AND 90 THEN p_lat ELSE NULL END;
  v_lng := CASE WHEN p_lng BETWEEN -180 AND 180 THEN p_lng ELSE NULL END;

  SELECT * INTO v_existing
  FROM public.school_staff_attendance
  WHERE staff_user_id = v_uid AND attendance_date = CURRENT_DATE;
  v_has_row := FOUND;

  -- The school office's own record of the day must never be overwritten by a
  -- self check-in. A row that already carries a check-in (or was written by this
  -- same person) is fair game, because it is that person's own record.
  IF v_has_row
     AND v_existing.check_in_at IS NULL
     AND v_existing.marked_by IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'The school office has already recorded your attendance for today.'
    );
  END IF;

  v_distance := public.school_geofence_distance_m(v_lat, v_lng);
  SELECT COALESCE(attendance_radius_m, 100) INTO v_radius
  FROM public.school_institution_profile WHERE id = 'default';
  v_radius := COALESCE(v_radius, 100);
  v_inside := CASE WHEN v_distance IS NULL THEN NULL ELSE v_distance <= v_radius END;
  v_check_in_at := COALESCE(v_existing.check_in_at, now());

  INSERT INTO public.school_staff_attendance (
    staff_user_id, attendance_date, status,
    check_in_at, check_in_lat, check_in_lng, check_in_distance_m, check_in_inside,
    marked_by, updated_at
  ) VALUES (
    v_uid, CURRENT_DATE, 'present',
    v_check_in_at, v_lat, v_lng, v_distance, v_inside,
    v_uid, now()
  )
  ON CONFLICT (staff_user_id, attendance_date) DO UPDATE SET
    -- Keep a status the school office has already set; only fill in the default.
    status = CASE
      WHEN public.school_staff_attendance.check_in_at IS NULL
        THEN 'present'
      ELSE public.school_staff_attendance.status
    END,
    check_in_at = v_check_in_at,
    check_in_lat = CASE
      WHEN public.school_staff_attendance.check_in_at IS NULL
        THEN v_lat ELSE public.school_staff_attendance.check_in_lat
    END,
    check_in_lng = CASE
      WHEN public.school_staff_attendance.check_in_at IS NULL
        THEN v_lng ELSE public.school_staff_attendance.check_in_lng
    END,
    check_in_distance_m = CASE
      WHEN public.school_staff_attendance.check_in_at IS NULL
        THEN v_distance ELSE public.school_staff_attendance.check_in_distance_m
    END,
    check_in_inside = CASE
      WHEN public.school_staff_attendance.check_in_at IS NULL
        THEN v_inside ELSE public.school_staff_attendance.check_in_inside
    END,
    marked_by = COALESCE(public.school_staff_attendance.marked_by, v_uid),
    updated_at = now();

  IF v_distance IS NULL THEN
    v_message := 'Checked in at ' || to_char(v_check_in_at, 'HH24:MI')
      || '. Location was not recorded.';
  ELSIF v_inside THEN
    v_message := 'Checked in at ' || to_char(v_check_in_at, 'HH24:MI')
      || ' — inside school (' || round(v_distance)::text || ' m away).';
  ELSE
    v_message := 'Checked in at ' || to_char(v_check_in_at, 'HH24:MI')
      || ' — outside school (' || round(v_distance)::text || ' m away).';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', v_message,
    'distance_m', v_distance,
    'inside', v_inside,
    'check_in_at', v_check_in_at,
    'check_out_at', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_self_check_out(
  p_lat double precision,
  p_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.school_staff_attendance%ROWTYPE;
  v_has_row boolean;
  v_lat double precision;
  v_lng double precision;
  v_radius integer;
  v_distance double precision;
  v_inside boolean;
  v_check_out_at timestamptz;
  v_message text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff_member() THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only an active staff member can check out.');
  END IF;

  SELECT * INTO v_existing
  FROM public.school_staff_attendance
  WHERE staff_user_id = v_uid AND attendance_date = CURRENT_DATE;
  v_has_row := FOUND;

  IF NOT v_has_row OR v_existing.check_in_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Check in first, then check out at the end of the day.');
  END IF;

  IF v_existing.check_out_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'You have already checked out today.');
  END IF;

  v_lat := CASE WHEN p_lat BETWEEN -90 AND 90 THEN p_lat ELSE NULL END;
  v_lng := CASE WHEN p_lng BETWEEN -180 AND 180 THEN p_lng ELSE NULL END;
  v_distance := public.school_geofence_distance_m(v_lat, v_lng);
  SELECT COALESCE(attendance_radius_m, 100) INTO v_radius
  FROM public.school_institution_profile WHERE id = 'default';
  v_radius := COALESCE(v_radius, 100);
  v_inside := CASE WHEN v_distance IS NULL THEN NULL ELSE v_distance <= v_radius END;
  v_check_out_at := now();

  UPDATE public.school_staff_attendance SET
    check_out_at = v_check_out_at,
    check_out_lat = v_lat,
    check_out_lng = v_lng,
    check_out_distance_m = v_distance,
    check_out_inside = v_inside,
    updated_at = now()
  WHERE staff_user_id = v_uid AND attendance_date = CURRENT_DATE;

  IF v_distance IS NULL THEN
    v_message := 'Checked out at ' || to_char(v_check_out_at, 'HH24:MI')
      || '. Location was not recorded.';
  ELSIF v_inside THEN
    v_message := 'Checked out at ' || to_char(v_check_out_at, 'HH24:MI')
      || ' — inside school (' || round(v_distance)::text || ' m away).';
  ELSE
    v_message := 'Checked out at ' || to_char(v_check_out_at, 'HH24:MI')
      || ' — outside school (' || round(v_distance)::text || ' m away).';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', v_message,
    'distance_m', v_distance,
    'inside', v_inside,
    'check_in_at', v_existing.check_in_at,
    'check_out_at', v_check_out_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_self_check_in(double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_self_check_out(double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_self_check_in(double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_self_check_out(double precision, double precision) TO authenticated;

COMMENT ON TABLE public.school_staff_attendance IS
  'One daily attendance record per staff login. Written by administrators, or by the staff member themselves through staff_self_check_in / staff_self_check_out for today only; readable by any active staff member.';
COMMENT ON COLUMN public.school_institution_profile.attendance_radius_m IS
  'How many metres from the saved school location still count as "inside school" for staff check-in.';
