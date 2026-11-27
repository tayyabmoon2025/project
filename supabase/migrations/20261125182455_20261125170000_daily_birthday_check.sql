/*
# Daily birthday check (students + staff)

1. Purpose
- Once a day, when a staff member (Administrator, Accountant or Teacher) opens the
  management system, the app checks whose birthday it is today.
- Each birthday person gets exactly ONE in-app portal notification per date, no matter
  how many staff sign in that day.
- The list of today's birthdays is returned to the app so it can show the
  "Today's Birthdays" popup with a one-click WhatsApp wish.

2. New column
- `user_profiles.date_of_birth` (date, optional)
  * Staff birthdays were not recorded anywhere before; this is where they now live.
  * Existing rows are left NULL, which simply means "no birthday recorded yet".

3. New table
- `school_birthday_wishes`
  * A small ledger that records the wish written for one person on one date.
  * `person_type` is 'student' or 'staff'.
  * A UNIQUE key on (person_type, person_id, wish_date) is what guarantees one wish
    per person per day even when several staff open the system on the same morning.

4. New functions
- `birthday_list_for(p_date)` — internal helper that builds the birthday list
  (name, role or class, and the best WhatsApp number) for the signed-in staff member.
  Not callable from the app: it exists only for the two functions below.
- `run_daily_birthday_check(p_date)` — records today's wishes (idempotent) and returns
  the birthday list. Staff only.
- `fetch_todays_birthdays(p_date)` — read-only birthday list for the navbar badge.
  Staff only.
- `admin_set_staff_birthday(p_user_id, p_date_of_birth)` — lets an administrator save
  a staff member's date of birth. Administrators only.

5. Who sees what
- Administrators and Accountants see every birthday: all active students and all staff.
- A Teacher sees the students in the classes assigned to them (matched on the class
  teacher name in `school_sections`), plus every colleague. If no class is assigned to
  that teacher, they see all students — matching the agreed behaviour.

6. Security
- RLS stays on. `school_birthday_wishes` is readable by staff only; it is written
  exclusively by the SECURITY DEFINER functions, so no write privilege is granted to
  the app at all (a staff account cannot forge or edit a wish row directly).
- `SELECT (date_of_birth)` is granted on `user_profiles`; the existing row policies
  still decide which rows are visible.
- Every new function revokes EXECUTE from PUBLIC and anon. The two app-facing
  functions and the admin function are granted to authenticated and then check the
  caller's role themselves.

7. Notes
- Nothing is deleted or altered: no drops, no type changes, no data loss.
- The WhatsApp message itself is composed in the browser, exactly like the existing
  fee, absence and homework reminders.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN date_of_birth date;
  END IF;
END $$;

GRANT SELECT (date_of_birth) ON public.user_profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.school_birthday_wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_type text NOT NULL CHECK (person_type IN ('student', 'staff')),
  person_id uuid NOT NULL,
  person_name text NOT NULL,
  wish_date date NOT NULL,
  message text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_birthday_wishes_person_day_key UNIQUE (person_type, person_id, wish_date)
);

ALTER TABLE public.school_birthday_wishes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_birthday_wishes TO authenticated;

DROP POLICY IF EXISTS "Staff can read birthday wishes" ON public.school_birthday_wishes;
CREATE POLICY "Staff can read birthday wishes"
ON public.school_birthday_wishes FOR SELECT
TO authenticated
USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.birthday_list_for(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me public.user_profiles%ROWTYPE;
  v_is_teacher boolean := false;
  v_classes text[];
  v_rows jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_me FROM public.user_profiles WHERE id = auth.uid();
  v_is_teacher := (v_me.role = 'teacher');

  IF v_is_teacher AND btrim(coalesce(v_me.full_name, '')) <> '' THEN
    SELECT array_agg(DISTINCT btrim(class_name)) INTO v_classes
    FROM public.school_sections
    WHERE lower(btrim(coalesce(class_teacher, ''))) = lower(btrim(v_me.full_name))
      AND btrim(coalesce(class_teacher, '')) <> ''
      AND btrim(coalesce(class_name, '')) <> '';
  END IF;

  SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'sortName'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'kind', 'student',
             'id', s.id,
             'name', s.full_name,
             'label', trim(both ' ' from concat_ws(' · ', nullif(btrim(coalesce(s.class_name, '')), ''), nullif(btrim(coalesce(s.section_name, '')), ''))),
             'phone', coalesce(
               nullif(btrim(coalesce(s.whatsapp_number, '')), ''),
               nullif(btrim(coalesce(s.messaging_number, '')), ''),
               nullif(btrim(coalesce(s.father_contact_number, '')), ''),
               nullif(btrim(coalesce(s.guardian_phone, '')), ''),
               nullif(btrim(coalesce(s.mother_number, '')), '')
             ),
             'sortName', s.full_name
           ) AS entry
    FROM public.school_students s
    WHERE s.status = 'active'
      AND s.date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM s.date_of_birth) = EXTRACT(MONTH FROM p_date)
      AND EXTRACT(DAY FROM s.date_of_birth) = EXTRACT(DAY FROM p_date)
      AND (
        NOT v_is_teacher
        OR v_classes IS NULL
        OR cardinality(v_classes) = 0
        OR btrim(coalesce(s.class_name, '')) = ANY (v_classes)
      )

    UNION ALL

    SELECT jsonb_build_object(
             'kind', 'staff',
             'id', u.id,
             'name', u.full_name,
             'label', CASE u.role
                        WHEN 'admin' THEN 'Administrator'
                        WHEN 'teacher' THEN 'Teacher'
                        WHEN 'accountant' THEN 'Accountant'
                        WHEN 'office_assistant' THEN 'Office Assistant'
                        ELSE initcap(replace(u.role, '_', ' '))
                      END,
             'phone', nullif(btrim(coalesce(u.mobile_number, '')), ''),
             'sortName', u.full_name
           ) AS entry
    FROM public.user_profiles u
    WHERE u.status = 'active'
      AND u.role IN ('admin', 'teacher', 'accountant', 'office_assistant')
      AND u.date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM u.date_of_birth) = EXTRACT(MONTH FROM p_date)
      AND EXTRACT(DAY FROM u.date_of_birth) = EXTRACT(DAY FROM p_date)
  ) listed;

  RETURN v_rows;
END $$;

REVOKE EXECUTE ON FUNCTION public.birthday_list_for(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_daily_birthday_check(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_day date := coalesce(p_date, current_date);
  v_person record;
  v_message text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR v_person IN
    SELECT DISTINCT s.id, s.full_name
    FROM public.school_students s
    WHERE s.status = 'active'
      AND s.date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM s.date_of_birth) = EXTRACT(MONTH FROM v_day)
      AND EXTRACT(DAY FROM s.date_of_birth) = EXTRACT(DAY FROM v_day)
  LOOP
    v_message := format('Happy Birthday %s! Warmest birthday wishes from The Ujala School family.', v_person.full_name);

    INSERT INTO public.school_birthday_wishes (person_type, person_id, person_name, wish_date, message, created_by)
    VALUES ('student', v_person.id, v_person.full_name, v_day, v_message, auth.uid())
    ON CONFLICT (person_type, person_id, wish_date) DO NOTHING;

    INSERT INTO public.school_portal_notifications (student_id, notification_type, title, body, attendance_date, created_by)
    VALUES (v_person.id, 'birthday', 'Happy Birthday!', v_message, v_day, auth.uid())
    ON CONFLICT (student_id, notification_type, attendance_date) DO NOTHING;
  END LOOP;

  FOR v_person IN
    SELECT u.id, u.full_name
    FROM public.user_profiles u
    WHERE u.status = 'active'
      AND u.role IN ('admin', 'teacher', 'accountant', 'office_assistant')
      AND u.date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM u.date_of_birth) = EXTRACT(MONTH FROM v_day)
      AND EXTRACT(DAY FROM u.date_of_birth) = EXTRACT(DAY FROM v_day)
  LOOP
    v_message := format('Happy Birthday %s! Warmest birthday wishes from The Ujala School family.', v_person.full_name);

    INSERT INTO public.school_birthday_wishes (person_type, person_id, person_name, wish_date, message, created_by)
    VALUES ('staff', v_person.id, v_person.full_name, v_day, v_message, auth.uid())
    ON CONFLICT (person_type, person_id, wish_date) DO NOTHING;
  END LOOP;

  RETURN public.birthday_list_for(v_day);
END $$;

REVOKE EXECUTE ON FUNCTION public.run_daily_birthday_check(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_birthday_check(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.fetch_todays_birthdays(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN public.birthday_list_for(coalesce(p_date, current_date));
END $$;

REVOKE EXECUTE ON FUNCTION public.fetch_todays_birthdays(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_todays_birthdays(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_staff_birthday(
  p_user_id uuid,
  p_date_of_birth date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can change staff birthdays';
  END IF;

  SELECT role INTO v_role FROM public.user_profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'That account no longer exists';
  END IF;

  IF v_role IN ('parent', 'student') THEN
    RAISE EXCEPTION 'That account type is not allowed';
  END IF;

  UPDATE public.user_profiles
  SET date_of_birth = p_date_of_birth
  WHERE id = p_user_id;

  RETURN jsonb_build_object('user_id', p_user_id, 'date_of_birth', p_date_of_birth);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_staff_birthday(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_birthday(uuid, date) TO authenticated;
