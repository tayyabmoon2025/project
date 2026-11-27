/*
# Live classes — pin a request to the teacher who made it

## 1. Summary
A small follow-up to the live classes module. The insert rule on
`school_live_classes` allowed any teacher to create a request, but did not check
who the request was attributed to. A teacher could therefore have written a
request in a colleague's name, which would have shown the wrong person in the
administrator's approval queue.

This migration replaces that one policy so the teacher recorded on the request
must be the signed-in account. Nothing else changes: no table, column or row is
touched, and no data is removed.

## 2. Security changes
- The policy `"Teachers can request live classes"` is dropped and recreated with
  the added condition `teacher_id = auth.uid()`.
- The rule that a new request must arrive unapproved and in the pending state is
  unchanged, so approval still cannot be forged by a direct insert.

## 3. Notes
- Administrators are covered by the same condition: the app records the signed-in
  account as the teacher on every request, so an administrator creating a request
  satisfies it too.
- Safe to re-run; the policy is dropped before it is created.
*/

DROP POLICY IF EXISTS "Teachers can request live classes" ON public.school_live_classes;
CREATE POLICY "Teachers can request live classes"
ON public.school_live_classes FOR INSERT
TO authenticated
WITH CHECK (
  is_exam_staff()
  AND teacher_id = auth.uid()
  AND status = 'pending'
  AND approved_at IS NULL
  AND approved_by IS NULL
  AND reviewed_at IS NULL
  AND admin_remarks IS NULL
  AND started_at IS NULL
  AND ended_at IS NULL
);
