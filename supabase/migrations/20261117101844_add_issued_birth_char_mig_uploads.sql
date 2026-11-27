/*
# Add issued Birth Certificate and upload files for Character/Migration certificates

1. Purpose
- Add a Birth Certificate entry to the "Issued Doc" tab with a JPG/PNG scan.
- Add JPG/PNG upload scans to the existing Character Certificate and Migration
  Certificate entries (which currently only have status/notes text).

2. New Columns (all nullable text)
- issued_birth_certificate
- issued_birth_certificate_file
- issued_character_certificate_file
- issued_migration_certificate_file

3. Security
- No RLS or grant changes. Columns inherit existing school_students policies.
*/

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS issued_birth_certificate text,
  ADD COLUMN IF NOT EXISTS issued_birth_certificate_file text,
  ADD COLUMN IF NOT EXISTS issued_character_certificate_file text,
  ADD COLUMN IF NOT EXISTS issued_migration_certificate_file text;
