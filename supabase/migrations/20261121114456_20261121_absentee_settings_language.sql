/*
# Absentee alert settings — the one chosen template language

## 1. Purpose
Absentee wording is saved per language (English and Urdu) in
`school_notice_templates`, but the school sends one language at a time. This
migration adds a single settings row that remembers which of the two templates is
currently chosen, so the choice survives a reload and is the same for every staff
account.

## 2. New table: school_absentee_settings
A one-row settings table.

| column | meaning |
| --- | --- |
| id | fixed row key, always `default` |
| language | the chosen absentee wording language (`English` or `Urdu`) |
| updated_at | when the choice was last changed |

## 3. Security
- Row level security is enabled.
- Staff (`is_staff()`) may read and update the row; there is nothing to insert or
  delete from the app because the migration seeds the single row.
- `anon` is granted nothing.

## 4. Notes
- The row is seeded with `English` only if it does not already exist, so a school
  that has already chosen Urdu keeps its choice on re-run.
- No existing table, column or row is changed.
*/

CREATE TABLE IF NOT EXISTS public.school_absentee_settings (
  id text PRIMARY KEY DEFAULT 'default',
  language text NOT NULL DEFAULT 'English',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_absentee_settings_language_check CHECK (language IN ('English', 'Urdu'))
);

INSERT INTO public.school_absentee_settings (id, language)
VALUES ('default', 'English')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.school_absentee_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_absentee_settings FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_absentee_settings TO authenticated;

DROP POLICY IF EXISTS "Staff can read absentee settings" ON public.school_absentee_settings;
CREATE POLICY "Staff can read absentee settings" ON public.school_absentee_settings FOR SELECT
TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "Staff can add absentee settings" ON public.school_absentee_settings;
CREATE POLICY "Staff can add absentee settings" ON public.school_absentee_settings FOR INSERT
TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Staff can update absentee settings" ON public.school_absentee_settings;
CREATE POLICY "Staff can update absentee settings" ON public.school_absentee_settings FOR UPDATE
TO authenticated USING (is_staff()) WITH CHECK (is_staff());
