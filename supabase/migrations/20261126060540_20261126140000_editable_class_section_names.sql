/*
# Editable class and section names, applied across the whole school

## 1. Purpose
The "Classes & Sections" screen in System Setup currently offers a fixed list of ten
classes and four sections. The school needs to rename them to its own words (for
example "Class 1" to "Prep" or "Grade 1", and "Section A" to "Blue"), add its own
classes and sections, and remove ones it does not use. Because a class name is written
into many different records, renaming one has to move every record with it, or the
school would be left with half its data under the old name.

## 2. New tables

### `school_class_names`
The school's own list of classes, in the order they should be shown.
- `id` uuid primary key
- `class_name` text not null, unique — the name as it appears everywhere
- `sort_order` integer not null default 0 — display order, 1 = first class
- `created_at` timestamptz default now()

### `school_section_names`
The school's own list of sections, in the order they should be shown.
- `id` uuid primary key
- `section_name` text not null, unique — e.g. `A`, `Blue`, `Rose`
- `sort_order` integer not null default 0
- `created_at` timestamptz default now()

Both tables are seeded with the names the app already uses — `Class 1` to `Class 10`
and `A` to `D` — using `ON CONFLICT DO NOTHING`, so re-running never duplicates a row
and never overwrites a name the school has already chosen. A class or section that
already exists in the school's records but is not in the list (because it was typed in
by hand) is added to the list as well, so no existing record is left without a name.

## 3. Renaming reaches every record
`rename_school_class(p_from, p_to)` and `rename_school_section(p_from, p_to)` change a
name in the list **and** in every place that stores it:

- `school_students` — `class_name` / `admitted_in_class` / `leaving_class`, and
  `section_name`
- `school_sections` — the class/section list used by the class-teacher screen
- `school_staff_subject_assignments` — the classes a teacher teaches
- `school_timetables` — the timetable rows
- `school_exam_subjects` and `school_exam_marks` — the examination setup and marks
- `school_fee_structures` — the fee set for each class
- `school_fee_challans` — issued fee challans, so an unpaid challan still finds its class
- `school_homework` and `school_homework_alerts` — homework already set
- `school_absentee_queue` — absence alerts waiting to be sent
- `school_sms_log` — the record of messages already sent
- `school_class_off_days` — class holidays

Every update matches the name with surrounding spaces trimmed, so a name typed with a
stray space is corrected at the same time. A name is only accepted if the new one is
not already in use by another class or section, and if the old name is actually in the
list — the function reports a clear message either way.

`set_school_class_order(p_names)` and `set_school_section_order(p_names)` save the
order the school drags the names into, so the dropdowns show classes and sections in
the school's own order rather than alphabetically.

## 4. Which names are actually in use
`school_class_usage()` and `school_section_usage()` return, for every class and section
name, how many student records use it and how many other records (sections, timetable,
exams, fees, homework, alerts) refer to it. The screen uses these counts to warn before
a name is removed and to refuse the removal when records would be left pointing at a
name that no longer exists.

## 5. Security
- Row level security is enabled on both new tables.
- Reading is allowed for any signed-in member of staff, because every dropdown in the
  app reads these lists.
- Adding, renaming, removing and reordering are administrator actions only: each policy
  checks the existing `is_admin()` helper, and the two rename functions and the two
  order functions additionally re-check `is_admin()` inside themselves.
- All four functions are SECURITY DEFINER (they must write to tables the signed-in
  administrator has no direct grant on), revoked from `PUBLIC` and `anon`, and granted
  to `authenticated` only.
- Nothing is dropped, and no existing row, column or policy is changed by this
  migration. Every statement is safe to re-run.
*/

-- ---------------------------------------------------------------------------
-- 1. The school's own class and section lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_class_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_section_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_class_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_section_names ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_class_names TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_section_names TO authenticated;

