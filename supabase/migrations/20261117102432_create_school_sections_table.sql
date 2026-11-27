/*
# Add school_sections table for section management

1. Purpose
- Let the school record per-section details used by the Search Section screen:
  the class teacher assigned to a section and the section's student capacity.
- Sections are keyed by the (class_name, section_name) pair already used by
  student records.

2. New Table
- `school_sections`
- `id` (uuid, primary key)
- `class_name` (text, not null) — e.g. "Class 5"
- `section_name` (text, not null) — e.g. "B"
- `class_teacher` (text, nullable) — the assigned teacher's full name
- `capacity` (integer, nullable) — maximum students for the section
- `created_at` (timestamptz, default now())
- UNIQUE (class_name, section_name)

3. Security
- RLS enabled.
- Only staff (admin, teacher, office assistant, accountant) can read and manage
  sections, enforced via the existing public.is_staff() helper.
- Grants are scoped to authenticated, matching the app's sign-in model.
*/

CREATE TABLE IF NOT EXISTS public.school_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name text NOT NULL,
  section_name text NOT NULL,
  class_teacher text,
  capacity integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_name, section_name)
);

ALTER TABLE public.school_sections ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_sections TO authenticated;

DROP POLICY IF EXISTS "Staff can read sections" ON public.school_sections;
CREATE POLICY "Staff can read sections"
ON public.school_sections FOR SELECT
TO authenticated
USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can insert sections" ON public.school_sections;
CREATE POLICY "Staff can insert sections"
ON public.school_sections FOR INSERT
TO authenticated
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can update sections" ON public.school_sections;
CREATE POLICY "Staff can update sections"
ON public.school_sections FOR UPDATE
TO authenticated
USING (public.is_staff())
WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "Staff can delete sections" ON public.school_sections;
CREATE POLICY "Staff can delete sections"
ON public.school_sections FOR DELETE
TO authenticated
USING (public.is_staff());
