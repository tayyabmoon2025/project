/*
# Add issued DMC, Provisional and Original certificate fields

1. Purpose
- Extend the "Issued Doc" tab with three additional documents the school may
  issue to a leaving student: DMC (detailed marks certificate), a provisional
  certificate, and the original certificate.
- Each has a status/notes text field plus an uploaded JPG/PNG scan.

2. New Columns (all nullable text)
- issued_dmc
- issued_dmc_file
- issued_provisional_certificate
- issued_provisional_certificate_file
- issued_original_certificate
- issued_original_certificate_file

3. Security
- No RLS or grant changes. Columns inherit existing school_students policies.
*/

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS issued_dmc text,
  ADD COLUMN IF NOT EXISTS issued_dmc_file text,
  ADD COLUMN IF NOT EXISTS issued_provisional_certificate text,
  ADD COLUMN IF NOT EXISTS issued_provisional_certificate_file text,
  ADD COLUMN IF NOT EXISTS issued_original_certificate text,
  ADD COLUMN IF NOT EXISTS issued_original_certificate_file text;
