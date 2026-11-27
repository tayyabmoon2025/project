/*
# Fee adjustment history must outlive the adjustment it describes

## 1. Why this migration exists
The previous migration created `school_fee_adjustment_history` with a foreign key to
`school_fee_adjustments` using `ON DELETE CASCADE`. That was wrong for an audit log.

`delete_fee_adjustment` writes a history row recording the removal and then deletes the
adjustment. The cascade then deleted the very history row that had just been written, so
a removed adjustment left no trace at all — the opposite of the intent.

A rolled-back test confirmed it: after create, edit and delete, the history held the
`updated` row but zero `deleted` rows.

## 2. The change
- Drop the foreign key constraint on `school_fee_adjustment_history.adjustment_id`.
- The column stays `NOT NULL` and keeps the adjustment's id as a plain reference.

An audit table should not be cascade-deleted by the record it audits. The row keeps the
student, the previous amount, the previous remarks, the posted date, who changed it and
when — which is everything needed to explain a removal — even after the adjustment itself
is gone.

## 3. Security
No policy or grant changes. The table remains readable by fee staff only, and remains
writable only by the `SECURITY DEFINER` functions.

## 4. Notes
1. Idempotent and safe to re-run.
2. No rows are deleted and no column is dropped.
*/

DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.school_fee_adjustment_history'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%school_fee_adjustments%'
  LOOP
    EXECUTE format('ALTER TABLE public.school_fee_adjustment_history DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END
$$;
