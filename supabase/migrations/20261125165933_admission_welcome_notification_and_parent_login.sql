/*
# Admission welcome notification + parent portal login

1. Purpose
- When a new admission is saved, two things now happen automatically:
  a. A welcome notice is written to the parent's portal notification list.
  b. A parent portal login is created (or reused) and linked to the new student,
     so the family can sign in and see their child's attendance, homework and fees.

2. New functions
- `create_admission_notification(p_student_id uuid)`
  * Returns the notification id (uuid).
  * Staff only (`is_staff()`: admin, teacher, office assistant, accountant).
  * Writes one row into `school_portal_notifications` with
    `notification_type = 'admission'` and the message:
    "Congratulations! Your child <name> has been admitted to Class <class> at The Ujala School."
  * Idempotent per student: if an admission notice already exists for that student,
    the existing row is refreshed instead of inserting a duplicate.
- `admin_ensure_parent_login(p_username, p_password, p_full_name, p_student_id, p_mobile)`
  * Returns jsonb: { created: boolean, user_id: uuid, username: text }.
  * Administrators only (`can_manage_users()`), matching every other account-creating
    function in this project.
  * If the username already belongs to a parent account (a brother or sister already
    admitted from the same guardian number), that existing account is reused and
    `created` is false — no second account and no password reset happens.
  * If the username belongs to any other account type, the call fails with
    'Username already taken' so the caller can fall back gracefully.
  * Creates the login through the existing `admin_provision_account()` function, so
    the auth rows are written exactly the same way as every other account.
  * Links the parent to the student in `parent_student_links` (idempotent).

3. Security
- No table changes, no column changes, no data is deleted or altered.
- No new RLS policies are required: both functions are SECURITY DEFINER and do their
  own authorisation check before touching any row.
- `EXECUTE` is revoked from PUBLIC and anon on both functions and granted to
  authenticated only. The permission check inside each function decides who may
  actually use it.
- `parent_student_links` keeps its existing policies untouched, so nothing about who
  can read a family link changes.

4. Notes
- Nothing is stored about the WhatsApp message itself; the message is composed and
  sent from the school's browser, exactly like the existing fee and absence reminders.
- The parent login is created only when the admission carries a usable guardian
  contact number. When there is no number, the admission still saves normally.
*/

CREATE OR REPLACE FUNCTION public.create_admission_notification(
  p_student_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_student public.school_students%ROWTYPE;
  v_class text;
  v_title text := 'Admission confirmed';
  v_body text;
  v_id uuid;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_student FROM public.school_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That student record no longer exists';
  END IF;

  v_class := coalesce(
    nullif(btrim(coalesce(v_student.admitted_in_class, '')), ''),
    nullif(btrim(coalesce(v_student.class_name, '')), ''),
    'their new class'
  );
  v_class := regexp_replace(v_class, '^class\s+', '', 'i');

  v_body := format(
    'Congratulations! Your child %s has been admitted to Class %s at The Ujala School.',
    v_student.full_name,
    v_class
  );

  SELECT id INTO v_id
  FROM public.school_portal_notifications
  WHERE student_id = p_student_id
    AND notification_type = 'admission'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.school_portal_notifications
    SET title = v_title,
        body = v_body,
        created_by = auth.uid(),
        created_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, created_by
  )
  VALUES (
    p_student_id, 'admission', v_title, v_body, NULL, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_admission_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admission_notification(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ensure_parent_login(
  p_username text,
  p_password text,
  p_full_name text,
  p_student_id uuid,
  p_mobile text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  v_clean text := lower(btrim(coalesce(p_username, '')));
  v_existing_id uuid;
  v_existing_role text;
  v_user_id uuid;
  v_created boolean := false;
BEGIN
  IF NOT public.can_manage_users() THEN
    RAISE EXCEPTION 'Only administrators can create accounts';
  END IF;

  IF length(v_clean) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters';
  END IF;

  IF p_student_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.school_students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'That student record no longer exists';
  END IF;

  SELECT id, role INTO v_existing_id, v_existing_role
  FROM public.user_profiles
  WHERE lower(username) = v_clean
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_role <> 'parent' THEN
      RAISE EXCEPTION 'Username already taken';
    END IF;
    v_user_id := v_existing_id;
  ELSE
    v_user_id := public.admin_provision_account(
      v_clean, p_password, p_full_name, 'parent', NULL, p_mobile
    );
    v_created := true;
  END IF;

  INSERT INTO public.parent_student_links (parent_user_id, student_id)
  VALUES (v_user_id, p_student_id)
  ON CONFLICT (parent_user_id, student_id) DO NOTHING;

  RETURN jsonb_build_object('created', v_created, 'user_id', v_user_id, 'username', v_clean);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_ensure_parent_login(text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ensure_parent_login(text, text, text, uuid, text) TO authenticated;
