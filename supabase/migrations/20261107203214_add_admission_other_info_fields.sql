/*
# Add Other Info fields to student records

1. Modified Table
- `school_students` gains the fields captured in the admission form's Other Info tab:
  - `current_address` (text) - the family's current residential address
  - `permanent_address` (text) - the permanent home address
  - `father_contact_number` (text) - the father's contact number
  - `messaging_number` (text) - the number used for SMS and messaging
  - `father_profession` (text) - chosen from the Father's Profession dropdown
  - `guardian_relationship` (text) - how the guardian is related to the student
  - `guardian_cnic` (text) - the guardian's national identity card number
  - `tuition_fee` (numeric) - the monthly tuition fee for the student
  - `fee_concession_percentage` (numeric) - discount on tuition as a percentage
  - `fee_concession_amount` (numeric) - discount on tuition as an amount
  - `fine_exempt` (boolean, default false) - whether late fines are waived for this student

2. Dropdown Options
- Starter options are added to `school_admission_options` for the categories 'father_profession' and 'mother_tongue'. Staff can add more with the plus buttons.

3. Security
- No new tables are created. Existing access rules on `school_students` and `school_admission_options` already cover the new columns.

4. Important notes
- All statements are idempotent, so re-running this migration is safe.
- No existing data is changed or removed.
*/

ALTER TABLE public.school_students
  ADD COLUMN IF NOT EXISTS current_address text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS father_contact_number text,
  ADD COLUMN IF NOT EXISTS messaging_number text,
  ADD COLUMN IF NOT EXISTS father_profession text,
  ADD COLUMN IF NOT EXISTS guardian_relationship text,
  ADD COLUMN IF NOT EXISTS guardian_cnic text,
  ADD COLUMN IF NOT EXISTS tuition_fee numeric(12, 2),
  ADD COLUMN IF NOT EXISTS fee_concession_percentage numeric(5, 2),
  ADD COLUMN IF NOT EXISTS fee_concession_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS fine_exempt boolean NOT NULL DEFAULT false;

INSERT INTO public.school_admission_options (category, label) VALUES
  ('father_profession', 'Business'), ('father_profession', 'Teacher'), ('father_profession', 'Doctor'),
  ('father_profession', 'Engineer'), ('father_profession', 'Government Employee'), ('father_profession', 'Farmer'),
  ('mother_tongue', 'Urdu'), ('mother_tongue', 'Punjabi'), ('mother_tongue', 'Sindhi'),
  ('mother_tongue', 'Pashto'), ('mother_tongue', 'Balochi'), ('mother_tongue', 'English')
ON CONFLICT (category, label) DO NOTHING;