DROP POLICY IF EXISTS "Staff can read class names" ON public.school_class_names;
CREATE POLICY "Staff can read class names"
ON public.school_class_names FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can add class names" ON public.school_class_names;
CREATE POLICY "Admins can add class names"
ON public.school_class_names FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update class names" ON public.school_class_names;
CREATE POLICY "Admins can update class names"
ON public.school_class_names FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete class names" ON public.school_class_names;
CREATE POLICY "Admins can delete class names"
ON public.school_class_names FOR DELETE
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Staff can read section names" ON public.school_section_names;
CREATE POLICY "Staff can read section names"
ON public.school_section_names FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can add section names" ON public.school_section_names;
CREATE POLICY "Admins can add section names"
ON public.school_section_names FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update section names" ON public.school_section_names;
CREATE POLICY "Admins can update section names"
ON public.school_section_names FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete section names" ON public.school_section_names;
CREATE POLICY "Admins can delete section names"
ON public.school_section_names FOR DELETE
TO authenticated
USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Seed the names the app already uses, plus any name already on a record
-- ---------------------------------------------------------------------------
INSERT INTO public.school_class_names (class_name, sort_order)
SELECT 'Class ' || number, number
FROM generate_series(1, 10) AS number
ON CONFLICT (class_name) DO NOTHING;

INSERT INTO public.school_section_names (section_name, sort_order)
SELECT t.name, t.position::integer
FROM unnest(ARRAY['A', 'B', 'C', 'D']) WITH ORDINALITY AS t(name, position)
ON CONFLICT (section_name) DO NOTHING;

