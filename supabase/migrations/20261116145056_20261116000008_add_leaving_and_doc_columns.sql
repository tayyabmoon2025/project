/*
# Add Leaving Info, Submitted Doc, and Issued Doc columns to school_students

## New Columns (all nullable text, safe defaults)
### Leaving Info
- leaving_date (date) — when the student left the school
- leaving_reason (text) — reason for leaving (transfer, withdrawal, graduation, etc.)
- leaving_remarks (text) — additional notes about the departure

### Submitted Documents
- submitted_b_form (text) — status/notes of submitted B-Form
- submitted_previous_tc (text) — status/notes of previous school transfer certificate
- submitted_birth_certificate (text) — status/notes of birth certificate
- submitted_photos (text) — number/status of photos submitted
- submitted_other_docs (text) — any other documents submitted at admission

### Issued Documents
- issued_tc_number (text) — transfer certificate number issued by this school
- issued_tc_date (date) — date the TC was issued
- issued_character_certificate (text) — character certificate status/number
- issued_migration_certificate (text) — migration certificate status/number
- issued_other_docs (text) — any other documents issued by the school

## Security
- No changes to RLS policies or grants. New columns inherit existing table-level policies.
*/

ALTER TABLE school_students
  ADD COLUMN IF NOT EXISTS leaving_date date,
  ADD COLUMN IF NOT EXISTS leaving_reason text,
  ADD COLUMN IF NOT EXISTS leaving_remarks text,
  ADD COLUMN IF NOT EXISTS submitted_b_form text,
  ADD COLUMN IF NOT EXISTS submitted_previous_tc text,
  ADD COLUMN IF NOT EXISTS submitted_birth_certificate text,
  ADD COLUMN IF NOT EXISTS submitted_photos text,
  ADD COLUMN IF NOT EXISTS submitted_other_docs text,
  ADD COLUMN IF NOT EXISTS issued_tc_number text,
  ADD COLUMN IF NOT EXISTS issued_tc_date date,
  ADD COLUMN IF NOT EXISTS issued_character_certificate text,
  ADD COLUMN IF NOT EXISTS issued_migration_certificate text,
  ADD COLUMN IF NOT EXISTS issued_other_docs text;
