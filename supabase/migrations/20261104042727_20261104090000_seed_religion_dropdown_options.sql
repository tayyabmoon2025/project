/*
# Seed religion dropdown options

1. Modified data
- Inserts initial religion options into `school_admission_options` for the new Religion dropdown.
- Options: Islam, Hinduism, Christianity, Sikhism, Buddhism, Other.

2. Security
- No schema changes. Existing RLS policies and grants apply.

3. Important notes
- Uses ON CONFLICT DO NOTHING so re-running is safe.
*/

INSERT INTO public.school_admission_options (category, label) VALUES
  ('religion', 'Islam'),
  ('religion', 'Hinduism'),
  ('religion', 'Christianity'),
  ('religion', 'Sikhism'),
  ('religion', 'Buddhism'),
  ('religion', 'Other')
ON CONFLICT (category, label) DO NOTHING;
