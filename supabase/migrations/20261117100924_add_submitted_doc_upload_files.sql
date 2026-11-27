/*
# Add submitted document upload columns

1. Purpose
- Let staff attach a JPG or PNG scan of each document submitted at admission
  (B-Form, previous school TC, birth certificate, photos, other documents).
- Each uploaded file is stored as an image data URL alongside the existing
  text status field, so the status ("Submitted / Pending / N/A") stays separate
  from the attached scan.

2. New Columns (all nullable text)
- submitted_b_form_file
- submitted_previous_tc_file
- submitted_birth_certificate_file
- submitted_photos_file
- submitted_other_docs_file

3. Security
- No RLS or grant changes. Columns inherit existing school_students policies.
*/

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS submitted_b_form_file text,
  ADD COLUMN IF NOT EXISTS submitted_previous_tc_file text,
  ADD COLUMN IF NOT EXISTS submitted_birth_certificate_file text,
  ADD COLUMN IF NOT EXISTS submitted_photos_file text,
  ADD COLUMN IF NOT EXISTS submitted_other_docs_file text;