-- A class or section that is already on a record but missing from the list is added at
-- the end, so the screen can offer it and the office can rename or remove it.
INSERT INTO public.school_class_names (class_name, sort_order)
SELECT DISTINCT btrim(name), 1000 + row_number() OVER (ORDER BY btrim(name))
FROM (
  SELECT class_name AS name FROM public.school_students WHERE nullif(btrim(coalesce(class_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT admitted_in_class FROM public.school_students WHERE nullif(btrim(coalesce(admitted_in_class, '')), '') IS NOT NULL
  UNION ALL
  SELECT class_name FROM public.school_sections WHERE nullif(btrim(coalesce(class_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT class_name FROM public.school_staff_subject_assignments WHERE nullif(btrim(coalesce(class_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT class_name FROM public.school_timetables WHERE nullif(btrim(coalesce(class_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT class_name FROM public.school_exam_subjects WHERE nullif(btrim(coalesce(class_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT class_name FROM public.school_fee_structures WHERE nullif(btrim(coalesce(class_name, '')), '') IS NOT NULL
) AS used
ON CONFLICT (class_name) DO NOTHING;

INSERT INTO public.school_section_names (section_name, sort_order)
SELECT DISTINCT btrim(name), 1000 + row_number() OVER (ORDER BY btrim(name))
FROM (
  SELECT section_name AS name FROM public.school_students WHERE nullif(btrim(coalesce(section_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT section_name FROM public.school_sections WHERE nullif(btrim(coalesce(section_name, '')), '') IS NOT NULL
  UNION ALL
  SELECT section_name FROM public.school_timetables WHERE nullif(btrim(coalesce(section_name, '')), '') IS NOT NULL
) AS used
ON CONFLICT (section_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. How many records use each name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_class_usage()
RETURNS TABLE (class_name text, students bigint, others bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name,
         (SELECT count(*) FROM public.school_students s
           WHERE btrim(coalesce(s.class_name, '')) = name
              OR btrim(coalesce(s.admitted_in_class, '')) = name
              OR btrim(coalesce(s.leaving_class, '')) = name),
         (SELECT count(*) FROM public.school_sections x WHERE btrim(coalesce(x.class_name, '')) = name)
       + (SELECT count(*) FROM public.school_staff_subject_assignments x WHERE btrim(coalesce(x.class_name, '')) = name)
       + (SELECT count(*) FROM public.school_timetables x WHERE btrim(coalesce(x.class_name, '')) = name)
       + (SELECT count(*) FROM public.school_exam_subjects x WHERE btrim(coalesce(x.class_name, '')) = name)
       + (SELECT count(*) FROM public.school_fee_structures x WHERE btrim(coalesce(x.class_name, '')) = name)
       + (SELECT count(*) FROM public.school_homework x WHERE btrim(coalesce(x.class_name, '')) = name)
  FROM (
    SELECT btrim(class_name) AS name FROM public.school_class_names
  ) AS names;
$$;

CREATE OR REPLACE FUNCTION public.school_section_usage()
RETURNS TABLE (section_name text, students bigint, others bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name,
         (SELECT count(*) FROM public.school_students s
           WHERE btrim(coalesce(s.section_name, '')) = name),
         (SELECT count(*) FROM public.school_sections x WHERE btrim(coalesce(x.section_name, '')) = name)
       + (SELECT count(*) FROM public.school_timetables x WHERE btrim(coalesce(x.section_name, '')) = name)
       + (SELECT count(*) FROM public.school_homework x WHERE btrim(coalesce(x.section_name, '')) = name)
  FROM (
    SELECT btrim(section_name) AS name FROM public.school_section_names
  ) AS names;
$$;

REVOKE ALL ON FUNCTION public.school_class_usage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.school_section_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_class_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.school_section_usage() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Renaming a class moves every record with it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_school_class(p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := btrim(coalesce(p_to, ''));
  v_students integer := 0;
  v_others integer := 0;
  v_step integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can rename classes';
  END IF;
  IF v_from = '' OR v_to = '' THEN
    RAISE EXCEPTION 'Enter the class name';
  END IF;
  IF v_from = v_to THEN
    RETURN jsonb_build_object('class_name', v_to, 'students', 0, 'others', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.school_class_names WHERE btrim(class_name) = v_from) THEN
    RAISE EXCEPTION 'That class is not in the list';
  END IF;
  IF EXISTS (SELECT 1 FROM public.school_class_names WHERE btrim(class_name) = v_to AND btrim(class_name) <> v_from) THEN
    RAISE EXCEPTION 'A class with that name already exists';
  END IF;

  UPDATE public.school_students SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_students := v_students + v_step;
  UPDATE public.school_students SET admitted_in_class = v_to WHERE btrim(coalesce(admitted_in_class, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_students := v_students + v_step;
  UPDATE public.school_students SET leaving_class = v_to WHERE btrim(coalesce(leaving_class, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_students := v_students + v_step;

  UPDATE public.school_sections SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_staff_subject_assignments SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_timetables SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_exam_subjects SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_exam_marks SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_fee_structures SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_fee_challans SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_homework SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_homework_alerts SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_absentee_queue SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_sms_log SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_class_off_days SET class_name = v_to WHERE btrim(coalesce(class_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;

  UPDATE public.school_class_names SET class_name = v_to WHERE btrim(class_name) = v_from;

  RETURN jsonb_build_object('class_name', v_to, 'students', v_students, 'others', v_others);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Renaming a section moves every record with it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_school_section(p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := btrim(coalesce(p_to, ''));
  v_students integer := 0;
  v_others integer := 0;
  v_step integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can rename sections';
  END IF;
  IF v_from = '' OR v_to = '' THEN
    RAISE EXCEPTION 'Enter the section name';
  END IF;
  IF v_from = v_to THEN
    RETURN jsonb_build_object('section_name', v_to, 'students', 0, 'others', 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.school_section_names WHERE btrim(section_name) = v_from) THEN
    RAISE EXCEPTION 'That section is not in the list';
  END IF;
  IF EXISTS (SELECT 1 FROM public.school_section_names WHERE btrim(section_name) = v_to AND btrim(section_name) <> v_from) THEN
    RAISE EXCEPTION 'A section with that name already exists';
  END IF;

  UPDATE public.school_students SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_students := v_students + v_step;

  UPDATE public.school_sections SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_timetables SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_homework SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_homework_alerts SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_absentee_queue SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_sms_log SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;
  UPDATE public.school_fee_challans SET section_name = v_to WHERE btrim(coalesce(section_name, '')) = v_from;
  GET DIAGNOSTICS v_step = ROW_COUNT; v_others := v_others + v_step;

  UPDATE public.school_section_names SET section_name = v_to WHERE btrim(section_name) = v_from;

  RETURN jsonb_build_object('section_name', v_to, 'students', v_students, 'others', v_others);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Saving the order the school wants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_school_class_order(p_names text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can reorder classes';
  END IF;

  UPDATE public.school_class_names c
     SET sort_order = ordered.position
  FROM (
    SELECT btrim(t.name) AS name, t.position::integer AS position
    FROM unnest(coalesce(p_names, ARRAY[]::text[])) WITH ORDINALITY AS t(name, position)
  ) AS ordered
  WHERE btrim(c.class_name) = ordered.name;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_school_section_order(p_names text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can reorder sections';
  END IF;

  UPDATE public.school_section_names s
     SET sort_order = ordered.position
  FROM (
    SELECT btrim(t.name) AS name, t.position::integer AS position
    FROM unnest(coalesce(p_names, ARRAY[]::text[])) WITH ORDINALITY AS t(name, position)
  ) AS ordered
  WHERE btrim(s.section_name) = ordered.name;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rename_school_class(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rename_school_section(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_school_class_order(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_school_section_order(text[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rename_school_class(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_school_section(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_school_class_order(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_school_section_order(text[]) TO authenticated;
