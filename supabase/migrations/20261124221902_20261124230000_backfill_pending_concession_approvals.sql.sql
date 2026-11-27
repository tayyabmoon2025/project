/*
# Backfill pending concession approval status

## Purpose
Students who were saved with an approval-required concession category (orphan,
scholarship, staff) before the principal sign-off feature was introduced have
`concession_approval_status` set to NULL. The Concession Approvals panel only
shows students whose status is non-NULL, so these concessions were invisible to
the principal — they never appeared in the Pending queue and could never be
approved or rejected.

## Changes
1. **Data backfill**: For every student whose `fee_concession_category` is one
   of the approval-required categories (orphan, scholarship, staff) and whose
   `concession_approval_status` is NULL, set the status to `'pending'`.
   Students with non-approval categories (concession, discount, write_off, other)
   are left alone — their NULL status is correct (no approval needed).
2. Students who already have a non-NULL status (pending/approved/rejected) are
   not touched.

## Security
- No schema changes, no new tables, no RLS policy changes.
- This is a one-time data correction only.
- The `school_students` table already has RLS enabled and the existing policies
  remain unchanged.
*/

UPDATE school_students
SET concession_approval_status = 'pending'
WHERE fee_concession_category IN ('orphan', 'scholarship', 'staff')
  AND concession_approval_status IS NULL;
