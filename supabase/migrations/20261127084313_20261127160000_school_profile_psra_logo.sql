/*
# Registration authority (PSRA) logo on the school profile

## 1. Purpose
Printed documents carry the school's own emblem on the left. Schools in Punjab also show
the emblem of the authority that registered them — the Punjab Schools Registration
Authority (PSRA) — on the right of the letterhead. This migration gives the school
profile a place to keep that second logo, so it can be uploaded once in School Settings
and drawn automatically on every official letterhead.

## 2. What is added

### New column on `school_institution_profile`
- `psra_logo_url` (text, NOT NULL, default empty)
  The authority logo, stored as a data URL exactly like `logo_url`, so a printed sheet
  needs no network request and the Word export can read the image bytes directly.
  An empty string means no authority logo has been uploaded, and the letterhead simply
  leaves that corner blank.

## 3. Security
- No change. The table already has RLS enabled: staff may read the profile, only an
  administrator may write it, and the column is written through the same profile save
  the other fields use. No grants are widened.

## 4. Notes
1. The column has a default, so every existing row and any direct INSERT is valid without
   naming it.
2. Re-running this migration is safe — the column is added with IF NOT EXISTS.
*/

ALTER TABLE public.school_institution_profile
  ADD COLUMN IF NOT EXISTS psra_logo_url text NOT NULL DEFAULT '';
