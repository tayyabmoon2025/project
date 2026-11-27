/*
# Create other information entries table

1. New Table
- `school_other_information` stores free-text notes, each tagged with an Information Type.
- `id` (uuid, primary key)
- `information_type` (text, not null) - the chosen type, e.g. from the Information Type dropdown
- `notes` (text, not null, default '') - the long-form note text
- `created_at` (timestamptz) - when the entry was first saved
- `updated_at` (timestamptz) - when the entry was last edited

2. Security
- Enable RLS on `school_other_information`.
- Grant CRUD to `anon, authenticated` so the single-tenant app can read, add, edit and delete entries.
- Allow anon + authenticated CRUD because the data is intentionally shared within the school.

3. Important notes
- Information Type options are stored in `school_admission_options` under the category 'information_type'.
*/

CREATE TABLE IF NOT EXISTS public.school_other_information (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  information_type text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.school_other_information ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_other_information TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_other_information" ON public.school_other_information;
CREATE POLICY "anon_select_other_information" ON public.school_other_information FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_other_information" ON public.school_other_information;
CREATE POLICY "anon_insert_other_information" ON public.school_other_information FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_other_information" ON public.school_other_information;
CREATE POLICY "anon_update_other_information" ON public.school_other_information FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_other_information" ON public.school_other_information;
CREATE POLICY "anon_delete_other_information" ON public.school_other_information FOR DELETE
  TO anon, authenticated USING (true);
