/*
# Create admission dropdown options table

1. New Table
- `school_admission_options` stores reusable dropdown options for the admission form.
- `id` (uuid, primary key)
- `category` (text) - which field the option belongs to: 'student_group', 'subject_group', or 'house'
- `label` (text) - the display value of the option
- `created_at` (timestamptz)

2. Security
- Enable RLS on `school_admission_options`.
- Grant CRUD to `anon, authenticated` so the single-tenant app can read and add options.
- Allow anon + authenticated CRUD because the data is intentionally shared/public.

3. Important notes
- A unique constraint on (category, label) prevents duplicate options.
- Seed data provides a few starting options for each category.
*/

CREATE TABLE IF NOT EXISTS public.school_admission_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  label text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (category, label)
);

ALTER TABLE public.school_admission_options ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_admission_options TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_admission_options" ON public.school_admission_options;
CREATE POLICY "anon_select_admission_options" ON public.school_admission_options FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_admission_options" ON public.school_admission_options;
CREATE POLICY "anon_insert_admission_options" ON public.school_admission_options FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_admission_options" ON public.school_admission_options;
CREATE POLICY "anon_update_admission_options" ON public.school_admission_options FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_admission_options" ON public.school_admission_options;
CREATE POLICY "anon_delete_admission_options" ON public.school_admission_options FOR DELETE
  TO anon, authenticated USING (true);

INSERT INTO public.school_admission_options (category, label) VALUES
  ('student_group', 'Group A'), ('student_group', 'Group B'), ('student_group', 'Group C'),
  ('subject_group', 'Science'), ('subject_group', 'Arts'), ('subject_group', 'Commerce'),
  ('house', 'Red House'), ('house', 'Blue House'), ('house', 'Green House'), ('house', 'Yellow House')
ON CONFLICT (category, label) DO NOTHING;
