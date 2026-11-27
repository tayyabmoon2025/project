/*
# Sync fee challans to the Student Portal and alert parents

## 1. What this changes
Issuing a fee challan now does two things by itself, in the database, so neither can be
forgotten or lost if the browser is closed:

1. the challan is readable in the Student Portal for the student it belongs to (and for
   their linked parents), and
2. a notice is placed in the Parent Portal for that student, showing the fee month, the
   due date and the amount payable.

## 2. New column on `school_portal_notifications`
- `challan_id` (uuid, nullable, references `school_fee_challans.id` on delete cascade) —
  the fee challan a notice is about. It is NULL for the attendance notices that already
  existed, and set for the new fee notices.

## 3. Duplicate prevention
- New unique index `school_portal_notifications_challan_key` on `challan_id`. A unique
  index ignores NULLs, so the existing attendance notices are unaffected, while each
  challan can produce exactly one notice no matter how many times the challan is saved
  or the page is re-rendered.

## 4. New trigger and function
- `public.notify_parent_of_fee_challan()` is a SECURITY DEFINER trigger function on
  `school_fee_challans` that runs AFTER INSERT or AFTER an update of the amount or due
  date. It writes one notice per challan. If the notice already exists it updates the
  wording in place instead of adding a second one, so re-generating a challan keeps the
  parent's notice accurate without duplicating it. A challan with nothing to pay (total
  of zero or less) raises no notice.

## 5. Read access added
- `school_fee_challans`: a student can read the challans issued to them, and a parent can
  read the challans of the children linked to their account. Staff access is unchanged.
- `school_payment_settings`: any signed-in user can read the school's Easypaisa and bank
  details, because those details are printed on every challan handed to families and are
  needed to show "how to pay" in the Student Portal. Only administrators can change them.

## 6. One-time backfill
- A notice is created for every challan that already exists and has an amount to pay, so
  the Parent Portal is not empty for challans issued before this change. Existing notices
  are never modified by the backfill.

## 7. Security
- `notify_parent_of_fee_challan()` is SECURITY DEFINER with a fixed search_path, and its
  EXECUTE is revoked from PUBLIC, anon and authenticated so it can only run as a trigger.
- The new policies follow the existing scoping: `auth.uid()` through the parent link
  table and `own_student_id()`, never a client-supplied identity.
- No data is deleted or overwritten, and no existing policy is narrowed.

## 8. Notes
- Re-running this migration is safe: columns are added with IF NOT EXISTS, the index is
  IF NOT EXISTS, and the function is CREATE OR REPLACE.
*/

-- ---------------------------------------------------------------------------
-- 1. Link a portal notice to the challan it is about
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_portal_notifications
  ADD COLUMN IF NOT EXISTS challan_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_portal_notifications_challan_id_fkey'
  ) THEN
    ALTER TABLE public.school_portal_notifications
      ADD CONSTRAINT school_portal_notifications_challan_id_fkey
      FOREIGN KEY (challan_id) REFERENCES public.school_fee_challans(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS school_portal_notifications_challan_key
  ON public.school_portal_notifications (challan_id);

-- ---------------------------------------------------------------------------
-- 2. A challan raises exactly one parent notice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_parent_of_fee_challan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month_label text;
  v_title text;
  v_body text;
BEGIN
  IF coalesce(NEW.total, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.month ~ '^[0-9]{4}-[0-9]{2}$' THEN
    v_month_label := trim(to_char(to_date(NEW.month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'));
  ELSE
    v_month_label := coalesce(nullif(btrim(NEW.month), ''), 'this month');
  END IF;

  v_title := 'Fee challan for ' || v_month_label;
  v_body := format(
    'A fee challan of Rs %s for %s has been issued for %s. Please pay by %s.%s',
    to_char(NEW.total, 'FM999,999,999'),
    v_month_label,
    NEW.student_name,
    to_char(NEW.due_date, 'DD Mon YYYY'),
    CASE
      WHEN coalesce(btrim(NEW.challan_number), '') = '' THEN ''
      ELSE ' Challan no. ' || NEW.challan_number || '.'
    END
  );

  INSERT INTO public.school_portal_notifications (
    student_id, notification_type, title, body, attendance_date, challan_id, created_by
  )
  VALUES (
    NEW.student_id, 'fee_challan', v_title, v_body, NULL, NEW.id, coalesce(NEW.created_by, auth.uid())
  )
  ON CONFLICT (challan_id) DO UPDATE
    SET title = EXCLUDED.title,
        body = EXCLUDED.body,
        student_id = EXCLUDED.student_id;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.notify_parent_of_fee_challan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_fee_challans_notify_parent ON public.school_fee_challans;
CREATE TRIGGER school_fee_challans_notify_parent
AFTER INSERT OR UPDATE OF total, due_date ON public.school_fee_challans
FOR EACH ROW EXECUTE FUNCTION public.notify_parent_of_fee_challan();

-- ---------------------------------------------------------------------------
-- 3. Students and parents can read the challans that concern them
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students and parents can read their challans" ON public.school_fee_challans;
CREATE POLICY "Students and parents can read their challans"
ON public.school_fee_challans FOR SELECT
TO authenticated
USING (
  school_fee_challans.student_id = public.own_student_id()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    WHERE psl.parent_user_id = auth.uid()
      AND psl.student_id = school_fee_challans.student_id
  )
);

-- The school's own Easypaisa and bank details, printed on every challan handed to
-- families, so every signed-in family member may read them. Editing stays admin-only.
DROP POLICY IF EXISTS "Signed-in users can read payment settings" ON public.school_payment_settings;
CREATE POLICY "Signed-in users can read payment settings"
ON public.school_payment_settings FOR SELECT
TO authenticated
USING (true);

-- ---------------------------------------------------------------------------
-- 4. Backfill a notice for challans issued before this change
-- ---------------------------------------------------------------------------
INSERT INTO public.school_portal_notifications (
  student_id, notification_type, title, body, attendance_date, challan_id, created_by
)
SELECT
  c.student_id,
  'fee_challan',
  'Fee challan for ' || CASE
    WHEN c.month ~ '^[0-9]{4}-[0-9]{2}$'
      THEN trim(to_char(to_date(c.month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'))
    ELSE coalesce(nullif(btrim(c.month), ''), 'this month')
  END,
  format(
    'A fee challan of Rs %s for %s has been issued for %s. Please pay by %s.%s',
    to_char(c.total, 'FM999,999,999'),
    CASE
      WHEN c.month ~ '^[0-9]{4}-[0-9]{2}$'
        THEN trim(to_char(to_date(c.month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'))
      ELSE coalesce(nullif(btrim(c.month), ''), 'this month')
    END,
    c.student_name,
    to_char(c.due_date, 'DD Mon YYYY'),
    CASE
      WHEN coalesce(btrim(c.challan_number), '') = '' THEN ''
      ELSE ' Challan no. ' || c.challan_number || '.'
    END
  ),
  NULL,
  c.id,
  c.created_by
FROM public.school_fee_challans c
WHERE coalesce(c.total, 0) > 0
ON CONFLICT (challan_id) DO NOTHING;
